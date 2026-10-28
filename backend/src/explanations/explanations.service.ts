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

  /** True if this user has an attempt record (scored test OR bank-practice) for this question. */
  private async hasAttempted(userId: string, questionId: string): Promise<boolean> {
    const attemptAnswer = await this.prisma.attemptAnswer.findFirst({
      where: { testAttempt: { userId }, questionId },
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
      select: { id: true, explanation: true, explanationHindi: true, explanationSource: true },
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
      cached: true,
    };
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
