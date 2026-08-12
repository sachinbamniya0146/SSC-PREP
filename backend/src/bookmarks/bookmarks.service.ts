// v1 Phase 2 — Bookmarks & Notes (student saves questions for revision).
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BookmarksService {
  constructor(private prisma: PrismaService) {}

  /** Toggle bookmark on a question. Returns the new state. */
  async toggle(userId: string, questionId: string) {
    const q = await this.prisma.question.findUnique({ where: { id: questionId }, select: { id: true } });
    if (!q) throw new BadRequestException('Question not found');

    const existing = await this.prisma.bookmark.findUnique({
      where: { userId_questionId: { userId, questionId } },
    });
    if (existing) {
      await this.prisma.bookmark.delete({ where: { userId_questionId: { userId, questionId } } });
      return { bookmarked: false };
    }

    // v2 §16 — entitlement guard: free users get 100 bookmarks; premium unlimited.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, subscriptions: { where: { status: 'ACTIVE' }, select: { endsAt: true }, take: 1 } },
    });
    const isPremium =
      user?.role === 'ADMIN' ||
      (user?.subscriptions?.[0] != null && new Date(user.subscriptions[0].endsAt) > new Date());
    if (!isPremium) {
      const count = await this.prisma.bookmark.count({ where: { userId } });
      if (count >= 100) {
        throw new BadRequestException(
          'Free plan: 100 bookmarks max. Remove some, or upgrade to Premium for unlimited bookmarks.',
        );
      }
    }

    await this.prisma.bookmark.create({ data: { userId, questionId } });
    return { bookmarked: true };
  }

  /** List my bookmarks with question details. */
  async list(userId: string) {
    const rows = await this.prisma.bookmark.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        question: {
          select: {
            id: true,
            questionText: true,
            questionTextHindi: true,
            optionsJson: true,
            correctAnswer: true,
            explanation: true,
            exam: { select: { name: true } },
            subject: { select: { name: true } },
            year: true,
            shift: true,
          },
        },
      },
    });
    return {
      count: rows.length,
      bookmarks: rows.map((r) => ({
        bookmarkedAt: r.createdAt,
        question: {
          id: r.question.id,
          questionText: r.question.questionText,
          questionTextHindi: r.question.questionTextHindi,
          options: Array.isArray(r.question.optionsJson)
            ? (r.question.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text }))
            : [],
          correctAnswer: r.question.correctAnswer,
          explanation: r.question.explanation,
          examName: r.question.exam?.name,
          subject: r.question.subject?.name,
          year: r.question.year,
          shift: r.question.shift,
        },
      })),
    };
  }

  /** Save a personal note on a question (upsert). */
  async saveNote(userId: string, questionId: string, content: string) {
    if (!content || !content.trim()) throw new BadRequestException('Note content is required');
    const q = await this.prisma.question.findUnique({ where: { id: questionId }, select: { id: true } });
    if (!q) throw new BadRequestException('Question not found');
    const note = await this.prisma.userNote.upsert({
      where: { userId_questionId: { userId, questionId } },
      create: { userId, questionId, noteText: content.trim() },
      update: { noteText: content.trim() },
    });
    return { note };
  }
}
