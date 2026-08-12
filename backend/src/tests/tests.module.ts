import { Module, forwardRef } from '@nestjs/common';
import { TestsService } from './tests.service';
import { TestsController } from './tests.controller';
import { GamificationModule } from '../gamification/gamification.module';

@Module({
  imports: [GamificationModule],
  providers: [TestsService],
  controllers: [TestsController],
})
export class TestsModule {}
