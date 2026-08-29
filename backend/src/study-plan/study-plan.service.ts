import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
  userOpenRouterKey?: string;
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

  async generateStudyPlan(request: StudyPlanRequest, userOpenRouterKey?: string): Promise<StudyPlanResponse> {
    const { testResults } = request;
    const accuracy = testResults.totalQuestions > 0 ? (testResults.correctAnswers / testResults.totalQuestions) * 100 : 0;
    const apiKey = userOpenRouterKey || process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return this.generateBasicStudyPlan(testResults);
    }

    try {
      const prompt = `Create a study plan based on these test results:
Total: ${testResults.totalQuestions}, Correct: ${testResults.correctAnswers} (${accuracy.toFixed(1)}%)
Subjects: ${testResults.subjectScores.map(s => `${s.subject}: ${s.score}/${s.total}`).join(', ')}
Topics: ${testResults.topicScores.map(t => `${t.topic}: ${t.score}/${t.total}`).join(', ')}

Return JSON:
{
  "plan": "Study plan in English",
  "planHindi": "Study plan in Hindi",
  "focusAreas": ["weak areas"],
  "focusAreasHindi": ["कमजोर areas"],
  "dailySchedule": [{"day": 1, "topic": "topic", "duration": 60, "priority": "high"}],
  "tips": ["tips in English"],
  "tipsHindi": ["tips in Hindi"]
}`;

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://sscprephub.in',
          'X-Title': 'SSC Prep Hub',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) throw new Error(`AI API error: ${response.status}`);

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response');

      return JSON.parse(content);
    } catch {
      return this.generateBasicStudyPlan(testResults);
    }
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

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const targetDate = new Date(input.targetDate);
    if (Number.isNaN(targetDate.getTime()) || targetDate <= startDate) {
      throw new BadRequestException('targetDate must be a valid future date');
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
    const dailyTarget = Math.max(5, Math.min(200, Math.ceil(totalQuestions / days) || 10));

    // One active plan per user — replace any existing one so the frontend's
    // "Recreate" flow (same POST /study-plan/create) works as expected.
    const existing = await this.prisma.studyPlan.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const plan = existing
      ? await this.prisma.studyPlan.update({
          where: { id: existing.id },
          data: {
            examId: input.examId,
            subjectId: input.subjectId ?? null,
            type: (input.type as any) ?? 'COMBINED',
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
            type: (input.type as any) ?? 'COMBINED',
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

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

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
        where: { userId, status: 'SUBMITTED', submittedAt: { gte: since } },
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
        where: { userId, status: 'SUBMITTED', submittedAt: { not: null } },
        select: { submittedAt: true },
      }),
      this.prisma.questionBankSet.findMany({
        where: { userId, isCompleted: true, completedAt: { not: null } },
        select: { completedAt: true },
      }),
    ]);

    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
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
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    if (!activeDays.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1); // allow "not done today yet"
    while (activeDays.has(dayKey(cursor))) {
      currentStreak++;
      cursor.setDate(cursor.getDate() - 1);
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
        ? 'बुनियादी बतों पर ध्यान दें। रोज़ 80+ प्रश्न अभ्यאस करें।'
        : accuracy < 75
        ? 'अचछी प़्रगति! कमज़ोर areas पर ध्यान दें।'
        : 'उतकृष्ट! उन्नत विषयों पर ध्यान दें।',
      focusAreas: weakTopics,
      focusAreasHindi: weakTopics,
      dailySchedule: weakTopics.slice(0, 5).map((topic, i) => ({
        day: i + 1,
        topic,
        duration: 60,
        priority: 'high' as const,
      })),
      tips: ['Practice daily', 'Focus on weak areas', 'Take mock tests'],
      tipsHindi: ['रोज़ाना अभ्यास करें', 'कमज़ोर areas पर ध्यान दें', 'Mock tests लें'],
    };
  }
}
