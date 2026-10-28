import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
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

  /** The right option of many questions (review list of a finished test); only for questions the student has an attempt record for. */
  @Post('keys')
  async keys(@CurrentUser() user: { userId: string; role: string }, @Body() body: { questionIds?: string[] }) {
    return { keys: await this.explanations.getAnswerKeys(user.userId, user.role, Array.isArray(body?.questionIds) ? body.questionIds : []) };
  }

  @Get('questions/:id/available')
  async available(@Param('id') questionId: string) {
    return { hasExplanation: await this.explanations.hasExplanation(questionId) };
  }
}
