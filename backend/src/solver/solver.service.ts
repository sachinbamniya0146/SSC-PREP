/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { solveQuestion, SolveResult, SolverOption } from './solver-engine';

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

  // AI Doubt Solver Chat
  async askDoubt(userId: string, body: {
    questionId?: string;
    questionText?: string;
    questionTextHindi?: string;
    options?: { key: string; text: string; textHi?: string }[];
    language?: 'en' | 'hi' | 'both';
  }) {
    const { questionId, questionText, questionTextHindi, options, language = 'both' } = body;
    
    let q = null;
    let opts = options ?? [];
    
    if (questionId) {
      q = await this.prisma.question.findUnique({ where: { id: questionId } });
      if (q) {
        opts = (q.optionsJson as { key: string; text: string; isCorrect?: boolean }[]) ?? [];
      }
    }
    
    // If no question from DB, use provided text/options
    const text = questionText ?? q?.questionText ?? '';
    const optsForSolver = opts.map(o => ({ key: o.key, text: o.text }));
    
    const result = solveQuestion(text, optsForSolver);
    
    // Build step-by-step explanation
    let explanation = '';
    let explanationHindi = '';
    
    if (result.solved) {
      const correctOpt = optsForSolver.find(o => o.key === result.optionKey);
      explanation = `**Step-by-step solution:**\n\n`;
      explanation += `${result.evidence}\n\n`;
      explanation += `✅ **Correct Answer: ${result.optionKey}**. ${correctOpt?.text ?? ''}`;
      
      if (language !== 'en') {
        explanationHindi = `**चरण-दर-चरण समाधान:**\n\n`;
        explanationHindi += `${result.evidence}\n\n`;
        explanationHindi += `✅ **सही उत्तर: ${result.optionKey}**. ${correctOpt?.text ?? ''}`;
      }
    } else {
      explanation = `**Could not solve deterministically.**\n\nReason: ${result.reason ?? 'No matching pattern found.'}\n\nFor such questions, please refer to the official explanation or ask a teacher.`;
      
      if (language !== 'en') {
        explanationHindi = `**निश्चित रूप से हल नहीं हो सका।**\n\nकारण: ${result.reason ?? 'कोई मिलान वाला पैटर्न नहीं मिला।'}\n\nऐसे प्रश्नों के लिए, कृपया आधिकारिक व्याख्या देखें या शिक्षक से पूछें।`;
      }
    }
    
    return {
      solved: result.solved,
      answer: result.optionKey,
      explanation,
      explanationHindi: language === 'both' ? explanationHindi : (language === 'hi' ? explanationHindi : undefined),
      confidence: result.solved ? 0.95 : 0,
    };
  }

  getSupportedPatterns() {
    return [
      { pattern: 'arithmetic', description: 'Basic arithmetic operations (add, subtract, multiply, divide)' },
      { pattern: 'percentage', description: 'Percentage calculations and word problems' },
      { pattern: 'ratio_proportion', description: 'Ratio and proportion problems' },
      { pattern: 'time_work', description: 'Time and work problems' },
      { pattern: 'speed_distance', description: 'Speed, distance, time problems' },
      { pattern: 'profit_loss', description: 'Profit and loss calculations' },
      { pattern: 'simple_interest', description: 'Simple interest calculations' },
      { pattern: 'compound_interest', description: 'Compound interest calculations' },
      { pattern: 'average', description: 'Average/mean calculations' },
      { pattern: 'age', description: 'Age-related word problems' },
      { pattern: 'calendar', description: 'Calendar and date problems' },
      { pattern: 'direction_sense', description: 'Direction and distance reasoning' },
      { pattern: 'blood_relations', description: 'Blood relation logical reasoning' },
      { pattern: 'coding_decoding', description: 'Coding-decoding patterns' },
      { pattern: 'series_number', description: 'Number series completion' },
      { pattern: 'series_letter', description: 'Letter/alphabet series' },
      { pattern: 'analogy', description: 'Verbal and non-verbal analogies' },
      { pattern: 'classification', description: 'Odd one out / classification' },
      { pattern: 'syllogism', description: 'Logical syllogisms (Venn diagram based)' },
      { pattern: 'venn_diagram', description: 'Venn diagram problems' },
      { pattern: 'sitting_arrangement', description: 'Linear/circular seating arrangements' },
      { pattern: 'ranking', description: 'Ranking and ordering problems' },
      { pattern: 'puzzle', description: 'Logical puzzles (Einstein/grid type)' },
      { pattern: 'cube_dice', description: 'Cube and dice visualization' },
      { pattern: 'mirror_water_image', description: 'Mirror and water image reasoning' },
      { pattern: 'paper_folding', description: 'Paper cutting and folding' },
      { pattern: 'embedded_figures', description: 'Embedded figure detection' },
      { pattern: 'completion_figures', description: 'Figure completion/series' },
      { pattern: 'counting_figures', description: 'Counting squares/triangles/rectangles' },
    ];
  }
}