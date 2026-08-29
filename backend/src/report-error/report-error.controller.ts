import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AIExplanationService } from './ai-explanation.service';

@Controller('ai-explanation')
@UseGuards(JwtAuthGuard)
export class AIExplanationController {
  constructor(private readonly aiExplanationService: AIExplanationService) {}

  // FIX (Session 6 bonus-grep item 8b, CRITICAL leak): now passes the caller's
  // userId + role into the service so it can enforce the "attempted this
  // question first" gate for students (staff still unrestricted). Previously
  // this route only checked JwtAuthGuard, so any logged-in student could pull
  // any question's explanation (= its answer) without ever attempting it.
  @Get('questions/:id')
  async getExplanation(
    @CurrentUser() user: { userId: string; role: string },
    @Param('id') questionId: string,
  ) {
    return this.aiExplanationService.getOrGenerateExplanation(questionId, user.userId, user.role);
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
