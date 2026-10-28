import { Injectable, BadRequestException } from '@nestjs/common';
import { StudyPlanType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ATTEMPT_DONE } from '../common/attempt-status';
import { istDateKey } from '../gamification/gamification.service';
import { clampDailyTarget } from './study-plan-pace.util';

// BUGFIX: same IST-day-boundary bug fixed in tests/daily-test.service.ts and
// quiz/quiz.service.ts. "Today"/streak day-keys here were computed with
// server-local midnight + `Date#toISOString()` (both UTC on the VPS, no TZ
// set), instead of the IST calendar day every other "today" in this app
// uses (see istDateKey() in gamification.service.ts). Left unfixed this
// under/over-counts a student's "today" progress and daily streak for any
// activity done between midnight and 5:30 AM IST.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istMidnightUtc(d: Date): Date {
  const key = istDateKey(d); // "YYYY-MM-DD" in IST
  return new Date(new Date(`${key}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
}

interface StudyPlanRequest {
  userId: string;
  testResults: {
    totalQuestions: number;
    correctAnswers: number;
    incorrectAnswers: number;
    skippedAnswers: number;
    subjectScores: { subject: string; score: number; total: number }[];
    topicScores: { topic: string; score: number; total: number }[];
  };
}

interface StudyPlanResponse {
  plan: string;
  planHindi: string;
  focusAreas: string[];
  focusAreasHindi: string[];
  dailySchedule: { day: number; topic: string; duration: number; priority: 'high' | 'medium' | 'low' }[];
  tips: string[];
  tipsHindi: string[];
}

@Injectable()
export class StudyPlanService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Quick rule-based plan from one set of test results (no AI, no external call):
   * weak topics = topics under 60 % accuracy, worst first.
   */
  async generateStudyPlan(request: StudyPlanRequest): Promise<StudyPlanResponse> {
    return this.generateBasicStudyPlan(request.testResults);
  }

  // ============================================================
  // BUGFIX (v-audit): the routes the frontend actually calls —
  // GET /study-plan, GET /study-plan/daily-target, POST /study-plan/create —
  // did not exist on the backend at all (only /generate + /model did, and
  // /generate never wrote to the `StudyPlan` table). This meant:
  //   - "Create Plan" on the study-plan page always failed (404)
  //   - Daily Test (`/test?daily=1`) was permanently unreachable, because
  //     daily-test.service.ts reads `prisma.studyPlan` and that table was
  //     never populated by anything.
  // The methods below implement real CRUD against the `StudyPlan` model so
  // both the study-plan page and the Daily Test feature actually work.
  // ============================================================

  /** POST /study-plan/create — create (or replace) the user's active plan. */
  async createPlan(
    userId: string,
    input: { examId: string; subjectId?: string; type?: 'COMBINED' | 'SUBJECT_WISE'; targetDate: string },
  ) {
    if (!input.examId) throw new BadRequestException('examId is required');
    if (!input.targetDate) throw new BadRequestException('targetDate is required');

    const exam = await this.prisma.exam.findUnique({ where: { id: input.examId } });
    if (!exam) throw new BadRequestException('Exam not found');

    // `startDate` / `targetDate` are @db.Date columns (a calendar day, stored as UTC midnight of that day). The old code
    // stored istMidnightUtc() (= 18:30 UTC of the PREVIOUS day) and so saved yesterday's date, and it let "today" pass as a
    // future target date. Both are now plain IST calendar days compared as keys.
    const todayKey = istDateKey(new Date());
    const startDate = new Date(`${todayKey}T00:00:00.000Z`);
    if (typeof input.targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate)) {
      throw new BadRequestException('targetDate must look like YYYY-MM-DD');
    }
    const targetDate = new Date(`${input.targetDate}T00:00:00.000Z`);
    if (Number.isNaN(targetDate.getTime()) || targetDate.toISOString().slice(0, 10) !== input.targetDate) {
      throw new BadRequestException('targetDate must be a real calendar date');
    }
    if (input.targetDate <= todayKey) {
      throw new BadRequestException('targetDate must be a future date (tomorrow or later)');
    }
    if (targetDate.getTime() - startDate.getTime() > 3 * 366 * 24 * 3600 * 1000) {
      throw new BadRequestException('targetDate can be at most 3 years away');
    }

    // Total published bilingual questions available for this exam (scope
    // narrowed to the subject when the user picked subject-wise prep).
    const totalQuestions = await this.prisma.question.count({
      where: {
        isActive: true,
        isApproved: true,
        autoSuspended: false,
        examId: input.examId,
        ...(input.subjectId ? { subjectId: input.subjectId } : {}),
      },
    });

    const days = Math.max(1, Math.ceil((targetDate.getTime() - startDate.getTime()) / (24 * 3600 * 1000)));
    // a realistic daily practice target: 25-100 questions in steps of 5 (the old 5-200 range gave 3-month plans a target of
    // 200 a day, which nobody can hit - and more than a free student's 5 practice sets x 25 questions)
    const dailyTarget = clampDailyTarget(Math.ceil(totalQuestions / days));

    // One active plan per user — replace any existing one so the frontend's
    // "Recreate" flow (same POST /study-plan/create) works as expected.
    const existing = await this.prisma.studyPlan.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const plan = existing
      ? await this.prisma.studyPlan.update({
          where: { id: existing.id },
          data: {
            examId: input.examId,
            subjectId: input.subjectId ?? null,
            type: input.type ?? StudyPlanType.COMBINED,
            startDate,
            targetDate,
            dailyTarget,
          },
        })
      : await this.prisma.studyPlan.create({
          data: {
            userId,
            examId: input.examId,
            subjectId: input.subjectId ?? null,
            type: input.type ?? StudyPlanType.COMBINED,
            startDate,
            targetDate,
            dailyTarget,
          },
        });

    return plan;
  }

  /** GET /study-plan — the user's active plan, with progress + pacing stats. */
  async getPlan(userId: string) {
    const plan = await this.prisma.studyPlan.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!plan) return null;

    const totalQuestions = await this.prisma.question.count({
      where: {
        isActive: true,
        isApproved: true,
        autoSuspended: false,
        examId: plan.examId,
        ...(plan.subjectId ? { subjectId: plan.subjectId } : {}),
      },
    });

    const questionsDone = await this.getQuestionsAnsweredSince(userId, plan.startDate);
    const remainingDays = Math.max(
      0,
      Math.ceil((new Date(plan.targetDate).getTime() - Date.now()) / (24 * 3600 * 1000)),
    );

    return {
      ...plan,
      stats: {
        totalQuestions,
        remainingDays,
        dailyTarget: plan.dailyTarget,
      },
      progress: {
        totalQuestions,
        questionsDone,
        remaining: Math.max(0, totalQuestions - questionsDone),
        percentComplete: totalQuestions > 0 ? Math.min(100, Math.round((questionsDone / totalQuestions) * 100)) : 0,
      },
    };
  }

  /** GET /study-plan/daily-target — today's target/progress + streak, used by both the study-plan page and the dashboard. */
  async getDailyTarget(userId: string) {
    const plan = await this.prisma.studyPlan.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    if (!plan) {
      return { hasPlan: false, message: 'Create a study plan on the dashboard to unlock your Daily Test.' };
    }

    const todayStart = istMidnightUtc(new Date());

    const [todayDone, { currentStreak, longestStreak }] = await Promise.all([
      this.getQuestionsAnsweredSince(userId, todayStart),
      this.computeStreaks(userId),
    ]);

    const totalQuestions = await this.prisma.question.count({
      where: {
        isActive: true,
        isApproved: true,
        autoSuspended: false,
        examId: plan.examId,
        ...(plan.subjectId ? { subjectId: plan.subjectId } : {}),
      },
    });
    const remainingDays = Math.max(
      0,
      Math.ceil((new Date(plan.targetDate).getTime() - Date.now()) / (24 * 3600 * 1000)),
    );

    // Best-effort cache of the computed streak onto the plan row (never blocks the response).
    if (currentStreak !== plan.currentStreak || longestStreak !== plan.longestStreak) {
      this.prisma.studyPlan
        .update({ where: { id: plan.id }, data: { currentStreak, longestStreak } })
        .catch(() => undefined);
    }

    return {
      hasPlan: true,
      planId: plan.id,
      dailyTarget: plan.dailyTarget,
      todayDone,
      remaining: Math.max(0, plan.dailyTarget - todayDone),
      totalQuestions,
      remainingDays,
      streak: currentStreak,
      targetDate: plan.targetDate,
    };
  }

  /** Sum of questions attempted (mock/daily tests + question-bank practice sets) since a given date. */
  private async getQuestionsAnsweredSince(userId: string, since: Date): Promise<number> {
    const [testAgg, setAgg] = await Promise.all([
      this.prisma.testAttempt.aggregate({
        where: { userId, status: ATTEMPT_DONE, submittedAt: { gte: since } },
        _sum: { totalCorrect: true, totalWrong: true, totalSkipped: true },
      }),
      this.prisma.questionBankSet.findMany({
        where: { userId, isCompleted: true, completedAt: { gte: since } },
        select: { questions: true },
      }),
    ]);
    const fromTests =
      (testAgg._sum.totalCorrect ?? 0) + (testAgg._sum.totalWrong ?? 0) + (testAgg._sum.totalSkipped ?? 0);
    const fromSets = setAgg.reduce((sum, s) => sum + (Array.isArray(s.questions) ? s.questions.length : 0), 0);
    return fromTests + fromSets;
  }

  /** Current + longest daily-practice streak, derived from actual activity dates (no separate write path needed). */
  private async computeStreaks(userId: string): Promise<{ currentStreak: number; longestStreak: number }> {
    const [testDates, setDates] = await Promise.all([
      this.prisma.testAttempt.findMany({
        where: { userId, status: ATTEMPT_DONE, submittedAt: { not: null } },
        select: { submittedAt: true },
      }),
      this.prisma.questionBankSet.findMany({
        where: { userId, isCompleted: true, completedAt: { not: null } },
        select: { completedAt: true },
      }),
    ]);

    const dayKey = (d: Date) => istDateKey(d);
    const activeDays = new Set<string>();
    for (const t of testDates) if (t.submittedAt) activeDays.add(dayKey(new Date(t.submittedAt)));
    for (const s of setDates) if (s.completedAt) activeDays.add(dayKey(new Date(s.completedAt)));

    if (activeDays.size === 0) return { currentStreak: 0, longestStreak: 0 };

    const sorted = [...activeDays].sort();
    let longestStreak = 1;
    let run = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1]);
      const cur = new Date(sorted[i]);
      const diffDays = Math.round((cur.getTime() - prev.getTime()) / (24 * 3600 * 1000));
      run = diffDays === 1 ? run + 1 : 1;
      longestStreak = Math.max(longestStreak, run);
    }

    // Current streak: walk backwards from today (today not required — a
    // streak stays alive until a full day is missed, so "yesterday" still
    // counts if today's practice hasn't happened yet).
    let currentStreak = 0;
    const DAY_MS = 24 * 60 * 60 * 1000;
    // Walk back in fixed 24h real-time steps (not Date#setDate, which is
    // server-local-time and would drift from IST calendar days) — IST has
    // no DST, so each 24h step is exactly one IST calendar day back.
    let cursor = Date.now();
    if (!activeDays.has(dayKey(new Date(cursor)))) cursor -= DAY_MS; // allow "not done today yet"
    while (activeDays.has(dayKey(new Date(cursor)))) {
      currentStreak++;
      cursor -= DAY_MS;
    }

    return { currentStreak, longestStreak };
  }

  private generateBasicStudyPlan(testResults: StudyPlanRequest['testResults']): StudyPlanResponse {
    const weakTopics = testResults.topicScores
      .filter(t => (t.score / t.total) * 100 < 60)
      .sort((a, b) => (a.score / a.total) - (b.score / b.total))
      .slice(0, 5)
      .map(t => t.topic);

    const accuracy = testResults.totalQuestions > 0 ? (testResults.correctAnswers / testResults.totalQuestions) * 100 : 0;

    return {
      plan: accuracy < 50
        ? 'Focus on fundamentals. Practice 80+ questions daily.'
        : accuracy < 75
        ? 'Good progress! Focus on weak areas. Practice 100+ questions daily.'
        : 'Excellent! Focus on advanced topics and time management.',
      planHindi: accuracy < 50
        ? 'बुनियादी बातों पर ध्यान दें। रोज़ 80+ प्रश्नों का अभ्यास करें।'
        : accuracy < 75
        ? 'अच्छी प्रगति! कमज़ोर क्षेत्रों पर ध्यान दें। रोज़ 100+ प्रश्नों का अभ्यास करें।'
        : 'उत्कृष्ट! उन्नत विषयों और समय-प्रबंधन पर ध्यान दें।',
      focusAreas: weakTopics,
      focusAreasHindi: weakTopics,
      dailySchedule: weakTopics.slice(0, 5).map((topic, i) => ({
        day: i + 1,
        topic,
        duration: 60,
        priority: 'high' as const,
      })),
      tips: ['Practice daily', 'Focus on weak areas', 'Take mock tests'],
      tipsHindi: ['रोज़ाना अभ्यास करें', 'कमज़ोर क्षेत्रों पर ध्यान दें', 'मॉक टेस्ट दें'],
    };
  }
}
