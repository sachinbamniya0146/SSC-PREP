/* eslint-disable @typescript-eslint/no-explicit-any */
// v1 Phase 2 — Bookmarks & Notes (student saves questions for revision).
import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLISHED_QUESTION_WHERE } from '../common/question-visibility';
import { FeaturesService } from '../features/features.service';
import { FREE_BOOKMARK_LIMIT } from '../common/free-limits';

export interface BookmarkListQuery {
  limit?: number;
  offset?: number;
  subjectId?: string;
  q?: string;
  /** only questions the student got wrong (or skipped) the last time they saw them in a test */
  wrongOnly?: boolean;
}

@Injectable()
export class BookmarksService {
  constructor(
    private prisma: PrismaService,
    private features: FeaturesService,
  ) {}

  /** Every bookmarked question id of this student (no paging) - the test screen and the review paint their stars from it. */
  async ids(userId: string) {
    const rows = await this.prisma.bookmark.findMany({ where: { userId }, select: { questionId: true }, take: 20000 });
    return { ids: rows.map((r) => r.questionId) };
  }

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
    // Feature controller: removing is always allowed, adding follows the admin's switch.
    await this.features.assertEnabled('bookmarks');

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
            if (count >= FREE_BOOKMARK_LIMIT) {
              throw new BadRequestException(
                `Free plan: ${FREE_BOOKMARK_LIMIT} bookmarks max. Remove some, or upgrade to Premium for unlimited bookmarks.`,
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
   * List my bookmarks with question details (paged: `limit` <= 100, `offset`; optional subject / text / wrong-only filters).
   *
   * FIX (answer/explanation leak): the answer + explanation of a bookmarked question are revealed only once the student
   * has a genuine FINISHED attempt record for it - a submitted test / sectional / daily test (AttemptAnswer) or a
   * question-bank practice set that includes an answer. An attempt that is still IN_PROGRESS does NOT count: before this
   * fix a student could bookmark a question in the middle of a live exam, open the Bookmarks page in a second tab and
   * read the key. Also applies PUBLISHED_QUESTION_WHERE so a question suspended after an error-report can't keep
   * surfacing in a student's saved list.
   *
   * 29 Oct 2026: the old hard cap of 100 rows (silently hiding everything older, even for premium students) is gone;
   * each row now carries the real paper question number, the student's last answer and where it came from.
   */
  async list(userId: string, query: BookmarkListQuery = {}) {
    const limit = Math.min(Math.max(Math.floor(query.limit ?? 50), 1), 100);
    const offset = Math.max(Math.floor(query.offset ?? 0), 0);

    const questionWhere: Prisma.QuestionWhereInput = { ...PUBLISHED_QUESTION_WHERE };
    if (query.subjectId) questionWhere.subjectId = query.subjectId;
    const text = (query.q ?? '').trim();
    if (text) {
      const or: Prisma.QuestionWhereInput[] = [
        { questionText: { contains: text, mode: 'insensitive' } },
        { questionTextHindi: { contains: text, mode: 'insensitive' } },
        { chapter: { name: { contains: text, mode: 'insensitive' } } },
        { topic: { name: { contains: text, mode: 'insensitive' } } },
      ];
      if (/^\d{1,9}$/.test(text)) or.push({ questionNo: Number(text) }, { paperQuestionNo: Number(text) });
      questionWhere.OR = or;
    }

    // "Wrong in my last test": narrow to the questions whose latest finished attempt was wrong / skipped.
    if (query.wrongOnly) {
      const mine = await this.prisma.bookmark.findMany({ where: { userId }, select: { questionId: true }, take: 20000 });
      const latest = await this.latestAnswers(userId, mine.map((m) => m.questionId));
      const wrongIds = [...latest.entries()].filter(([, a]) => !a.isCorrect).map(([id]) => id);
      questionWhere.id = { in: wrongIds };
    }

    const where: Prisma.BookmarkWhereInput = { userId, question: questionWhere };
    const [total, rows, facetRows] = await Promise.all([
      this.prisma.bookmark.count({ where }),
      this.prisma.bookmark.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          question: {
            select: {
              id: true,
              questionNo: true,
              paperQuestionNo: true,
              questionText: true,
              questionTextHindi: true,
              questionDiagramType: true,
              questionDiagramLabels: true,
              questionImageUrl: true,
              optionsJson: true,
              correctAnswer: true,
              explanation: true,
              explanationHindi: true,
              exam: { select: { name: true } },
              subject: { select: { name: true } },
              chapter: { select: { name: true } },
              topic: { select: { name: true } },
              year: true,
              shift: true,
              examDate: true,
              examTier: true,
            },
          },
        },
      }),
      // subject chips for the filter bar (all bookmarks, not only this page)
      this.prisma.bookmark.findMany({
        where: { userId, question: { ...PUBLISHED_QUESTION_WHERE } },
        select: { question: { select: { subjectId: true, subject: { select: { name: true } } } } },
        take: 20000,
      }),
    ]);

    const subjectCounts = new Map<string, { id: string; name: string; count: number }>();
    for (const f of facetRows) {
      const id = f.question.subjectId;
      const cur = subjectCounts.get(id) ?? { id, name: f.question.subject?.name ?? 'Other', count: 0 };
      cur.count += 1;
      subjectCounts.set(id, cur);
    }
    const subjects = [...subjectCounts.values()].sort((a, b) => b.count - a.count);

    if (rows.length === 0) {
      return { count: 0, total, offset, limit, hasMore: false, subjects, bookmarks: [] };
    }

    // Notes for these exact bookmarked questions (one query, not N+1).
    const questionIds = rows.map((r) => r.questionId);
    const noteRows = await this.prisma.userNote.findMany({
      where: { userId, questionId: { in: questionIds } },
      select: { questionId: true, noteText: true, updatedAt: true },
    });
    const noteMap = new Map(noteRows.map((n) => [n.questionId, n]));

    // Source 1: finished test attempts (mock / sectional / daily-test share AttemptAnswer) - with the student's own last answer.
    const latest = await this.latestAnswers(userId, questionIds);
    const attemptedSet = new Set(latest.keys());

    // Source 2: has the student answered it inside a question-bank practice set
    // (answers is a { [questionId]: selectedOption } JSON blob)?
    if (attemptedSet.size < questionIds.length) {
      const practiceSets = await this.prisma.questionBankSet.findMany({
        // Prisma 5.x: a nullable Json column can't be filtered with a plain `null` literal (TS2322) - AnyNull excludes both
        // "no value" representations (SQL NULL and a stored literal JSON null).
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
      total,
      offset,
      limit,
      hasMore: offset + rows.length < total,
      subjects,
      bookmarks: rows.map((r) => {
        const canReveal = attemptedSet.has(r.questionId);
        const mine = latest.get(r.questionId) ?? null;
        return {
          bookmarkedAt: r.createdAt,
          question: {
            id: r.question.id,
            // the global serial (used when reporting an error) and the number printed in the real paper
            questionNo: r.question.questionNo,
            paperQuestionNo: r.question.paperQuestionNo ?? null,
            questionText: r.question.questionText,
            questionTextHindi: r.question.questionTextHindi,
            questionDiagramType: (r.question as any).questionDiagramType ?? null,
            questionDiagramLabels: (r.question as any).questionDiagramLabels ?? null,
            questionImageUrl: (r.question as any).questionImageUrl ?? null,
            options: Array.isArray(r.question.optionsJson)
              ? (r.question.optionsJson as any[]).map((o: any) => ({
                  key: o.key,
                  text: o.text,
                  textHi: o.textHi ?? null,
                  diagramType: o.diagramType ?? null,
                  diagramLabels: o.diagramLabels ?? null,
                  imageUrl: o.imageUrl ?? null,
                }))
              : [],
            // Only present once the student has actually attempted this question elsewhere - null otherwise, never sent early.
            correctAnswer: canReveal ? r.question.correctAnswer : null,
            explanation: canReveal ? r.question.explanation : null,
            explanationHindi: canReveal ? r.question.explanationHindi : null,
            attempted: canReveal,
            examName: r.question.exam?.name,
            subject: r.question.subject?.name,
            chapter: r.question.chapter?.name ?? null,
            topic: r.question.topic?.name ?? null,
            year: r.question.year,
            shift: r.question.shift,
            examDate: r.question.examDate ?? null,
            examTier: r.question.examTier ?? null,
          },
          // What the student answered the last time (finished tests only) - lets the page say "you marked B, correct is C".
          myAnswer: mine ? { selectedOption: mine.selectedOption, isCorrect: mine.isCorrect, attemptId: mine.attemptId } : null,
          note: noteMap.get(r.questionId)?.noteText ?? null,
          noteUpdatedAt: noteMap.get(r.questionId)?.updatedAt ?? null,
        };
      }),
    };
  }

  /** Latest answer per question from FINISHED attempts only (an attempt still running never counts). */
  private async latestAnswers(userId: string, questionIds: string[]) {
    const out = new Map<string, { selectedOption: string | null; isCorrect: boolean; attemptId: string }>();
    if (questionIds.length === 0) return out;
    const rows = await this.prisma.attemptAnswer.findMany({
      where: { questionId: { in: questionIds }, testAttempt: { userId, status: { not: 'IN_PROGRESS' } } },
      orderBy: { testAttempt: { startedAt: 'desc' } },
      select: { questionId: true, selectedOption: true, isCorrect: true, testAttemptId: true },
      take: 20000,
    });
    for (const r of rows) {
      if (!out.has(r.questionId)) out.set(r.questionId, { selectedOption: r.selectedOption, isCorrect: r.isCorrect, attemptId: r.testAttemptId });
    }
    return out;
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
  async practiceSet(userId: string, subjectId?: string) {
    const bookmarks = await this.prisma.bookmark.findMany({
      where: { userId, question: { ...PUBLISHED_QUESTION_WHERE, ...(subjectId ? { subjectId } : {}) } },
      select: { questionId: true },
    });
    if (bookmarks.length === 0) {
      throw new BadRequestException('No bookmarks found — bookmark some questions first.');
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
