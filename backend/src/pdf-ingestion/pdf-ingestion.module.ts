import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { PdfIngestionController } from './pdf-ingestion.controller';
import { PdfIngestionService } from './pdf-ingestion.service';
import { PdfExtractionWorker } from './workers/pdf-extraction.worker';
import { QuestionReviewWorker } from './workers/question-review.worker';
import { MeilisearchIndexWorker } from './workers/meilisearch-index.worker';
import { S3Module } from '../s3/s3.module';
import { RedisModule } from '../redis/redis.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    PrismaModule,
    S3Module,
    RedisModule,
    AuditLogModule,
    BullModule.registerQueue(
      { name: 'pdf-extraction' },
      { name: 'question-review' },
      { name: 'meilisearch-index' },
    ),
  ],
  controllers: [PdfIngestionController],
  providers: [
    PdfIngestionService,
    PdfExtractionWorker,
    QuestionReviewWorker,
    MeilisearchIndexWorker,
  ],
  exports: [PdfIngestionService],
})
export class PdfIngestionModule {}
