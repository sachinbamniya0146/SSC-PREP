import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
   * Queue a question for review (called when a user answers a question wrong,
   * skips it, or bookmarks it for revision).
   */
  async schedule(userId: string, questionId: string, reason = 'missed') {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!question) throw new NotFoundException('Question not found');

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
      where: { userId, suspended: false, dueAt: { lte: new Date() } },
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

    return cards.map((card) => ({
      ...card,
      question: {
        ...card.question,
        optionsJson: card.question.optionsJson as Array<{
          key: string;
          text: string;
        }>,
      },
    }));
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