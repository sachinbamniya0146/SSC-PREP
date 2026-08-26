import { Module } from '@nestjs/common';
import { AIExplanationController } from './ai-explanation.controller';
import { AIExplanationService } from './ai-explanation.service';

@Module({
  controllers: [AIExplanationController],
  providers: [AIExplanationService],
  exports: [AIExplanationService],
})
export class AIExplanationModule {}
