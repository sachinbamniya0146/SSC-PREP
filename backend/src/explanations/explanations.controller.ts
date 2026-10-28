import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ExplanationsService } from './explanations.service';

@Controller('explanations')
@UseGuards(JwtAuthGuard)
export class ExplanationsController {
  constructor(private readonly explanations: ExplanationsService) {}

  /** The stored explanation of a question (students: only after they attempted it). */
  @Get('questions/:id')
  async getExplanation(@CurrentUser() user: { userId: string; role: string }, @Param('id') questionId: string) {
    return this.explanations.getExplanation(questionId, user.userId, user.role);
  }

  @Get('questions/:id/available')
  async available(@Param('id') questionId: string) {
    return { hasExplanation: await this.explanations.hasExplanation(questionId) };
  }
}
