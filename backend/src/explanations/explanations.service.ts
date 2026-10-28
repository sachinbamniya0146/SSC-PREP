import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Stored question explanations (read-only, no AI).
 *
 * Serves the explanation that is already saved on the `Question` row
 * (`explanation` / `explanationHindi`, written by Excel/Word upload, PDF import or the admin
 * question editor). Nothing is ever generated here.
 *
 * Answer-leak gate (kept from the old ai-explanation service): an explanation walks through
 * why one option is correct, so a STUDENT only gets it after they attempted that exact
 * question (a scored test attempt, or a question-bank practice set that already holds an
 * answer for it). ADMIN / MODERATOR are unrestricted.
 */
@Injectable()
export class ExplanationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * True if this user has an attempt record (scored test OR bank-practice) for this question.
   * Session 27: a still-RUNNING attempt does not count (autosave stores a row for any question id, so it would unlock the
   * explanation of any question during a mock) - the same rule bank.service / review.service got in session 24.
   */
  private async hasAttempted(userId: string, questionId: string): Promise<boolean> {
    const attemptAnswer = await this.prisma.attemptAnswer.findFirst({
      where: { testAttempt: { userId, status: { not: 'IN_PROGRESS' } }, questionId },
      select: { id: true },
    });
    if (attemptAnswer) return true;

    // Bank-practice sets store answers as a { [questionId]: selectedOption } JSON blob —
    // that can't be filtered in SQL, so pull the user's answered sets and check in JS.
    const practiceSets = await this.prisma.questionBankSet.findMany({
      where: { userId, answers: { not: Prisma.AnyNull } },
      select: { answers: true },
    });
    for (const set of practiceSets) {
      const answered = set.answers as Record<string, unknown> | null;
      if (answered && Object.prototype.hasOwnProperty.call(answered, questionId)) return true;
    }
    return false;
  }

  async getExplanation(questionId: string, userId: string, role: string) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { id: true, explanation: true, explanationHindi: true, explanationSource: true, correctAnswer: true },
    });
    if (!question) throw new NotFoundException('Question not found');

    const isStaff = role === 'ADMIN' || role === 'MODERATOR';
    if (!isStaff && !(await this.hasAttempted(userId, questionId))) {
      throw new ForbiddenException('Attempt this question first (in a test, daily quiz, or question-bank practice) to unlock its explanation.');
    }

    if (!question.explanation) {
      throw new NotFoundException('An explanation is not available for this question yet.');
    }

    const hi = question.explanationHindi ?? '';
    return {
      explanation: question.explanation,
      explanationHindi: hi,
      stepByStepSolution: question.explanation,
      stepByStepSolutionHindi: hi,
      keyConcepts: [] as string[],
      keyConceptsHindi: [] as string[],
      source: question.explanationSource,
      // Session 27: the right option, behind the same gate as the text (the review panel shows "Answer: C" from it when the page does not know it)
      correctAnswer: String(question.correctAnswer ?? '').trim().toUpperCase() || null,
      cached: true,
    };
  }

  /**
   * The right option of many questions at once, for the review list of a finished practice test (skipped questions have no
   * per-question result on the page). Same gate as getExplanation: a STUDENT gets the key only of a question they have an
   * attempt record for (a finished test or a bank-practice set); ADMIN / MODERATOR get every key. Unknown / locked ids are left out.
   */
  async getAnswerKeys(userId: string, role: string, questionIds: string[]): Promise<Record<string, string>> {
    const ids = Array.from(new Set((questionIds ?? []).filter((x) => typeof x === 'string' && x.length > 0))).slice(0, 200);
    if (ids.length === 0) return {};
    const isStaff = role === 'ADMIN' || role === 'MODERATOR';
    let allowed = new Set<string>(ids);
    if (!isStaff) {
      allowed = new Set<string>();
      const rows = await this.prisma.attemptAnswer.findMany({
        where: { testAttempt: { userId, status: { not: 'IN_PROGRESS' } }, questionId: { in: ids } },
        select: { questionId: true },
      });
      for (const r of rows) allowed.add(r.questionId);
      if (allowed.size < ids.length) {
        const sets = await this.prisma.questionBankSet.findMany({ where: { userId, answers: { not: Prisma.AnyNull } }, select: { answers: true } });
        for (const set of sets) {
          const answered = set.answers as Record<string, unknown> | null;
          if (!answered) continue;
          for (const id of ids) if (Object.prototype.hasOwnProperty.call(answered, id)) allowed.add(id);
        }
      }
    }
    if (allowed.size === 0) return {};
    const qs = await this.prisma.question.findMany({ where: { id: { in: Array.from(allowed) } }, select: { id: true, correctAnswer: true } });
    const out: Record<string, string> = {};
    for (const q of qs) {
      const k = String(q.correctAnswer ?? '').trim().toUpperCase();
      if (k) out[q.id] = k;
    }
    return out;
  }

  /**
   * Gate-free on purpose: returns only a boolean, never the text or the correct answer,
   * so there is nothing here for an unattempted student to leak.
   */
  async hasExplanation(questionId: string): Promise<boolean> {
    const q = await this.prisma.question.findUnique({ where: { id: questionId }, select: { explanation: true } });
    return !!q?.explanation;
  }
}
