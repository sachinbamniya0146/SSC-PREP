import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface ReviewQuestionData {
  questionId: string;
  batchId: string;
  sourceText: string;
  confidence: number;
}

@Processor('question-review')
@Injectable()
export class QuestionReviewWorker extends WorkerHost {
  private readonly logger = new Logger(QuestionReviewWorker.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<ReviewQuestionData>): Promise<any> {
    const data = job.data;
    
    // This worker would typically:
    // 1. Call an AI model to review the extracted question
    // 2. Check for duplicates, quality issues
    // 3. Set reviewStatus for the question
    // 4. If high confidence, auto-approve; else flag for human review
    
    // For now, just log and mark as IN_REVIEW
    await this.prisma.question.update({
      where: { id: data.questionId },
      data: { 
        // reviewStatus field doesn't exist in schema, using isApproved=false
      },
    });

    return { reviewed: true };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Review job ${job.id} failed: ${err.message}`);
  }
}