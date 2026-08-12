import { Module, forwardRef } from '@nestjs/common';
import { TestsService } from './tests.service';
import { TestsController } from './tests.controller';
import { DailyTestService } from './daily-test.service';
import { DailyTestController } from './daily-test.controller';
import { GamificationModule } from '../gamification/gamification.module';

@Module({
  imports: [GamificationModule],
  providers: [TestsService, DailyTestService],
  controllers: [TestsController, DailyTestController],
})
export class TestsModule {}