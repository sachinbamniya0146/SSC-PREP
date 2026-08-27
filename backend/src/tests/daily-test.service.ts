/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLISHED_QUESTION_WHERE } from '../common/question-visibility';

/**
 * v3 §6.4 — Daily Test (Live mode).
 *
 * Every day the user gets ONE timed "Daily Test" built from their active study
 * plan's exam (proportional short paper until the pool grows). Server-stamped
 * expiry (no client clock), one attempt per day, composition snapshotted on
 * the attempt so a refresh returns the identical paper.
 */
@Injectable()
export class DailyTestService {
  constructor(private prisma: PrismaService) {}

  private async templateFor(examName: string, maxQ: number, durationMinutes: number) {
    const title = `Daily Test — ${examName}`;
    let tpl = await this.prisma.testTemplate.findFirst({
      where: { type: 'DAILY_PRACTICE', title },
    });
    if (!tpl) {
      tpl = await this.prisma.testTemplate.create({
        data: {
          title,
          description: 'Auto daily test (v3 §6.4) — composed per user plan, snapshot per attempt.',
          type: 'DAILY_PRACTICE',
          durationMinutes,
          totalQuestions: maxQ,
          totalMarks: maxQ * 2,
          isPremium: false,
          isActive: true,
        },
      });
    }
    return tpl;
  }

  /** Today's attempt state: taken / in progress (resumable) / fresh. */
  async status(userId: string) {
    const plan = await this.prisma.studyPlan.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { examId: true, dailyTarget: true, exam: { select: { name: true } } },
    });
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const dailyTpls = await this.prisma.testTemplate.findMany({
      where: { type: 'DAILY_PRACTICE', title: { startsWith: 'Daily Test —' } },
      select: { id: true },
    });
    const attempt = dailyTpls.length
      ? await this.prisma.testAttempt.findFirst({
          where: { userId, testTemplateId: { in: dailyTpls.map((t) => t.id) }, startedAt: { gte: todayStart } },
          orderBy: { startedAt: 'desc' },
          select: { id: true, status: true, expiresAt: true, score: true, accuracyPercent: true },
        })
      : null;

    return {
      hasPlan: !!plan,
      examName: plan?.exam.name ?? null,
      dailyTarget: plan?.dailyTarget ?? 0,
      takenToday: !!attempt && attempt.status !== 'IN_PROGRESS',
      attempt: attempt
        ? {
            id: attempt.id,
            status: attempt.status,
            expired: attempt.expiresAt ? new Date(attempt.expiresAt) <= new Date() : false,
            expiresAt: attempt.expiresAt,
            score: attempt.score,
            accuracyPercent: attempt.accuracyPercent,
          }
        : null,
      message: plan
        ? null
        : 'Create a study plan on the dashboard to unlock your Daily Test.',
    };
  }

  /**
   * Start today's Daily Test.
   * - no plan → 400
   * - already taken today → 400
   * - in-progress, unexpired → resume (same attempt, same paper)
   * - fresh → compose plan-based paper, snapshot it, start a timed attempt
   */
  async start(userId: string) {
    const st = await this.status(userId);
    if (!st.hasPlan) throw new BadRequestException(st.message || 'No study plan found.');
    if (st.takenToday) throw new BadRequestException('Daily Test for today is already submitted — come back tomorrow.');

    if (st.attempt && st.attempt.status === 'IN_PROGRESS' && !st.attempt.expired) {
      const snap = await this.prisma.testAttempt.findUnique({
        where: { id: st.attempt.id },
        select: { questionSnapshot: true, expiresAt: true },
      });
      const questions = await this.loadQuestions((snap?.questionSnapshot as string[]) || []);
      return {
        resume: true,
        attemptId: st.attempt.id,
        expiresAt: snap?.expiresAt,
        durationSec: snap?.expiresAt ? Math.max(1, Math.round((new Date(snap.expiresAt).getTime() - Date.now()) / 1000)) : 0,
        examName: st.examName,
        dailyTarget: st.dailyTarget,
        questions,
      };
    }

    const plan = await this.prisma.studyPlan.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { examId: true, subjectId: true, dailyTarget: true, exam: { select: { name: true } } },
    });
    if (!plan) throw new BadRequestException('No study plan found.');

    const N = Math.min(Math.max(plan.dailyTarget || 15, 5), 40);

    // v3 §6.4 — ExamPattern-driven composition: real-exam section proportions
    // (subject-wise) + scaled duration, instead of whole-pool random.
    const pattern = await this.prisma.examPattern.findFirst({
      where: { examId: plan.examId, isActive: true },
    });
    let picked: string[] = [];
    let sectionLabels: string[] = [];
    if (pattern) {
      const sections = (pattern.sections as any[]) || [];
      const subjectBySlug = new Map(
        (await this.prisma.subject.findMany({ select: { id: true, slug: true } })).map((s) => [s.slug, s.id]),
      );
      for (const sec of sections) {
        const target = Math.max(1, Math.round(N * ((sec.questions || 0) / (pattern.totalQuestions || 100))));
        const sid = sec.subjectSlug ? subjectBySlug.get(sec.subjectSlug) : undefined;
        if (sid) {
          const ids = await this.composeIds(plan.examId, sid, target);
          if (ids.length >= Math.max(1, Math.floor(target / 2))) {
            picked.push(...ids.slice(0, target));
            sectionLabels.push(sec.name);
            continue;
          }
        }
        picked.push(...(await this.composeIds(plan.examId, undefined, target)).slice(0, target));
      }
      if (picked.length < 5) {
        // section pools too thin — fall back to whole-exam composition
        picked = (await this.composeIds(plan.examId, undefined, N)).slice(0, N);
        sectionLabels = [];
      }
      // dedupe keeping order, then trim to N
      picked = [...new Set(picked)].slice(0, N);
    } else {
      picked = (await this.composeIds(plan.examId, plan.subjectId ?? undefined, N)).slice(0, N);
    }
    if (picked.length < 5) {
      throw new BadRequestException(
        `Only ${picked.length} bilingual 4-option questions available for this exam yet — the pool is still growing. Try Daily Practice instead.`,
      );
    }

    // proportional short paper: real-exam scale when a pattern exists
    let durationMinutes: number;
    if (pattern) {
      durationMinutes = Math.min(Math.max(Math.round((pattern.durationMinutes * N) / (pattern.totalQuestions || 100)), 5), 120);
    } else {
      durationMinutes = Math.min(Math.max(Math.round(N * 0.6), 5), 60);
    }
    const tpl = await this.templateFor(plan.exam.name, N, durationMinutes);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);
    const attempt = await this.prisma.testAttempt.create({
      data: {
        userId,
        testTemplateId: tpl.id,
        status: 'IN_PROGRESS',
        startedAt: now,
        expiresAt,
        questionSnapshot: picked,
      },
      select: { id: true },
    });

    const questions = await this.loadQuestions(picked);
    return {
      resume: false,
      attemptId: attempt.id,
      expiresAt,
      durationSec: durationMinutes * 60,
      examName: plan.exam.name,
      dailyTarget: N,
      questions,
    };
  }

  /** Snapshot-backed paper — stable across refresh (unlike pool re-sampling). */
  async paper(userId: string, attemptId: string) {
    const attempt = await this.prisma.testAttempt.findFirst({
      where: { id: attemptId, userId },
      select: { questionSnapshot: true, expiresAt: true, startedAt: true },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    const ids = (attempt.questionSnapshot as string[]) || [];
    const questions = await this.loadQuestions(ids);
    const durationSec =
      attempt.expiresAt && attempt.startedAt
        ? Math.max(1, Math.round((new Date(attempt.expiresAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000))
        : 60 * 60;
    return { attemptId, durationSec, expiresAt: attempt.expiresAt, questions };
  }

  // ---- composition helpers ----

  private async composeIds(examId: string, subjectId: string | undefined, n: number): Promise<string[]> {
    const rows: any[] = await this.prisma.question.findMany({
      where: {
        ...PUBLISHED_QUESTION_WHERE,
        examId,
        ...(subjectId ? { subjectId } : {}),
        questionTextHindi: { not: '' },
      },
      orderBy: [{ year: 'desc' }, { createdAt: 'asc' }],
      take: 1000,
    });
    const valid = rows.filter(
      (r) => Array.isArray(r.optionsJson) && r.optionsJson.length >= 2 && r.optionsJson.every((o: any) => o?.text),
    );
    const byYear = new Map<number, string[]>();
    for (const r of valid) {
      const y = r.year ?? 0;
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(r.id);
    }
    const out: string[] = [];
    const yearKeys = [...byYear.keys()].sort((a, b) => b - a);
    const ptr = new Map<number, number>();
    let cycle = 0;
    while (out.length < n && cycle < 1000) {
      cycle++;
      let added = false;
      for (const y of yearKeys) {
        if (out.length >= n) break;
        const pool = byYear.get(y)!;
        const p = ptr.get(y) ?? 0;
        if (p < pool.length) {
          out.push(pool[p]);
          ptr.set(y, p + 1);
          added = true;
        }
      }
      if (!added) break;
    }
    return out;
  }

  private async loadQuestions(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.question.findMany({
      where: { id: { in: ids } },
      include: { exam: { select: { name: true } }, chapter: { select: { name: true } } },
    });
    const map = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => map.get(id))
      .filter(Boolean)
      .map((r: any) => ({
        id: r.id,
        questionText: r.questionText,
        questionTextHindi: r.questionTextHindi,
        options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text })),
        chapter: r.chapter?.name ?? '',
        examName: r.exam?.name ?? '',
        year: r.year,
        shift: r.shift,
        marks: r.marks,
        negativeMarks: r.negativeMarks,
        explanation: r.explanation,
        explanationHindi: r.explanationHindi,
      }));
  }
}
