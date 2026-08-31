/* eslint-disable @typescript-eslint/no-explicit-any */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { SearchService } from '../../search/search.service';

// BUG FIX: 'meilisearch-index' queue was registered (pdf-ingestion.module.ts)
// and jobs were being enqueued to it from pdf-ingestion.service.ts —
// approveQuestion() adds a 'reindex-question' job, bulkApproveQuestions() adds
// a 'reindex-batch' job — but NO worker anywhere in the codebase ever consumed
// this queue. The jobs just sat in Redis forever unprocessed, meaning normal
// single/bulk admin approval never actually added the question to Meilisearch.
// The ONLY things that ever indexed a question were: (1) the manual
// POST /search/reindex admin endpoint (indexAllApproved, direct call, no
// queue), and (2) report-error.service.ts's direct indexQuestion() call when
// autoSuspended flips. So freshly-approved questions were invisible in search
// until someone manually re-ran a full reindex. This worker fixes that gap.
interface ReindexQuestionData {
  questionId: string;
}
interface ReindexBatchData {
  questionIds: string[];
}

@Injectable()
@Processor('meilisearch-index')
export class MeilisearchIndexWorker extends WorkerHost {
  private readonly logger = new Logger(MeilisearchIndexWorker.name);

  constructor(private readonly searchService: SearchService) {
    super();
  }

  async process(job: Job<ReindexQuestionData | ReindexBatchData>): Promise<any> {
    if (job.name === 'reindex-question') {
      const { questionId } = job.data as ReindexQuestionData;
      this.logger.log(`Indexing question ${questionId} into Meilisearch`);
      const result = await this.searchService.indexQuestion(questionId);
      if (!result.success) throw new Error(result.error || 'indexQuestion failed');
      return result;
    }

    if (job.name === 'reindex-batch') {
      const { questionIds } = job.data as ReindexBatchData;
      this.logger.log(`Indexing ${questionIds.length} questions into Meilisearch`);
      const failures: string[] = [];
      for (const questionId of questionIds) {
        const result = await this.searchService.indexQuestion(questionId);
        if (!result.success) failures.push(questionId);
      }
      if (failures.length) {
        this.logger.error(`Failed to index ${failures.length}/${questionIds.length} questions: ${failures.join(', ')}`);
        throw new Error(`Failed to index ${failures.length}/${questionIds.length} questions`);
      }
      return { indexed: questionIds.length };
    }

    this.logger.warn(`Unknown job name on meilisearch-index queue: ${job.name}`);
    return { skipped: true };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.id} (${job.name}) failed: ${err.message}`);
  }
}
