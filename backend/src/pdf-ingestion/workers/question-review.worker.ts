/* eslint-disable @typescript-eslint/no-explicit-any */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

interface ReviewQuestionData {
  questionId: string;
  batchId: string;
  sourceText: string;
  confidence: number;
}

// v5 §37.1 / v3 §6.3 — same two hard publish-gates that
// pdf-ingestion.service.ts's approveQuestion()/bulkApproveQuestions() enforce
// for the admin approval path. Duplicated here (not imported) to keep this
// worker decoupled from PdfIngestionService; keep both lists in sync if the
// gate rules ever change.
const VERIFIED_STATUSES = new Set(['VERIFIED_OFFICIAL', 'VERIFIED_MULTI_SOURCE', 'VERIFIED_COMPUTED']);

/**
 * v1 §7.3-7.4 — human review gate for AI-extracted questions.
 *
 * A question enters the queue as AI_DRAFT (reviewStatus) carrying the
 * extraction model's confidence (aiConfidenceScore, 0-1).
 *
 *   confidence >= threshold (REVIEW_AUTO_APPROVE_THRESHOLD, default 0.9)
 *     → reviewStatus APPROVED. isApproved (= actually published/live) is
 *       ONLY also set true if the row already clears the v5 §37.1
 *       verification gate AND the v3 §6.3 bilingual gate — the same two
 *       gates the admin approve endpoints enforce. Extraction alone never
 *       sets answerVerificationStatus past its UNVERIFIED_SINGLE_SOURCE
 *       default or fills in Hindi fields, so in practice this branch stays
 *       unpublished (AI-confident ≠ human-verified) until an admin
 *       completes verification/translation and approves it explicitly.
 *
 *       BUG FIX: previously this set isApproved=true unconditionally on
 *       high confidence, which — combined with PUBLISHED_QUESTION_WHERE
 *       only checking isApproved/isActive/autoSuspended — put fully
 *       unverified, non-bilingual, AI-only questions live in front of
 *       students with zero human review.
 *   otherwise → IN_REVIEW, waits for an admin decision.
 *
 * Admin can flip any row via PUT /admin/questions/:id/review-status.
 */
@Processor('question-review')
@Injectable()
export class QuestionReviewWorker extends WorkerHost {
  private readonly logger = new Logger(QuestionReviewWorker.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    @InjectQueue('meilisearch-index') private indexQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<ReviewQuestionData>): Promise<any> {
    const { questionId, confidence } = job.data;
    const threshold = Number(this.config.get<number>('REVIEW_AUTO_APPROVE_THRESHOLD', 0.9));

    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!question) {
      this.logger.warn(`Review job ${job.id}: question ${questionId} not found`);
      return { reviewed: false, reason: 'not_found' };
    }

    const score = typeof confidence === 'number' && isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : null;
    const autoApprove = score != null && score >= threshold;

    // Gate check (see class doc above): high extraction confidence alone
    // must never publish. Only publish if verification + bilingual are done.
    const passesVerificationGate = VERIFIED_STATUSES.has(question.answerVerificationStatus ?? '');
    const passesBilingualGate =
      (question.questionTextHindi ?? '').toString().trim().length > 0 &&
      (question.explanationHindi ?? '').toString().trim().length > 0;
    const canPublish = autoApprove && passesVerificationGate && passesBilingualGate;

    await this.prisma.question.update({
      where: { id: questionId },
      data: {
        aiConfidenceScore: score,
        reviewStatus: autoApprove ? 'APPROVED' : 'IN_REVIEW',
        // approval ≠ publish: VERIFIED_* + bilingual gates still apply
        isApproved: canPublish ? true : question.isApproved,
      },
    });

    this.logger.log(
      `Review ${questionId}: confidence=${score ?? 'n/a'} threshold=${threshold} → ` +
        `${autoApprove ? 'APPROVED (auto)' : 'IN_REVIEW'}${autoApprove && !canPublish ? ' [publish gates not met — held back]' : ''}`,
    );

    if (canPublish) {
      await this.indexQueue.add('reindex-question', { questionId });
    }

    return { reviewed: true, autoApprove, canPublish, score, threshold };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Review job ${job.id} failed: ${err.message}`);
  }
}
