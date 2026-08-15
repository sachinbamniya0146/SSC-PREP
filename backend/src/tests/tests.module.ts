import { Module } from '@nestjs/common';
import { TestsService } from './tests.service';
import { TestsController } from './tests.controller';
import { TestStatsService } from './test-stats.service';
import { DailyTestService } from './daily-test.service';
import { DailyTestController } from './daily-test.controller';
import { GamificationModule } from '../gamification/gamification.module';

@Module({
  imports: [GamificationModule],
  providers: [TestsService, DailyTestService, TestStatsService],
  controllers: [TestsController, DailyTestController],
})
export class TestsModule {}