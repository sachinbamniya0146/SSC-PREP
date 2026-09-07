import { Module, forwardRef } from '@nestjs/common';
import { TestsService } from './tests.service';
import { TestsController } from './tests.controller';
import { TestStatsService } from './test-stats.service';
import { DailyTestService } from './daily-test.service';
import { DailyTestController } from './daily-test.controller';
import { GamificationModule } from '../gamification/gamification.module';
import { TelegramModule } from '../telegram/telegram.module';
import { BankModule } from '../bank/bank.module';

@Module({
  // Requirement 5, part (a): TestsService now injects TelegramService (to
  // auto-send the result PDF from submitAttempt()). TelegramModule already
  // imports TestsModule (for /report, /pdf, weak-topic-analysis), so this
  // is a genuine A→B→A module cycle — forwardRef() here is required, not
  // optional. It MUST be paired with forwardRef() on telegram.module.ts's
  // side too (see that file) — one-sided forwardRef still throws
  // "cannot resolve dependencies" at boot.
  // NEW: TestsService now delegates single-chapter weak-area practice sets
  // to QuestionBankPracticeService.getOrCreateSet() (see tests.service.ts
  // getWeakAreasPractice) so it inherits the no-repeat-until-exhausted +
  // configurable-size fix built there, instead of duplicating that logic.
  imports: [GamificationModule, forwardRef(() => TelegramModule), BankModule],
  providers: [TestsService, DailyTestService, TestStatsService],
  controllers: [TestsController, DailyTestController],
  // BUGFIX (bonus grep — module-registration gap, same family as the
  // missing meilisearch-index worker found earlier in this audit):
  // TestsService was never exported, so no other module could inject it via
  // `imports: [TestsModule]` — NestJS would throw "TestsService is not
  // exported" at boot. TelegramModule needs it for /report and the new
  // daily weak-topic-analysis job (both call getWeakChapters() /
  // attemptDetail() on this service), so it must be exported.
  //
  // BUGFIX (2026-09 audit): DailyTestService and TestStatsService were
  // providers here but NEVER listed in exports — same exact bug class as
  // TestsService above, just not yet triggered because nothing outside
  // this module happens to inject them yet. Left as-is, the very next
  // feature that does (e.g. a future admin daily-test dashboard, or a
  // Telegram /stats command reusing TestStatsService) would silently fail
  // NestJS dependency resolution at boot with "TestStatsService is not
  // exported" / "DailyTestService is not exported". Exporting both now
  // closes that landmine before anything trips it.
  exports: [TestsService, DailyTestService, TestStatsService],
})
export class TestsModule {}
