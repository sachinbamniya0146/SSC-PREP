import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { TestsModule } from '../tests/tests.module';
import { StudyPlanModule } from '../study-plan/study-plan.module';
import { PdfExportModule } from '../pdf-export/pdf-export.module';
import { WeakTopicAnalysisScheduler } from './weak-topic-analysis.scheduler';
import { WeakTopicAnalysisWorker } from './workers/weak-topic-analysis.worker';
import { ExpiryReminderScheduler } from './expiry-reminder.scheduler';
import { ExpiryReminderWorker } from './workers/expiry-reminder.worker';

@Module({
  // TestsModule → getWeakChapters()/attemptDetail() for /report + the daily
  // weak-topic-analysis push. StudyPlanModule → getDailyTarget() for
  // today's target/streak. PdfExportModule → reuse PdfRenderer/pdf-templates
  // for the attempt PDF (Requirement 5), per the spec's "don't build a new
  // renderer" instruction.
  //
  // BullModule.registerQueue here follows the exact same convention as
  // pdf-ingestion.module.ts: a named queue registered in `imports`, its
  // consumer worker listed in `providers`. Skipping the worker registration
  // is the exact bug this audit already found once for the
  // 'meilisearch-index' queue (jobs enqueued, nothing ever processed them) —
  // WeakTopicAnalysisWorker and ExpiryReminderWorker MUST both stay in
  // `providers` below.
  //
  // TestsModule import below is wrapped in forwardRef() — required as of
  // Requirement 5 part (a): TestsService now injects TelegramService (to
  // auto-send the result PDF on submit), so TestsModule imports
  // TelegramModule back. That makes this a genuine A→B→A module cycle.
  // forwardRef() MUST be present on BOTH sides (this import AND
  // tests.module.ts's import of TelegramModule) — wrapping only one side
  // still throws "cannot resolve dependencies" at Nest boot.
  imports: [
    HttpModule,
    forwardRef(() => TestsModule),
    StudyPlanModule,
    PdfExportModule,
    BullModule.registerQueue({ name: 'telegram-weak-topic-analysis' }),
    BullModule.registerQueue({ name: 'telegram-expiry-reminder' }),
  ],
  providers: [
    TelegramService,
    WeakTopicAnalysisScheduler,
    WeakTopicAnalysisWorker,
    ExpiryReminderScheduler,
    ExpiryReminderWorker,
  ],
  controllers: [TelegramController],
  exports: [TelegramService],
})
export class TelegramModule {}
