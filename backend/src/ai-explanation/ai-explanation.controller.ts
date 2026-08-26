import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AIExplanationService } from './ai-explanation.service';

@Controller('ai-explanation')
@UseGuards(JwtAuthGuard)
export class AIExplanationController {
  constructor(private readonly aiExplanationService: AIExplanationService) {}

  @Get('questions/:id')
  async getExplanation(@Param('id') questionId: string) {
    return this.aiExplanationService.getOrGenerateExplanation(questionId);
  }

  @Get('questions/:id/available')
  async checkExplanationAvailable(@Param('id') questionId: string) {
    const hasExplanation = await this.aiExplanationService.hasExplanation(questionId);
    return { hasExplanation };
  }

  @Get('models')
  async getModels() {
    const models = await this.aiExplanationService.getAvailableModels();
    return { models };
  }
}
