import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';
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
  //
  // FEATURE: once the gate passes, a missing explanation is now actually
  // generated (personal OpenRouter key first, then the admin key pool) and
  // cached on the Question row for every future caller — see the service.
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

  /**
   * Admin/moderator "improve this answer" — forces a fresh generation using
   * ONLY the admin key pool (never a student's personal key) and overwrites
   * the shared explanation everyone sees. This is the "solutions improve
   * over time via the admin's own keys" path.
   */
  @Post('questions/:id/regenerate')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MODERATOR)
  async regenerateExplanation(
    @CurrentUser() user: { userId: string },
    @Param('id') questionId: string,
  ) {
    return this.aiExplanationService.regenerateExplanation(questionId, user.userId);
  }

  @Get('models')
  async getModels() {
    const models = await this.aiExplanationService.getAvailableModels();
    return { models };
  }
}
