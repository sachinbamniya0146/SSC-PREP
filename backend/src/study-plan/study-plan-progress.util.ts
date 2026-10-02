/* eslint-disable @typescript-eslint/no-explicit-any */
// Study Plan v2 (Sep 29 2026) — turns test / practice results into per-chapter
// status for the student. Plain functions (not a Nest provider) so that
// TestsService and QuestionBankPracticeService can call them without a new
// module dependency (StudyPlanModule -> TestsModule would be circular).
//
// Rules (Sachin's spec):
//   * chapter >= 90%  (in ANY test, or a chapter-wide practice set) -> COMPLETE
//   * chapter <  90%  in the student's own scheduled Study-Plan test -> WEAK
//     ("ye weak topic he ab bhi, is chapter ko phir se practice karo")
import { PrismaService } from '../prisma/prisma.service';

export const CHAPTER_COMPLETE_PCT = 90;
export const PLAN_TEST_MIN_Q_PER_CHAPTER = 2;
export const GENERIC_TEST_MIN_Q_PER_CHAPTER = 5;

export interface ChapterVerdict {
  chapterId: string;
  name: string;
  correct: number;
  total: number;
  pct: number;
  status: 'COMPLETE' | 'WEAK' | 'UNVERIFIED';
}

export async function applyAttemptToChapters(prisma: PrismaService, userId: string, attemptId: string): Promise<ChapterVerdict[] | null> {
  const attempt = await prisma.testAttempt.findFirst({
    where: { id: attemptId, userId, status: 'SUBMITTED' },
    select: { id: true, questionSnapshot: true, answers: { select: { questionId: true, isCorrect: true } } },
  });
  if (!attempt) return null;

  const planTest = await prisma.studyPlanTest.findFirst({ where: { userId, attemptId } });
  if (planTest?.status === 'SUBMITTED') return (planTest.resultJson as any) ?? [];

  const snapshot = Array.isArray(attempt.questionSnapshot) ? (attempt.questionSnapshot as string[]) : [];
  const answerMap = new Map(attempt.answers.map((a) => [a.questionId, a.isCorrect]));
  const qIds = snapshot.length ? snapshot : attempt.answers.map((a) => a.questionId);
  if (!qIds.length) return null;

  const questions = await prisma.question.findMany({
    where: { id: { in: qIds } },
    select: { id: true, chapterId: true, chapter: { select: { name: true } } },
  });

  const per = new Map<string, { name: string; correct: number; total: number }>();
  let totalCorrect = 0;
  for (const q of questions) {
    const isCorrect = !!answerMap.get(q.id);
    if (isCorrect) totalCorrect++;
    if (!q.chapterId) continue;
    const e = per.get(q.chapterId) ?? { name: q.chapter?.name ?? '', correct: 0, total: 0 };
    e.total++;
    if (isCorrect) e.correct++;
    per.set(q.chapterId, e);
  }

  const now = new Date();
  const minQ = planTest ? PLAN_TEST_MIN_Q_PER_CHAPTER : GENERIC_TEST_MIN_Q_PER_CHAPTER;
  const verdicts: ChapterVerdict[] = [];

  for (const [chapterId, e] of per) {
    const pct = e.total ? Math.round((e.correct / e.total) * 100) : 0;
    if (e.total < minQ) {
      // Oct 2026: too few questions to judge. Previously the chapter stayed SELF_MARKED forever
      // (never verified, never re-tested). Put it back to PENDING so the student can mark/test it again.
      if (planTest) {
        await prisma.studyPlanChapter.updateMany({
          where: { userId, chapterId, status: 'SELF_MARKED' },
          data: { status: 'PENDING', lastTestedAt: now },
        });
      }
      verdicts.push({ chapterId, name: e.name, correct: e.correct, total: e.total, pct, status: 'UNVERIFIED' });
      continue;
    }
    const existing = await prisma.studyPlanChapter.findUnique({ where: { userId_chapterId: { userId, chapterId } } });
    const scoreFields = { lastScorePct: pct, lastTestedAt: now };

    if (pct >= CHAPTER_COMPLETE_PCT) {
      await prisma.studyPlanChapter.upsert({
        where: { userId_chapterId: { userId, chapterId } },
        create: { userId, chapterId, status: 'COMPLETE', completedAt: now, ...scoreFields },
        update: { status: 'COMPLETE', completedAt: now, ...scoreFields },
      });
      verdicts.push({ chapterId, name: e.name, correct: e.correct, total: e.total, pct, status: 'COMPLETE' });
    } else if (planTest || existing?.status === 'SELF_MARKED') {
      // Below 90% in the verification test -> un-mark and flag as weak.
      await prisma.studyPlanChapter.upsert({
        where: { userId_chapterId: { userId, chapterId } },
        create: { userId, chapterId, status: 'WEAK', ...scoreFields },
        update: { status: 'WEAK', completedAt: null, ...scoreFields },
      });
      verdicts.push({ chapterId, name: e.name, correct: e.correct, total: e.total, pct, status: 'WEAK' });
    } else {
      if (existing) {
        await prisma.studyPlanChapter.update({ where: { id: existing.id }, data: scoreFields });
      }
      verdicts.push({ chapterId, name: e.name, correct: e.correct, total: e.total, pct, status: 'UNVERIFIED' });
    }
  }

  if (planTest) {
    const overall = qIds.length ? Math.round((totalCorrect / qIds.length) * 100) : 0;
    await prisma.studyPlanTest.update({
      where: { id: planTest.id },
      data: { status: 'SUBMITTED', submittedAt: now, scorePct: overall, resultJson: verdicts as any },
    });
  }
  return verdicts;
}

/** A chapter-wide practice set scored >= 90% marks the chapter COMPLETE (never downgrades). */
export async function markChapterFromPractice(prisma: PrismaService, userId: string, chapterId: string, scorePct: number): Promise<void> {
  if (!chapterId || scorePct < CHAPTER_COMPLETE_PCT) return;
  const now = new Date();
  await prisma.studyPlanChapter.upsert({
    where: { userId_chapterId: { userId, chapterId } },
    create: { userId, chapterId, status: 'COMPLETE', completedAt: now, lastScorePct: Math.round(scorePct), lastTestedAt: now },
    update: { status: 'COMPLETE', completedAt: now, lastScorePct: Math.round(scorePct), lastTestedAt: now },
  });
}
