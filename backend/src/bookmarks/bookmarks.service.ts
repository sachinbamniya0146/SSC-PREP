/* eslint-disable @typescript-eslint/no-explicit-any */
// v1 Phase 2 — Bookmarks & Notes (student saves questions for revision).
import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

    // FIX (bonus grep item a — check-then-write race, same root cause as
    // the checkIn()/coupon-maxUses bugs fixed earlier): count() and
    // create() were two separate, non-atomic statements. Two concurrent
    // bookmark requests for different questions from the same free user
    // could each read count=99, both pass the `< 100` check, and both
    // insert — pushing the user past the stated 100-bookmark cap with no
    // record of it happening. Wrapped count+create in a single Serializable
    // transaction so Postgres itself rejects one of the two concurrent
    // writes (error code P2034 — write conflict) instead of silently
    // letting both through; we retry once on that conflict, since a real
    // collision is rare and the retry re-reads the now-settled count.
    const createBookmark = () =>
      this.prisma.$transaction(
        async (tx) => {
          if (!isPremium) {
            const count = await tx.bookmark.count({ where: { userId } });
            if (count >= 100) {
              throw new BadRequestException(
                'Free plan: 100 bookmarks max. Remove some, or upgrade to Premium for unlimited bookmarks.',
              );
            }
          }
          await tx.bookmark.create({ data: { userId, questionId } });
        },
        { isolationLevel: 'Serializable' },
      );

    try {
      await createBookmark();
    } catch (err: any) {
      if (err?.code === 'P2034') {
        await createBookmark(); // retry once against the settled state
      } else {
        throw err;
      }
    }

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
        // NEW (Sep 2026) — pull each user's own note for the bookmarked
        // question (if any) in the same query, so the Bookmarks page can
        // show/edit it inline without a second round trip per question.
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

    // Notes for these exact bookmarked questions (one query, not N+1).
    const noteRows = await this.prisma.userNote.findMany({
      where: { userId, questionId: { in: rows.map((r) => r.questionId) } },
      select: { questionId: true, noteText: true, updatedAt: true },
    });
    const noteMap = new Map(noteRows.map((n) => [n.questionId, n]));

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
        // Prisma 5.x: a nullable Json column can't be filtered with a plain
        // `null` literal (TS2322) — it must be one of Prisma.DbNull /
        // Prisma.JsonNull / Prisma.AnyNull. AnyNull excludes both possible
        // "no value" representations (SQL NULL and a stored literal JSON
        // null), which is exactly the "has answers" behavior this had before.
        where: { userId, answers: { not: Prisma.AnyNull } },
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
          note: noteMap.get(r.questionId)?.noteText ?? null,
          noteUpdatedAt: noteMap.get(r.questionId)?.updatedAt ?? null,
        };
      }),
    };
  }

  /** Delete my note on a question. No-op (not an error) if there wasn't one. */
  async deleteNote(userId: string, questionId: string) {
    try {
      await this.prisma.userNote.delete({ where: { userId_questionId: { userId, questionId } } });
    } catch {
      // ok — either it never existed, or was already deleted (idempotent)
    }
    return { deleted: true };
  }

  /**
   * NEW — "Practice my bookmarks": builds a practice-style question set out
   * of everything the student has bookmarked (published questions only),
   * shuffled, capped at 50. Deliberately mirrors the shape /bank/set and
   * /sectional already send (id/questionText/options/chapter/examName/...,
   * NO correctAnswer/explanation up front) so it can be dropped straight
   * into sessionStorage's `ssc_sectional_set` and opened via
   * /test?sectional=1 like every other practice flow — the existing
   * non-authoritative /bank/attempt scoring path (test/page.tsx) then
   * handles answering, scoring and revealing the explanation per question,
   * no new code needed there.
   */
  async practiceSet(userId: string) {
    const bookmarks = await this.prisma.bookmark.findMany({
      where: { userId, question: { ...PUBLISHED_QUESTION_WHERE } },
      select: { questionId: true },
    });
    if (bookmarks.length === 0) {
      throw new BadRequestException('Koi bookmark nahi mila — pehle kuch questions bookmark karein.');
    }
    const ids = bookmarks.map((b) => b.questionId);
    // Fisher-Yates, then cap — same non-biased shuffle used by
    // question-bank-practice.service.ts's fetchQuestionsForSet().
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const chosen = ids.slice(0, 50);
    const questions = await this.prisma.question.findMany({
      where: { id: { in: chosen } },
      include: {
        chapter: { select: { name: true } },
        exam: { select: { name: true } },
        subject: { select: { name: true } },
      },
    });
    const byId = new Map(questions.map((q) => [q.id, q]));
    const ordered = chosen.map((id) => byId.get(id)).filter((q): q is NonNullable<typeof q> => Boolean(q));
    return {
      questions: ordered.map((q) => ({
        id: q.id,
        questionText: q.questionText,
        questionTextHindi: q.questionTextHindi,
        options: Array.isArray(q.optionsJson) ? (q.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text })) : [],
        chapter: q.chapter?.name ?? '',
        examName: q.exam?.name ?? null,
        subject: q.subject?.name ?? null,
        year: q.year,
        shift: q.shift,
        marks: q.marks,
        negativeMarks: q.negativeMarks,
      })),
      total: ordered.length,
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
