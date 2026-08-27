import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLISHED_QUESTION_WHERE } from '../common/question-visibility';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Chapter-wise performance analysis from all submitted attempts.
   * Returns weak (accuracy < 50%), average, and strong chapters, plus a
   * recommended next action: 25-question practice drill then 10-question test.
   */
  async analyzeChapterPerformance(userId: string) {
    const answers = await this.prisma.attemptAnswer.findMany({
      where: {
        testAttempt: { userId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
      },
      include: {
        question: { include: { chapter: { include: { subject: true } } } },
      },
    });

    const byChapter = new Map<
      string,
      { chapterId: string; chapterName: string; subjectId: string; subjectName: string; total: number; correct: number }
    >();

    for (const a of answers) {
      // v7 §4 — accuracy = wrong-answer rate on ATTEMPTED questions only;
      // skipped (no selection) questions are not evidence of weakness.
      if (!a.selectedOption) continue;
      const ch = a.question.chapter;
      if (!ch) continue; // questions without a chapter are skipped
      const key = ch.id;
      const entry = byChapter.get(key) ?? {
        chapterId: ch.id,
        chapterName: ch.name,
        subjectId: ch.subjectId,
        subjectName: ch.subject?.name ?? 'Unknown',
        total: 0,
        correct: 0,
      };
      entry.total += 1;
      if (a.isCorrect) entry.correct += 1;
      byChapter.set(key, entry);
    }

    const rows = [...byChapter.values()].map((r) => {
      const accuracy = r.total === 0 ? 0 : (r.correct / r.total) * 100;
      const strengthScore = Math.round(accuracy);
      const isWeak = accuracy < 50;
      return { ...r, accuracyPercent: Math.round(accuracy * 10) / 10, strengthScore, isWeak };
    });

    rows.sort((a, b) => a.accuracyPercent - b.accuracyPercent);

    const weak = rows.filter((r) => r.isWeak);
    const strong = rows.filter((r) => !r.isWeak);

    // Upsert WeakTopicReport rows so the frontend can show persistent weak topics
    for (const r of rows) {
      await this.prisma.weakTopicReport.upsert({
        where: { userId_chapterId: { userId, chapterId: r.chapterId } },
        create: {
          userId,
          chapterId: r.chapterId,
          subjectId: r.subjectId,
          attemptsMade: r.total,
          correctCount: r.correct,
          accuracyPercent: r.accuracyPercent,
          strengthScore: r.strengthScore,
          isWeak: r.isWeak,
        },
        update: {
          attemptsMade: r.total,
          correctCount: r.correct,
          accuracyPercent: r.accuracyPercent,
          strengthScore: r.strengthScore,
          isWeak: r.isWeak,
        },
      });
    }

    return {
      summary: {
        chaptersAttempted: rows.length,
        weakChapters: weak.length,
        strongChapters: strong.length,
      },
      weakTopics: weak.map((r) => ({
        ...r,
        action: {
          drillQuestions: 25,
          testQuestions: 10,
          message: `Your weak topic: ${r.chapterName}. Attempt 25 practice questions, then a 10-question test to strengthen it.`,
        },
      })),
      strongTopics: strong,
      allTopics: rows,
    };
  }

  /** Detail analysis for one chapter: accuracy + recommended drill. */
  async analyzeChapter(userId: string, chapterId: string) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new BadRequestException('Chapter not found');

    const attempts = await this.prisma.testAttempt.findMany({
      where: { userId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
      include: {
        answers: { include: { question: true } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 20,
    });

    const chapterAnswers = attempts
      .flatMap((t) => t.answers)
      .filter((a) => a.question.chapterId === chapterId && a.selectedOption != null); // v7 §4 — attempted only

    const total = chapterAnswers.length;
    const correct = chapterAnswers.filter((a) => a.isCorrect).length;
    const accuracy = total === 0 ? 0 : (correct / total) * 100;
    const isWeak = accuracy < 50;

    await this.prisma.weakTopicReport.upsert({
      where: { userId_chapterId: { userId, chapterId } },
      create: {
        userId,
        chapterId,
        subjectId: chapter.subjectId,
        attemptsMade: total,
        correctCount: correct,
        accuracyPercent: Math.round(accuracy * 10) / 10,
        strengthScore: Math.round(accuracy),
        isWeak,
      },
      update: {
        attemptsMade: total,
        correctCount: correct,
        accuracyPercent: Math.round(accuracy * 10) / 10,
        strengthScore: Math.round(accuracy),
        isWeak,
      },
    });

    return {
      chapterId,
      chapterName: chapter.name,
      totalAttempted: total,
      correct,
      accuracyPercent: Math.round(accuracy * 10) / 10,
      isWeak,
      recommendation: isWeak
        ? `Attempt 25 questions from ${chapter.name}, then a 10-question test to strengthen it.`
        : `Good! Keep practicing ${chapter.name} with chapter tests.`,
    };
  }

  /** Fetch the questions for a weak-chapter drill (25 Q) + follow-up test (10 Q). */
  async getWeakChapterDrill(userId: string, chapterId: string) {
    void userId;
    const questions = await this.prisma.question.findMany({
      where: { chapterId, ...PUBLISHED_QUESTION_WHERE }, // v7 §4 — approved only (never AI_DRAFT)
      take: 35,
      orderBy: { id: 'asc' },
    });
    if (questions.length === 0) {
      throw new BadRequestException('No questions available for this chapter yet');
    }
    const drill = questions.slice(0, Math.min(25, questions.length));
    const test = questions.slice(25, 25 + 10);
    const fmt = (q: (typeof questions)[number]) => {
      const opts = (q.optionsJson as Array<{ key: string; text: string; isCorrect: boolean }>) ?? [];
      return {
        id: q.id,
        q: q.questionText,
        opts: opts.map((o) => `${o.key}. ${o.text}`),
        answer: q.correctAnswer ?? null,
        explanation: q.explanation ?? q.explanationHindi ?? null,
      };
    };
    return {
      chapterId,
      drill: drill.map(fmt),
      test: test.map(fmt),
      drillCount: drill.length,
      testCount: test.length,
    };
  }
}
