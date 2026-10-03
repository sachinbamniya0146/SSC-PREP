/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLISHED_QUESTION_WHERE } from '../common/question-visibility';

// =============================================================================
// WeakTopicService  (NEW — Oct 3 2026)
//
// Student-side "weak chapter / topic / sub-topic" memory.
//
//  * recordAnswers()     — called after ANY submitted test (mock, PYQ, sectional,
//                          daily test, study-plan test, quiz, instant practice).
//                          Wrong answers open (or re-open) a weak row for the
//                          chapter / topic / sub-topic of that question.
//  * completePractice()  — called when a practice set of that scope is finished.
//                          The row is only turned STRENGTHENED when the student
//                          scored >= WEAK_PASS_PERCENT on that topic's questions
//                          (at least MIN_QUESTIONS_TO_STRENGTHEN of them).
//                          Until then the topic STAYS weak and keeps counting.
//  * list()              — the weak list the student sees (grouped on the client).
//  * isScopeWeak() / weakScopeRows() — used by the practice screens (weak topics
//                          are free to practice).
//
// Nothing in here may ever throw into a student's submit — every public
// recording method swallows its own errors.
// =============================================================================

/** % of a weak topic's practice questions that must be right to call it strengthened. */
export const WEAK_PASS_PERCENT = 60;
export const MIN_QUESTIONS_TO_STRENGTHEN = 3;

export interface AnswerLite {
  questionId: string;
  selectedOption?: string | null;
  isCorrect?: boolean;
}

type Scope = { chapterId: string | null; topicId: string | null; subTopicId: string | null };

const keyOf = (s: Scope) => `${s.chapterId ?? ''}|${s.topicId ?? ''}|${s.subTopicId ?? ''}`;

function scopeWhere(s: Partial<Scope>): Prisma.QuestionWhereInput | null {
  if (s.subTopicId) return { subTopicId: s.subTopicId };
  if (s.topicId) return { topicId: s.topicId };
  if (s.chapterId) return { chapterId: s.chapterId };
  return null;
}

@Injectable()
export class WeakTopicService {
  private readonly logger = new Logger(WeakTopicService.name);
  private readonly backfilled = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // 1) a test was submitted -> open / re-open weak rows
  // ---------------------------------------------------------------------------
  async recordAnswers(userId: string, attemptId: string | null, answers: AnswerLite[]): Promise<void> {
    try {
      const given = (answers ?? []).filter((a) => a?.questionId);
      if (!userId || given.length === 0) return;
      const qs = await this.prisma.question.findMany({
        where: { id: { in: given.map((a) => a.questionId) } },
        select: { id: true, subjectId: true, chapterId: true, topicId: true, subTopicId: true },
      });
      const qmap = new Map(qs.map((q) => [q.id, q]));

      const groups = new Map<string, { scope: Scope; subjectId: string | null; attempted: number; wrong: number }>();
      for (const a of given) {
        const q = qmap.get(a.questionId);
        if (!q || (!q.chapterId && !q.topicId && !q.subTopicId)) continue;
        const scope: Scope = { chapterId: q.chapterId, topicId: q.topicId, subTopicId: q.subTopicId };
        const k = keyOf(scope);
        const g = groups.get(k) ?? { scope, subjectId: q.subjectId, attempted: 0, wrong: 0 };
        g.attempted++;
        const skipped = a.selectedOption == null || a.selectedOption === '' || a.selectedOption === 'SKIPPED';
        if (a.isCorrect === false || (skipped && a.isCorrect !== true)) g.wrong++;
        groups.set(k, g);
      }

      for (const [scopeKey, g] of groups) {
        if (g.wrong === 0) continue;
        const existing = await this.prisma.userWeakTopic.findUnique({ where: { userId_scopeKey: { userId, scopeKey } } });
        if (existing) {
          if (attemptId && existing.lastSourceAttemptId === attemptId) continue; // same attempt reported twice
          const reopen = existing.status !== 'WEAK';
          await this.prisma.userWeakTopic.update({
            where: { id: existing.id },
            data: {
              status: 'WEAK',
              wrongCount: { increment: g.wrong },
              attemptedCount: { increment: g.attempted },
              lastDetectedAt: new Date(),
              lastSourceAttemptId: attemptId,
              ...(reopen ? { strengthenedAt: null, practiceSetsDone: 0, practiceCorrect: 0, practiceTotal: 0, lastPracticeScore: null } : {}),
            },
          });
        } else {
          await this.prisma.userWeakTopic.create({
            data: {
              userId,
              subjectId: g.subjectId,
              chapterId: g.scope.chapterId,
              topicId: g.scope.topicId,
              subTopicId: g.scope.subTopicId,
              scopeKey,
              status: 'WEAK',
              wrongCount: g.wrong,
              attemptedCount: g.attempted,
              lastSourceAttemptId: attemptId,
            },
          });
        }
      }
    } catch (e) {
      this.logger.warn(`recordAnswers failed: ${(e as Error)?.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 2) a practice set of a scope was finished
  // ---------------------------------------------------------------------------
  async completePractice(
    userId: string,
    setScope: Partial<Scope>,
    results: { questionId: string; correct: boolean }[],
  ): Promise<{ strengthened: string[]; stillWeak: string[] }> {
    const out = { strengthened: [] as string[], stillWeak: [] as string[] };
    try {
      const where = scopeWhere(setScope);
      if (!where || results.length === 0) return out;
      await this.ensureBackfill(userId);

      // weak rows that this set practices (deepest id of the set decides)
      const rowWhere: Prisma.UserWeakTopicWhereInput = setScope.subTopicId
        ? { subTopicId: setScope.subTopicId }
        : setScope.topicId
          ? { topicId: setScope.topicId }
          : { chapterId: setScope.chapterId ?? undefined };
      const rows = await this.prisma.userWeakTopic.findMany({ where: { userId, status: 'WEAK', ...rowWhere } });
      if (rows.length === 0) return out;

      const qs = await this.prisma.question.findMany({
        where: { id: { in: results.map((r) => r.questionId) } },
        select: { id: true, chapterId: true, topicId: true, subTopicId: true },
      });
      const qmap = new Map(qs.map((q) => [q.id, q]));

      for (const row of rows) {
        let total = 0;
        let correct = 0;
        for (const r of results) {
          const q = qmap.get(r.questionId);
          if (!q) continue;
          const inRow = row.subTopicId ? q.subTopicId === row.subTopicId : row.topicId ? q.topicId === row.topicId : q.chapterId === row.chapterId;
          if (!inRow) continue;
          total++;
          if (r.correct) correct++;
        }
        if (total === 0) continue;
        const pct = Math.round((correct / total) * 100);
        const pass = total >= MIN_QUESTIONS_TO_STRENGTHEN && pct >= WEAK_PASS_PERCENT;
        await this.prisma.userWeakTopic.update({
          where: { id: row.id },
          data: {
            practiceSetsDone: { increment: 1 },
            practiceCorrect: { increment: correct },
            practiceTotal: { increment: total },
            lastPracticeScore: pct,
            ...(pass ? { status: 'STRENGTHENED', strengthenedAt: new Date() } : {}),
          },
        });
        (pass ? out.strengthened : out.stillWeak).push(row.id);
      }
    } catch (e) {
      this.logger.warn(`completePractice failed: ${(e as Error)?.message}`);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // 3) used by the practice screens
  // ---------------------------------------------------------------------------
  async isScopeWeak(userId: string, topicId?: string | null, subTopicId?: string | null): Promise<boolean> {
    if (!topicId && !subTopicId) return false;
    await this.ensureBackfill(userId);
    const row = await this.prisma.userWeakTopic.findFirst({
      where: { userId, status: 'WEAK', ...(subTopicId ? { subTopicId } : { topicId }) },
      select: { id: true },
    });
    return !!row;
  }

  /** every (topic, sub-topic) the student is currently weak in */
  async weakScopeRows(userId: string): Promise<{ topicId: string | null; subTopicId: string | null }[]> {
    try {
      await this.ensureBackfill(userId);
      const rows = await this.prisma.userWeakTopic.findMany({
        where: { userId, status: 'WEAK', OR: [{ topicId: { not: null } }, { subTopicId: { not: null } }] },
        select: { topicId: true, subTopicId: true },
      });
      return rows;
    } catch {
      return [];
    }
  }

  async weakTopicIdsInChapter(userId: string, chapterId: string): Promise<Set<string>> {
    await this.ensureBackfill(userId);
    const rows = await this.prisma.userWeakTopic.findMany({
      where: { userId, status: 'WEAK', chapterId, topicId: { not: null } },
      select: { topicId: true },
    });
    return new Set(rows.map((r) => r.topicId).filter((x): x is string => !!x));
  }

  // ---------------------------------------------------------------------------
  // 4) the list the student sees
  // ---------------------------------------------------------------------------
  async list(userId: string) {
    await this.ensureBackfill(userId);
    const [weak, done] = await Promise.all([
      this.prisma.userWeakTopic.findMany({ where: { userId, status: 'WEAK' }, orderBy: [{ wrongCount: 'desc' }, { lastDetectedAt: 'desc' }], take: 200 }),
      this.prisma.userWeakTopic.findMany({ where: { userId, status: 'STRENGTHENED' }, orderBy: { strengthenedAt: 'desc' }, take: 30 }),
    ]);
    const rows = [...weak, ...done];

    const ids = (f: (r: (typeof rows)[number]) => string | null) => [...new Set(rows.map(f).filter((x): x is string => !!x))];
    const [subjects, chapters, topics, subs] = await Promise.all([
      this.prisma.subject.findMany({ where: { id: { in: ids((r) => r.subjectId) } }, select: { id: true, name: true } }),
      this.prisma.chapter.findMany({ where: { id: { in: ids((r) => r.chapterId) } }, select: { id: true, name: true, subjectId: true } }),
      this.prisma.topic.findMany({ where: { id: { in: ids((r) => r.topicId) } }, select: { id: true, name: true } }),
      this.prisma.subTopic.findMany({ where: { id: { in: ids((r) => r.subTopicId) } }, select: { id: true, name: true } }),
    ]);
    const sN = new Map(subjects.map((x) => [x.id, x.name]));
    const cMap = new Map(chapters.map((x) => [x.id, x]));
    const tN = new Map(topics.map((x) => [x.id, x.name]));
    const stN = new Map(subs.map((x) => [x.id, x.name]));

    // how many questions a student can practice in each scope
    const avail = new Map<string, number>();
    const needed = [...new Map(weak.map((r) => [r.scopeKey, r])).values()];
    for (let i = 0; i < needed.length; i += 20) {
      await Promise.all(
        needed.slice(i, i + 20).map(async (r) => {
          const w = scopeWhere(r);
          avail.set(r.scopeKey, w ? await this.prisma.question.count({ where: { ...PUBLISHED_QUESTION_WHERE, ...w } }) : 0);
        }),
      );
    }

    const shape = (r: (typeof rows)[number]) => {
      const ch = r.chapterId ? cMap.get(r.chapterId) : undefined;
      const subjectId = r.subjectId ?? ch?.subjectId ?? null;
      const topicName = r.topicId ? tN.get(r.topicId) ?? '' : '';
      const subName = r.subTopicId ? stN.get(r.subTopicId) ?? '' : '';
      return {
        id: r.id,
        status: r.status,
        subjectId,
        subjectName: subjectId ? sN.get(subjectId) ?? '' : '',
        chapterId: r.chapterId,
        chapterName: ch?.name ?? '',
        topicId: r.topicId,
        topicName,
        subTopicId: r.subTopicId,
        subTopicName: subName,
        label: [ch?.name, topicName, subName].filter(Boolean).join(' › '),
        wrongCount: r.wrongCount,
        attemptedCount: r.attemptedCount,
        practiceSetsDone: r.practiceSetsDone,
        practiceCorrect: r.practiceCorrect,
        practiceTotal: r.practiceTotal,
        lastPracticeScore: r.lastPracticeScore,
        available: avail.get(r.scopeKey) ?? null,
        firstDetectedAt: r.firstDetectedAt,
        lastDetectedAt: r.lastDetectedAt,
        strengthenedAt: r.strengthenedAt,
      };
    };

    const weakItems = weak.map(shape);
    return {
      passPercent: WEAK_PASS_PERCENT,
      summary: {
        weakCount: weak.length,
        strengthenedCount: done.length,
        chaptersAffected: new Set(weak.map((r) => r.chapterId).filter(Boolean)).size,
      },
      weak: weakItems,
      strengthened: done.map(shape),
    };
  }

  // ---------------------------------------------------------------------------
  // one-time catch-up: build rows from the student's older wrong answers
  // ---------------------------------------------------------------------------
  private async ensureBackfill(userId: string): Promise<void> {
    if (this.backfilled.has(userId)) return;
    try {
      const have = await this.prisma.userWeakTopic.count({ where: { userId } });
      if (have === 0) {
        const rows = await this.prisma.$queryRaw<
          { subjectId: string | null; chapterId: string | null; topicId: string | null; subTopicId: string | null; wrong: bigint; total: bigint }[]
        >`
          SELECT q."subjectId" AS "subjectId", q."chapterId" AS "chapterId", q."topicId" AS "topicId", q."subTopicId" AS "subTopicId",
                 SUM(CASE WHEN aa."isCorrect" = false OR aa."selectedOption" IS NULL THEN 1 ELSE 0 END) AS wrong,
                 COUNT(*) AS total
          FROM attempt_answers aa
          JOIN test_attempts ta ON ta.id = aa."testAttemptId"
          JOIN questions q ON q.id = aa."questionId"
          WHERE ta."userId" = ${userId}
            AND ta.status = 'SUBMITTED'
            AND (q."chapterId" IS NOT NULL OR q."topicId" IS NOT NULL OR q."subTopicId" IS NOT NULL)
          GROUP BY q."subjectId", q."chapterId", q."topicId", q."subTopicId"
          HAVING SUM(CASE WHEN aa."isCorrect" = false OR aa."selectedOption" IS NULL THEN 1 ELSE 0 END) > 0
          LIMIT 400`;
        if (rows.length) {
          await this.prisma.userWeakTopic.createMany({
            skipDuplicates: true,
            data: rows.map((r) => ({
              userId,
              subjectId: r.subjectId,
              chapterId: r.chapterId,
              topicId: r.topicId,
              subTopicId: r.subTopicId,
              scopeKey: keyOf(r),
              status: 'WEAK',
              wrongCount: Number(r.wrong),
              attemptedCount: Number(r.total),
            })),
          });
        }
      }
      this.backfilled.add(userId);
    } catch (e) {
      this.logger.warn(`weak-topic backfill failed: ${(e as Error)?.message}`);
    }
  }
}
