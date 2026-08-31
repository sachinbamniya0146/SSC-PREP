import { Module, forwardRef } from '@nestjs/common';
import { TestsService } from './tests.service';
import { TestsController } from './tests.controller';
import { TestStatsService } from './test-stats.service';
import { DailyTestService } from './daily-test.service';
import { DailyTestController } from './daily-test.controller';
import { GamificationModule } from '../gamification/gamification.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  // Requirement 5, part (a): TestsService now injects TelegramService (to
  // auto-send the result PDF from submitAttempt()). TelegramModule already
  // imports TestsModule (for /report, /pdf, weak-topic-analysis), so this
  // is a genuine A→B→A module cycle — forwardRef() here is required, not
  // optional. It MUST be paired with forwardRef() on telegram.module.ts's
  // side too (see that file) — one-sided forwardRef still throws
  // "cannot resolve dependencies" at boot.
  imports: [GamificationModule, forwardRef(() => TelegramModule)],
  providers: [TestsService, DailyTestService, TestStatsService],
  controllers: [TestsController, DailyTestController],
  // BUGFIX (bonus grep — module-registration gap, same family as the
  // missing meilisearch-index worker found earlier in this audit):
  // TestsService was never exported, so no other module could inject it via
  // `imports: [TestsModule]` — NestJS would throw "TestsService is not
  // exported" at boot. TelegramModule needs it for /report and the new
  // daily weak-topic-analysis job (both call getWeakChapters() /
  // attemptDetail() on this service), so it must be exported.
  exports: [TestsService],
})
export class TestsModule {}
