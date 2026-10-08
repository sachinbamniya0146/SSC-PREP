/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AiProviderService } from '../ai-provider/ai-provider.service';

/** An AI-generated solution is saved permanently once this many DISTINCT students confirmed it. */
export const AI_SOLUTION_VERIFY_THRESHOLD = 10;
/** ...and is thrown away (regenerated on next view) when this many students dispute it and they outnumber the confirmations. */
export const AI_SOLUTION_REJECT_THRESHOLD = 5;

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
 *
 * FEATURE (this session): the explanation used to just 404 with "contact
 * admin to generate" — nothing ever actually called an LLM. Now, once the
 * attempt-gate above passes, a missing explanation is generated on demand
 * via AiProviderService (user's personal OpenRouter key first — free models
 * only — then the rotating admin key pool) and written back onto the
 * `Question` row itself. Because the explanation lives on the shared
 * Question row (not per-user), the FIRST student who unlocks it generates
 * it once, and every other student who unlocks the same question afterwards
 * gets the cached copy instantly — no repeat API calls, no per-user storage.
 */
@Injectable()
export class AIExplanationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProvider: AiProviderService,
    private readonly audit: AuditLogService,
  ) {}

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
      if (answered && Object.prototype.hasOwnProperty.call(answered, questionId)) {
        return true;
      }
    }
    return false;
  }

  async getOrGenerateExplanation(questionId: string, userId: string, role: string, userOpenRouterKey?: string) {
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
        explanationModel: true,
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

    // Shared cache hit — this question's explanation was already generated
    // (by anyone, or shipped with the original PDF) and is served straight
    // from the DB, no API call.
    if (question.explanation && question.explanationHindi) {
      return {
        explanation: question.explanation,
        explanationHindi: question.explanationHindi,
        stepByStepSolution: question.explanation,
        stepByStepSolutionHindi: question.explanationHindi,
        keyConcepts: [],
        keyConceptsHindi: [],
        source: question.explanationSource,
        cached: true,
        verification: await this.verificationStatus(questionId, userId, question.explanationSource),
      };
    }

    // Nothing cached yet — generate it now and save it so every future
    // student (and this one, next time) gets it instantly from the DB.
    const personalKey = userOpenRouterKey ?? (await this.getUserOpenRouterKey(userId));
    const generated = await this.generateAndSave(question, personalKey);
    return { ...generated, cached: false, verification: await this.verificationStatus(questionId, userId, 'AI_GENERATED') };
  }

  private async getUserOpenRouterKey(userId: string): Promise<string | undefined> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { openrouterApiKey: true } });
    return user?.openrouterApiKey ?? undefined;
  }

  private buildPrompt(question: {
    questionText: string;
    questionTextHindi?: string | null;
    optionsJson: unknown;
    correctAnswer: string;
    subject?: { name: string } | null;
    chapter?: { name: string } | null;
    difficulty?: string;
  }): string {
    const options = Array.isArray(question.optionsJson)
      ? (question.optionsJson as { key: string; text: string }[])
      : [];
    const optionsText = options.map((o) => `${o.key}. ${o.text}`).join('\n');

    return `You are helping an SSC exam aspirant understand a question they already attempted.
Subject: ${question.subject?.name ?? 'General'} | Chapter: ${question.chapter?.name ?? 'N/A'} | Difficulty: ${question.difficulty ?? 'MEDIUM'}

Question: ${question.questionText}
Options:
${optionsText}

The correct answer is option ${question.correctAnswer}.

Write a clear, step-by-step explanation of why option ${question.correctAnswer} is correct (and briefly why the other options are wrong, if relevant). Keep it exam-focused and concise (under 200 words).

Respond ONLY as JSON, no markdown fences, in exactly this shape:
{
  "explanation": "step-by-step explanation in English",
  "explanationHindi": "same explanation in Hindi (Devanagari script)",
  "keyConcepts": ["short concept 1", "short concept 2"],
  "keyConceptsHindi": ["concept 1 in Hindi", "concept 2 in Hindi"]
}`;
  }

  private parseGenerated(content: string): {
    explanation: string;
    explanationHindi: string;
    keyConcepts: string[];
    keyConceptsHindi: string[];
  } {
    try {
      const cleaned = content.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.explanation && parsed.explanationHindi) {
        return {
          explanation: String(parsed.explanation),
          explanationHindi: String(parsed.explanationHindi),
          keyConcepts: Array.isArray(parsed.keyConcepts) ? parsed.keyConcepts.map(String) : [],
          keyConceptsHindi: Array.isArray(parsed.keyConceptsHindi) ? parsed.keyConceptsHindi.map(String) : [],
        };
      }
    } catch {
      // fall through to plain-text fallback below
    }
    // Model didn't return valid JSON — still save something useful rather
    // than failing the whole request over a formatting slip.
    return { explanation: content.trim(), explanationHindi: content.trim(), keyConcepts: [], keyConceptsHindi: [] };
  }

  /** Calls the AI provider, saves the result onto the shared Question row, and returns it. */
  private async generateAndSave(
    question: { id: string; questionText: string; questionTextHindi?: string | null; optionsJson: unknown; correctAnswer: string; subject?: { name: string } | null; chapter?: { name: string } | null; difficulty?: string },
    userOpenRouterKey?: string,
  ) {
    const prompt = this.buildPrompt(question);
    const result = await this.aiProvider.generate(prompt, { userApiKey: userOpenRouterKey, jsonResponse: true, feature: 'AI_EXPLANATION' });
    const parsed = this.parseGenerated(result.content);

    await this.prisma.question.update({
      where: { id: question.id },
      data: {
        explanation: parsed.explanation,
        explanationHindi: parsed.explanationHindi,
        explanationSource: 'AI_GENERATED',
        explanationModel: result.model,
        explanationGeneratedAt: new Date(),
        explanationVerifiedAt: null,
      },
    });
    // brand-new AI text => earlier confirmations/disputes were about different text
    await this.prisma.explanationVote.deleteMany({ where: { questionId: question.id } });

    return {
      explanation: parsed.explanation,
      explanationHindi: parsed.explanationHindi,
      stepByStepSolution: parsed.explanation,
      stepByStepSolutionHindi: parsed.explanationHindi,
      keyConcepts: parsed.keyConcepts,
      keyConceptsHindi: parsed.keyConceptsHindi,
      source: 'AI_GENERATED' as const,
      generatedByKey: result.source,
      model: result.model,
    };
  }

  /**
   * Admin/moderator-only "improve this answer" action: force a fresh
   * generation using the ADMIN key pool (a student's personal key is never
   * used for this — the point is the admin's own keys improving a solution
   * that's shared with everyone), overwriting whatever is currently stored
   * — including a previously AI-generated one that a staff member judged
   * as weak. This is how solutions "merge/improve over time": every
   * improvement lands on the one shared Question row every student reads.
   */
  async regenerateExplanation(questionId: string, adminId: string) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: {
        id: true,
        questionText: true,
        questionTextHindi: true,
        optionsJson: true,
        correctAnswer: true,
        subject: { select: { name: true } },
        chapter: { select: { name: true } },
        difficulty: true,
        explanation: true,
        explanationHindi: true,
      },
    });
    if (!question) throw new NotFoundException('Question not found');

    const previous = { explanation: question.explanation, explanationHindi: question.explanationHindi };
    const generated = await this.generateAndSave(question, undefined); // undefined => admin pool only, no personal key

    await this.audit.log({
      userId: adminId,
      action: 'QUESTION_EXPLANATION_REGENERATED',
      targetEntity: 'Question',
      entityId: questionId,
      metadataJson: { model: generated.model, hadPreviousExplanation: !!previous.explanation },
    });

    return generated;
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
      (question.explanationSource === 'AI_GENERATED' || question.explanationSource === 'HUMAN_VERIFIED' || question.explanationSource === 'COMMUNITY_VERIFIED'));
  }

  // ---------------------------------------------------------------------------
  // Student verification of AI-generated solutions (Oct 2026)
  // ---------------------------------------------------------------------------

  /** Vote tally + this student's own vote. Only AI solutions are votable; PDF/human ones return votable:false. */
  async verificationStatus(questionId: string, userId: string, source?: string | null) {
    const votable = source === 'AI_GENERATED' || source === 'COMMUNITY_VERIFIED';
    if (!votable) {
      return { votable: false, verified: source === 'COMMUNITY_VERIFIED' || source === 'HUMAN_VERIFIED', correct: 0, incorrect: 0, required: AI_SOLUTION_VERIFY_THRESHOLD, myVote: null as string | null };
    }
    const [grouped, mine] = await Promise.all([
      this.prisma.explanationVote.groupBy({ by: ['vote'], where: { questionId }, _count: { _all: true } }),
      this.prisma.explanationVote.findUnique({ where: { questionId_userId: { questionId, userId } }, select: { vote: true } }),
    ]);
    const count = (v: string) => grouped.find((g) => g.vote === v)?._count._all ?? 0;
    return {
      votable: true,
      verified: source === 'COMMUNITY_VERIFIED',
      correct: count('CORRECT'),
      incorrect: count('INCORRECT'),
      required: AI_SOLUTION_VERIFY_THRESHOLD,
      myVote: mine?.vote ?? null,
    };
  }

  async getVerification(questionId: string, userId: string) {
    const q = await this.prisma.question.findUnique({ where: { id: questionId }, select: { explanationSource: true } });
    if (!q) throw new NotFoundException('Question not found');
    return this.verificationStatus(questionId, userId, q.explanationSource);
  }

  /**
   * A student confirms (CORRECT) or disputes (INCORRECT) the AI solution of a question.
   *  - one vote per student, changing it just updates the row
   *  - only students who actually attempted the question can vote (same gate as reading the solution)
   *  - >= 10 distinct CORRECT votes  => solution is saved permanently (source COMMUNITY_VERIFIED)
   *  - >= 5 INCORRECT votes that outnumber CORRECT ones => the AI text is dropped; the next student who opens the
   *    solution triggers a fresh generation (and every student is asked to verify it again)
   */
  async vote(questionId: string, userId: string, role: string, vote: string) {
    const v = String(vote || '').toUpperCase();
    if (v !== 'CORRECT' && v !== 'INCORRECT') throw new BadRequestException("vote must be 'CORRECT' or 'INCORRECT'");
    if (role !== 'STUDENT') throw new BadRequestException('Only students can verify solutions. Staff: use the regenerate action.');

    const q = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { id: true, explanation: true, explanationSource: true },
    });
    if (!q) throw new NotFoundException('Question not found');
    if (!q.explanation || (q.explanationSource !== 'AI_GENERATED' && q.explanationSource !== 'COMMUNITY_VERIFIED')) {
      throw new BadRequestException('Only AI-generated solutions can be verified.');
    }
    if (!(await this.hasAttempted(userId, questionId))) {
      throw new ForbiddenException('Attempt this question first to verify its solution.');
    }

    await this.prisma.explanationVote.upsert({
      where: { questionId_userId: { questionId, userId } },
      create: { questionId, userId, vote: v },
      update: { vote: v },
    });

    // Already permanently saved: nothing more to decide, just report the tally.
    if (q.explanationSource === 'COMMUNITY_VERIFIED') {
      return this.verificationStatus(questionId, userId, 'COMMUNITY_VERIFIED');
    }

    const status = await this.verificationStatus(questionId, userId, 'AI_GENERATED');
    if (status.correct >= AI_SOLUTION_VERIFY_THRESHOLD) {
      await this.prisma.question.update({
        where: { id: questionId },
        data: { explanationSource: 'COMMUNITY_VERIFIED', explanationVerifiedAt: new Date() },
      });
      await this.audit.log({
        userId,
        action: 'AI_SOLUTION_COMMUNITY_VERIFIED',
        targetEntity: 'Question',
        entityId: questionId,
        metadataJson: { correct: status.correct, incorrect: status.incorrect },
      }).catch(() => undefined);
      return this.verificationStatus(questionId, userId, 'COMMUNITY_VERIFIED');
    }
    if (status.incorrect >= AI_SOLUTION_REJECT_THRESHOLD && status.incorrect > status.correct) {
      await this.prisma.question.update({
        where: { id: questionId },
        data: { explanation: null, explanationHindi: null, explanationVerifiedAt: null },
      });
      await this.prisma.explanationVote.deleteMany({ where: { questionId } });
      await this.audit.log({
        userId,
        action: 'AI_SOLUTION_REJECTED_BY_STUDENTS',
        targetEntity: 'Question',
        entityId: questionId,
        metadataJson: { correct: status.correct, incorrect: status.incorrect },
      }).catch(() => undefined);
      return { votable: false, verified: false, correct: 0, incorrect: 0, required: AI_SOLUTION_VERIFY_THRESHOLD, myVote: null, reset: true };
    }
    return status;
  }

  async getAvailableModels() {
    return this.aiProvider.getFreeModels();
  }
}
