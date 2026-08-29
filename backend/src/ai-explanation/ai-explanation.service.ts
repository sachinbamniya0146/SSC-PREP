/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * v1 Phase 6-adjacent — AI Explanation lookup for a question.
 *
 * FIX (Session 6 bonus-grep item 8b, CRITICAL leak, same session that found
 * the report-error PII/answer leak): getOrGenerateExplanation() used to take
 * only a questionId and return question.explanation/explanationHindi (which
 * effectively reveal the correct answer — the explanation walks through why
 * a specific option is correct) with ZERO check on whether the calling
 * student had ever attempted that question. The controller only required
 * JwtAuthGuard, so any logged-in student could loop over questionIds and
 * pull the full step-by-step solution for the entire question bank without
 * answering a single question — completely defeating the "practice first,
 * reveal after" design that this codebase deliberately enforces everywhere
 * else (see bookmarks.service.ts's `canReveal` gate and
 * question-bank-practice.service.ts's reveal-after-answered logic).
 *
 * Fix: this service now requires the caller's userId + role.
 *   - ADMIN / MODERATOR: unrestricted (staff reviewing/authoring content).
 *   - STUDENT: only allowed once we can prove they attempted this exact
 *     question — either a scored TestAttempt (mock/sectional/daily-test,
 *     via AttemptAnswer) or a question-bank practice set whose `answers`
 *     JSON blob already contains this questionId. Same two data sources
 *     bookmarks.service.ts already trusts for this exact purpose, so the
 *     gate stays consistent across every feature that can reveal an answer.
 *   - Otherwise: ForbiddenException — no explanation, no leak.
 */
@Injectable()
export class AIExplanationService {
  constructor(private readonly prisma: PrismaService) {}

  /** True if this user has an attempt record (scored test OR bank-practice) for this question. */
  private async hasAttempted(userId: string, questionId: string): Promise<boolean> {
    const attemptAnswer = await this.prisma.attemptAnswer.findFirst({
      where: { testAttempt: { userId }, questionId },
      select: { id: true },
    });
    if (attemptAnswer) return true;

    // Bank-practice sets store answers as a { [questionId]: selectedOption } JSON blob —
    // can't filter that in SQL, so pull the user's answered sets and check in JS
    // (mirrors bookmarks.service.ts's `list()` logic exactly).
    const practiceSets = await this.prisma.questionBankSet.findMany({
      where: { userId, answers: { not: null } },
      select: { answers: true },
    });
    for (const set of practiceSets) {
      const answered = set.answers as Record<string, unknown> | null;
      if (answered && Object.prototype.hasOwnProperty.call(answered, questionId)) {
        return true;
      }
    }
    return false;
  }

  async getOrGenerateExplanation(questionId: string, userId: string, role: string, _userOpenRouterKey?: string) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: {
        id: true,
        questionText: true,
        questionTextHindi: true,
        optionsJson: true,
        correctAnswer: true,
        explanation: true,
        explanationHindi: true,
        explanationSource: true,
        subject: { select: { name: true } },
        chapter: { select: { name: true } },
        difficulty: true,
      },
    });

    if (!question) {
      throw new NotFoundException('Question not found');
    }

    const isStaff = role === 'ADMIN' || role === 'MODERATOR';
    if (!isStaff) {
      const attempted = await this.hasAttempted(userId, questionId);
      if (!attempted) {
        throw new ForbiddenException(
          'Attempt this question first (in a test, daily quiz, or question-bank practice) to unlock its AI explanation.',
        );
      }
    }

    if (question.explanation && question.explanationHindi) {
      return {
        explanation: question.explanation,
        explanationHindi: question.explanationHindi,
        stepByStepSolution: question.explanation,
        stepByStepSolutionHindi: question.explanationHindi,
        keyConcepts: [],
        keyConceptsHindi: [],
      };
    }

    throw new NotFoundException('No AI explanation available yet. Contact admin to generate.');
  }

  /**
   * Availability check stays gate-free by design — it only returns a boolean
   * (`hasExplanation`), never the explanation text or correctAnswer itself,
   * so there is nothing here for an unattempted student to leak.
   */
  async hasExplanation(questionId: string): Promise<boolean> {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { explanation: true, explanationHindi: true, explanationSource: true },
    });
    return !!(question?.explanation && question?.explanationHindi &&
      (question.explanationSource === 'AI_GENERATED' || question.explanationSource === 'HUMAN_VERIFIED'));
  }

  async getAvailableModels() {
    return ['openai/gpt-4o-mini', 'google/gemini-flash-1.5', 'meta-llama/llama-3.1-8b-instruct'];
  }
}
