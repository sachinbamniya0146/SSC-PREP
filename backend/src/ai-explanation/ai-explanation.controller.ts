/* eslint-disable @typescript-eslint/no-explicit-any */
import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AIExplanationService } from './ai-explanation.service';

@Controller('ai-explanation')
@UseGuards(JwtAuthGuard)
export class AIExplanationController {
  constructor(private readonly aiExplanationService: AIExplanationService) {}

  @Get('questions/:id')
  async getExplanation(
    @Param('id') questionId: string,
    @CurrentUser() user: { userId: string },
    @Query('userApiKey') userApiKey?: string,
  ) {
    return this.aiExplanationService.getOrGenerateExplanation(questionId, userApiKey);
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
