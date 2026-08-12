import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExplanationGenerationService } from '../explanation-generation.service';

interface ExplainQuestionData {
  questionId: string;
}

@Injectable()
@Processor('explanation-generation')
export class ExplanationGenerationWorker extends WorkerHost {
  private readonly logger = new Logger(ExplanationGenerationWorker.name);

  constructor(
    private prisma: PrismaService,
    private explanationService: ExplanationGenerationService,
  ) {
    super();
  }

  async process(job: Job<ExplainQuestionData>): Promise<any> {
    const data = job.data;
    this.logger.log(`Generating explanation for question ${data.questionId}`);

    try {
      await this.explanationService.generateExplanationForQuestion(data.questionId);
      this.logger.log(`Successfully generated explanation for question ${data.questionId}`);
      return { questionId: data.questionId };
    } catch (error: unknown) {
      this.logger.error(`Failed to generate explanation for question ${data.questionId}:`, error);
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.id} failed: ${err.message}`);
  }
}