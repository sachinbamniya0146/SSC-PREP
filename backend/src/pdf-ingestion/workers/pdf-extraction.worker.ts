import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../../s3/s3.service';

interface ExtractChunkData {
  batchId: string;
  chunkId: string;
  sourcePdfId: string;
  s3Key: string;
  startPage: number;
  endPage: number;
  chunkIndex: number;
  metadata: {
    subjectId?: string;
    examId?: string;
    bookName?: string;
    publisher?: string;
    language?: string;
    year?: number;
    shift?: string;
    paperCode?: string;
  };
}

@Processor('pdf-extraction')
@Injectable()
export class PdfExtractionWorker extends WorkerHost {
  private readonly logger = new Logger(PdfExtractionWorker.name);

  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
  ) {
    super();
  }

  async process(job: Job<ExtractChunkData>): Promise<any> {
    const data = job.data;
    this.logger.log(`Processing chunk ${data.chunkIndex}: pages ${data.startPage}-${data.endPage}`);

    try {
      await this.prisma.importChunk.update({
        where: { id: data.chunkId },
        data: { status: 'PROCESSING', processedAt: new Date() },
      });

      // Placeholder - actual extraction happens in Python OCR scripts
      await this.prisma.importChunk.update({
        where: { id: data.chunkId },
        data: { status: 'SUCCESS', processedAt: new Date() },
      });

      await this.checkBatchComplete(data.batchId);

      return { extracted: 0 };
    } catch (error: any) {
      this.logger.error(`Chunk ${data.chunkId} failed:`, error);
      await this.prisma.importChunk.update({
        where: { id: data.chunkId },
        data: { status: 'FAILED', errorMessage: error.message, processedAt: new Date() },
      });
      throw error;
    }
  }

  private async checkBatchComplete(batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: { chunks: true },
    });

    if (!batch) return;

    const allDone = batch.chunks.every(c => c.status === 'SUCCESS' || c.status === 'FAILED');
    if (allDone) {
      const successCount = batch.chunks.filter(c => c.status === 'SUCCESS').length;
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: { status: successCount === batch.totalChunks ? 'COMPLETED' : 'PARTIAL' },
      });
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.id} failed: ${err.message}`);
  }
}