import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { solveQuestion, SolveResult } from './solver-engine';

@Injectable()
export class SolverService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogService,
  ) {}

  /** Run the deterministic engine on one question. Never LLM-guesses. */
  private async derive(questionId: string) {
    const q = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!q) throw new NotFoundException('Question not found');
    const options = Array.isArray(q.optionsJson)
      ? (q.optionsJson as { key: string; text: string; isCorrect?: boolean }[])
      : [];
    const result: SolveResult = solveQuestion(q.questionText, options);
    let optionText: string | null = null;
    if (result.solved && result.optionKey) {
      optionText = options.find((o) => o.key === result.optionKey)?.text ?? null;
    }
    return { q, options, result, optionText };
  }

  /**
   * Re-derive one question. On unambiguous deterministic solution:
   *  - computed == stored correctAnswer → status VERIFIED_COMPUTED + evidence
   *  - computed != stored → status left untouched (admin decides; mismatch surfaced)
   */
  async recompute(questionId: string, adminId: string) {
    const { q, options, result, optionText } = await this.derive(questionId);

    if (!result.solved) {
      return {
        questionId,
        solved: false,
        reason: result.reason ?? 'no deterministic pattern matched',
        status: q.answerVerificationStatus,
        options: options.map((o) => ({ key: o.key, text: o.text })),
      };
    }

    const matchesStored = result.optionKey === q.correctAnswer;
    if (matchesStored) {
      const updated = await this.prisma.question.update({
        where: { id: questionId },
        data: {
          answerVerificationStatus: 'VERIFIED_COMPUTED',
          lastVerifiedAt: new Date(),
          verificationEvidence: result.evidence,
        },
      });
      await this.audit.log({
        userId: adminId,
        action: 'QUESTION_VERIFIED_COMPUTED',
        targetEntity: 'Question',
        entityId: questionId,
        metadataJson: {
          computedOptionKey: result.optionKey,
          computedText: optionText,
          evidence: result.evidence,
        },
      });
      return {
        questionId,
        solved: true,
        matchesStored: true,
        optionKey: result.optionKey,
        optionText,
        evidence: result.evidence,
        status: updated.answerVerificationStatus,
      };
    }

    // deterministic computation disagrees with stored key — do NOT auto-change
    return {
      questionId,
      solved: true,
      matchesStored: false,
      computedOptionKey: result.optionKey,
      computedText: optionText,
      storedAnswerKey: q.correctAnswer,
      storedAnswerText: options.find((o) => o.key === q.correctAnswer)?.text ?? null,
      evidence: result.evidence,
      status: q.answerVerificationStatus,
      warning: 'Deterministic re-derivation disagrees with the stored answer key. Review manually (consider DISPUTED).',
    };
  }

  /**
   * Batch re-derive. Filters: explicit ids, or examId/chapterId + limit (cap 500).
   * Sequential to keep DB/CPU stable; returns per-question summary with counts.
   */
  async recomputeBatch(
    adminId: string,
    input: { questionIds?: string[]; examId?: string; chapterId?: string; limit?: number },
  ) {
    const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
    let questions: { id: string }[];
    if (input.questionIds?.length) {
      questions = await this.prisma.question.findMany({
        where: { id: { in: input.questionIds.slice(0, 500) } },
        select: { id: true },
      });
    } else {
      const where: Record<string, unknown> = {
        isApproved: true,
        isActive: true,
        answerVerificationStatus: { notIn: ['VERIFIED_COMPUTED', 'VERIFIED_OFFICIAL'] },
      };
      if (input.examId) where.examId = input.examId;
      if (input.chapterId) where.chapterId = input.chapterId;
      questions = await this.prisma.question.findMany({
        where,
        select: { id: true },
        take: limit,
      });
    }
    if (questions.length === 0) {
      return { processed: 0, verified: 0, mismatch: 0, unsolved: 0, results: [] };
    }

    const results: unknown[] = [];
    let verified = 0;
    let mismatch = 0;
    let unsolved = 0;
    for (const { id } of questions) {
      try {
        const r: any = await this.recompute(id, adminId);
        if (!r.solved) unsolved++;
        else if (r.matchesStored) verified++;
        else mismatch++;
        results.push(r);
      } catch {
        unsolved++;
        results.push({ questionId: id, solved: false, reason: 'error during derivation' });
      }
    }
    return {
      processed: questions.length,
      verified,
      mismatch,
      unsolved,
      results,
    };
  }
}