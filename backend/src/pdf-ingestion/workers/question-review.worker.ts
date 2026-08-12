import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

interface ReviewQuestionData {
  questionId: string;
  batchId: string;
  sourceText: string;
  confidence: number;
}

/**
 * v1 §7.3-7.4 — human review gate for AI-extracted questions.
 *
 * A question enters the queue as AI_DRAFT (reviewStatus) carrying the
 * extraction model's confidence (aiConfidenceScore, 0-1).
 *
 *   confidence >= threshold (REVIEW_AUTO_APPROVE_THRESHOLD, default 0.9)
 *     → APPROVED (isApproved=true). Publish is still blocked until an admin
 *       sets a VERIFIED_* answerVerificationStatus (v5 §37.1 gate), so an
 *       auto-approved row can never reach the live pool unverified.
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

    await this.prisma.question.update({
      where: { id: questionId },
      data: {
        aiConfidenceScore: score,
        reviewStatus: autoApprove ? 'APPROVED' : 'IN_REVIEW',
        // approval ≠ publish: VERIFIED_* gate still applies downstream
        isApproved: autoApprove ? true : question.isApproved,
      },
    });

    this.logger.log(
      `Review ${questionId}: confidence=${score ?? 'n/a'} threshold=${threshold} → ${autoApprove ? 'APPROVED (auto)' : 'IN_REVIEW'}`,
    );
    return { reviewed: true, autoApprove, score, threshold };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Review job ${job.id} failed: ${err.message}`);
  }
}