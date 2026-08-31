import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLISHED_QUESTION_WHERE } from '../common/question-visibility';

// SM-2 inspired intervals: 1d → 3d → 7d → 14d → 30d
const INTERVALS = [1, 3, 7, 14, 30];

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

interface ReviewCardData {
  id: string;
  questionId: string;
  easeFactor: number;
  repetitions: number;
  intervalDays: number;
  dueAt: Date;
  lapses: number;
  suspended: boolean;
}

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * FIX (side-door answer-key leak — bonus grep, item b):
   *
   * `POST /review/schedule` took an arbitrary `questionId` from any logged-in
   * student with no check that they had ever attempted it, and the client
   * even supplies its own `reason` string ('manual' by default) — which is
   * NOT a trustworthy signal since the client controls it entirely. A
   * student could loop over every question ID in the bank, call this
   * endpoint for each, then read `GET /review/due` to get back
   * correctAnswer + explanation + explanationHindi for the entire question
   * bank — completely bypassing the "reveal only after answered/skipped"
   * gate that question-bank-practice.service.ts and bookmarks.service.ts
   * both deliberately enforce.
   *
   * Fix: `schedule()` now requires genuine proof the user has actually
   * attempted this exact question, checked against every place an attempt
   * can be recorded in this codebase:
   *   1. AttemptAnswer (mock / sectional / daily-test attempts)
   *   2. QuestionBankSet.answers (question-bank practice mode)
   *   3. A submitted DailyQuizAttempt for a DailyQuiz whose questionsJson
   *      includes this question (daily quiz has no per-question answer
   *      rows, only an aggregate score — this is the coarsest-but-still-
   *      real proof available, and it's no wider than what the daily quiz
   *      result screen already reveals right after submission).
   * This applies to EVERY caller, including the internal call from
   * quiz.service.ts — that call always has DailyQuizAttempt proof by the
   * time it runs (the attempt row is upserted first), so legitimate
   * auto-scheduling keeps working unchanged; only unearned manual
   * scheduling is now rejected.
   *
   * `due()` re-checks the same proof at read time (defense in depth) so
   * any review card that slipped in before this fix — or via a bug
   * somewhere else in the future — still can't leak an answer key it
   * hasn't earned.
   */
  private async getAttemptedQuestionIds(userId: string, questionIds: string[]): Promise<Set<string>> {
    if (questionIds.length === 0) return new Set();
    const attempted = new Set<string>();

    const fromAttempts = await this.prisma.attemptAnswer.findMany({
      where: { testAttempt: { userId }, questionId: { in: questionIds } },
      select: { questionId: true },
    });
    for (const a of fromAttempts) attempted.add(a.questionId);

    if (attempted.size < questionIds.length) {
      const sets = await this.prisma.questionBankSet.findMany({
        // Prisma 5.x: a nullable Json column can't be filtered with a plain
        // `null` literal (TS2322) — it must be one of Prisma.DbNull /
        // Prisma.JsonNull / Prisma.AnyNull. AnyNull excludes both possible
        // "no value" representations (SQL NULL and a stored literal JSON
        // null), which is exactly the "has answers" behavior this had before.
        where: { userId, answers: { not: Prisma.AnyNull } },
        select: { answers: true },
      });
      for (const set of sets) {
        const answered = set.answers as Record<string, unknown> | null;
        if (!answered) continue;
        for (const qid of questionIds) {
          if (!attempted.has(qid) && Object.prototype.hasOwnProperty.call(answered, qid)) {
            attempted.add(qid);
          }
        }
      }
    }

    if (attempted.size < questionIds.length) {
      const dailyAttempts = await this.prisma.dailyQuizAttempt.findMany({
        where: { userId, submittedAt: { not: null } },
        select: { dailyQuiz: { select: { questionsJson: true } } },
      });
      for (const da of dailyAttempts) {
        const ids = Array.isArray(da.dailyQuiz?.questionsJson) ? (da.dailyQuiz!.questionsJson as string[]) : [];
        for (const qid of questionIds) {
          if (!attempted.has(qid) && ids.includes(qid)) attempted.add(qid);
        }
      }
    }

    return attempted;
  }

  /**
   * Queue a question for review (called when a user answers a question wrong,
   * skips it, or bookmarks it for revision).
   */
  async schedule(userId: string, questionId: string, reason = 'missed') {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!question) throw new NotFoundException('Question not found');

    // See class-level FIX comment above the private helper — proof of an
    // actual attempt is required regardless of the caller-supplied `reason`.
    const attempted = await this.getAttemptedQuestionIds(userId, [questionId]);
    if (!attempted.has(questionId)) {
      throw new BadRequestException('Attempt this question first before adding it to your review queue');
    }

    const existing = await this.prisma.reviewCard.findUnique({
      where: { userId_questionId: { userId, questionId } },
    });

    if (existing) {
      // Already queued: refresh the due date (re-schedule from today) but keep
      // interval history. If the card was suspended, re-activate it.
      return this.prisma.reviewCard.update({
        where: { id: existing.id },
        data: {
          dueAt: new Date(),
          suspended: false,
          lapses: { increment: 1 },
          updatedAt: new Date(),
        },
      });
    }

    const card = this.prisma.reviewCard.create({
      data: {
        userId,
        questionId,
        dueAt: new Date(),
        intervalDays: 1,
        easeFactor: 2.5,
        repetitions: 0,
        lapses: 1,
      },
    });
    this.logger.log(`Queued ${questionId} for ${userId} (${reason})`);
    return card;
  }

  /**
   * List due review cards for the user, oldest first, with the question data.
   */
  async due(userId: string, limit = 20) {
    const cards = await this.prisma.reviewCard.findMany({
      where: { userId, suspended: false, dueAt: { lte: new Date() }, question: { ...PUBLISHED_QUESTION_WHERE } },
      include: {
        question: {
          select: {
            id: true,
            questionText: true,
            questionTextHindi: true,
            optionsJson: true,
            correctAnswer: true,
            explanation: true,
            explanationHindi: true,
            videoUrl: true,
            videoTitle: true,
            subjectId: true,
            chapterId: true,
            topicId: true,
          },
        },
      },
      orderBy: { dueAt: 'asc' },
      take: limit,
    });

    if (cards.length === 0) return [];

    // Defense in depth — re-verify attempt-proof at read time too, so any
    // review card that exists without it (e.g. created before this fix
    // shipped) still can't hand back an unearned answer key.
    const attempted = await this.getAttemptedQuestionIds(userId, cards.map((c) => c.questionId));

    return cards.map((card) => {
      const canReveal = attempted.has(card.questionId);
      return {
        ...card,
        question: {
          ...card.question,
          optionsJson: card.question.optionsJson as Array<{
            key: string;
            text: string;
          }>,
          correctAnswer: canReveal ? card.question.correctAnswer : null,
          explanation: canReveal ? card.question.explanation : null,
          explanationHindi: canReveal ? card.question.explanationHindi : null,
        },
      };
    });
  }

  /**
   * List cards scheduled for the future (upcoming reviews).
   */
  async upcoming(userId: string, limit = 20) {
    const cards = await this.prisma.reviewCard.findMany({
      where: { userId, suspended: false, dueAt: { gt: new Date() } },
      orderBy: { dueAt: 'asc' },
      take: limit,
      select: { id: true, questionId: true, dueAt: true, intervalDays: true },
    });
    return cards;
  }

  /**
   * Record a review attempt and compute the next interval (SM-2 style).
   */
  async grade(userId: string, cardId: string, grade: ReviewGrade) {
    if (!['again', 'hard', 'good', 'easy'].includes(grade)) {
      throw new BadRequestException('Invalid grade');
    }

    const card = (await this.prisma.reviewCard.findFirst({
      where: { id: cardId, userId },
    })) as ReviewCardData | null;
    if (!card) throw new NotFoundException('Review card not found');

    let { easeFactor, repetitions, intervalDays, lapses } = card;
    const now = new Date();

    switch (grade) {
      case 'again':
        // Forgotten: reset to interval 1, ease factor drops
        repetitions = 0;
        intervalDays = 1;
        easeFactor = Math.max(1.3, easeFactor - 0.2);
        lapses += 1;
        break;
      case 'hard':
        intervalDays = Math.max(1, Math.round(intervalDays * 1.2));
        easeFactor = Math.max(1.3, easeFactor - 0.15);
        repetitions += 1;
        break;
      case 'good':
        easeFactor = Math.max(1.3, easeFactor + 0.0);
        repetitions += 1;
        intervalDays =
          grade === 'good' && repetitions >= 2
            ? INTERVALS[Math.min(repetitions - 1, INTERVALS.length - 1)]
            : 1;
        break;
      case 'easy':
        easeFactor = Math.min(3.0, easeFactor + 0.15);
        repetitions += 1;
        intervalDays = INTERVALS[Math.min(repetitions, INTERVALS.length - 1)];
        break;
    }

    const dueAt = new Date(now.getTime() + intervalDays * 86400 * 1000);

    return this.prisma.reviewCard.update({
      where: { id: card.id },
      data: {
        easeFactor,
        repetitions,
        intervalDays,
        dueAt,
        lapses,
        updatedAt: now,
      },
    });
  }

  async stats(userId: string) {
    const [dueCount, totalCards, upcomingCount] = await Promise.all([
      this.prisma.reviewCard.count({
        where: { userId, suspended: false, dueAt: { lte: new Date() } },
      }),
      this.prisma.reviewCard.count({ where: { userId } }),
      this.prisma.reviewCard.count({
        where: { userId, suspended: false, dueAt: { gt: new Date() } },
      }),
    ]);
    return { dueCount, totalCards, upcomingCount };
  }
}
