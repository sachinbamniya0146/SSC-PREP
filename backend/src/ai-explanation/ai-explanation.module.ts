import { Module } from '@nestjs/common';
import { AIExplanationController } from './ai-explanation.controller';
import { AIExplanationService } from './ai-explanation.service';
import { AiProviderModule } from '../ai-provider/ai-provider.module';

@Module({
  imports: [AiProviderModule],
  controllers: [AIExplanationController],
  providers: [AIExplanationService],
  exports: [AIExplanationService],
})
export class AIExplanationModule {}
