/* eslint-disable @typescript-eslint/no-explicit-any */
import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { StudyPlanService } from './study-plan.service';

@Controller('study-plan')
@UseGuards(JwtAuthGuard)
export class StudyPlanController {
  constructor(private readonly studyPlanService: StudyPlanService) {}

  @Post('generate')
  async generateStudyPlan(
    @CurrentUser() user: { userId: string },
    @Body() body: {
      testResults: {
        totalQuestions: number;
        correctAnswers: number;
        incorrectAnswers: number;
        skippedAnswers: number;
        subjectScores: { subject: string; score: number; total: number }[];
        topicScores: { topic: string; score: number; total: number }[];
      };
      userApiKey?: string;
    },
  ) {
    return this.studyPlanService.generateStudyPlan({ userId: user.userId, testResults: body.testResults }, body.userApiKey);
  }

  @Get('model')
  async getModel() {
    return {
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
      hasApiKey: !!process.env.OPENROUTER_API_KEY,
      availableModels: [
        'openai/gpt-4o-mini',
        'google/gemini-flash-1.5',
        'meta-llama/llama-3.1-8b-instruct',
      ],
    };
  }
}
