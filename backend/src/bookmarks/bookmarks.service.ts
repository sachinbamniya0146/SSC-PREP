/* eslint-disable @typescript-eslint/no-explicit-any */
// v1 Phase 2 — Bookmarks & Notes (student saves questions for revision).
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLISHED_QUESTION_WHERE } from '../common/question-visibility';

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

  /**
   * List my bookmarks with question details.
   *
   * FIX (answer/explanation leak): previously every bookmarked question
   * unconditionally returned correctAnswer + explanation, regardless of
   * whether the student had ever actually attempted it. Since a question
   * can be bookmarked straight from browse/chapter-PYQ mode (before
   * answering anything), this let a student see the answer key for any
   * question in the bank just by tapping "bookmark" — bypassing the exact
   * "reveal only after answered/skipped/completed" gate that practice mode
   * (question-bank-practice.service.ts) enforces deliberately.
   *
   * Fix: only reveal correctAnswer/explanation for questions the student
   * has a genuine attempt record for — either a scored TestAttempt
   * (mock/sectional/daily-test, via AttemptAnswer) or an in-progress/
   * completed question-bank practice set that includes an answer for that
   * question. Everything else in the payload (question text, options,
   * exam/subject metadata) is safe to always show, since none of that is
   * the answer itself.
   *
   * Also applies PUBLISHED_QUESTION_WHERE so a question suspended after an
   * error-report can't keep surfacing (with or without the answer) in a
   * student's saved bookmarks list.
   */
  async list(userId: string) {
    const rows = await this.prisma.bookmark.findMany({
      where: { userId, question: { ...PUBLISHED_QUESTION_WHERE } },
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

    if (rows.length === 0) {
      return { count: 0, bookmarks: [] };
    }

    const questionIds = rows.map((r) => r.questionId);

    // Source 1: has the student answered this question in any scored test
    // attempt (mock / sectional / daily-test — all share AttemptAnswer)?
    const answeredInAttempts = await this.prisma.attemptAnswer.findMany({
      where: { testAttempt: { userId }, questionId: { in: questionIds } },
      select: { questionId: true },
    });
    const attemptedSet = new Set(answeredInAttempts.map((a) => a.questionId));

    // Source 2: has the student answered it inside a question-bank practice
    // set (answers is a { [questionId]: selectedOption } JSON blob)?
    if (attemptedSet.size < questionIds.length) {
      const practiceSets = await this.prisma.questionBankSet.findMany({
        where: { userId, answers: { not: null } },
        select: { answers: true },
      });
      for (const set of practiceSets) {
        const answered = set.answers as Record<string, unknown> | null;
        if (!answered) continue;
        for (const qid of questionIds) {
          if (attemptedSet.has(qid)) continue;
          if (Object.prototype.hasOwnProperty.call(answered, qid)) {
            attemptedSet.add(qid);
          }
        }
      }
    }

    return {
      count: rows.length,
      bookmarks: rows.map((r) => {
        const canReveal = attemptedSet.has(r.questionId);
        return {
          bookmarkedAt: r.createdAt,
          question: {
            id: r.question.id,
            questionText: r.question.questionText,
            questionTextHindi: r.question.questionTextHindi,
            options: Array.isArray(r.question.optionsJson)
              ? (r.question.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text }))
              : [],
            // Only present once the student has actually attempted this
            // question elsewhere — null otherwise, never sent early.
            correctAnswer: canReveal ? r.question.correctAnswer : null,
            explanation: canReveal ? r.question.explanation : null,
            attempted: canReveal,
            examName: r.question.exam?.name,
            subject: r.question.subject?.name,
            year: r.question.year,
            shift: r.question.shift,
          },
        };
      }),
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
