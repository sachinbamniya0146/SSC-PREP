import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { StudyPlanService } from './study-plan.service';

@Controller('study-plan')
@UseGuards(JwtAuthGuard)
export class StudyPlanController {
  constructor(private readonly studyPlanService: StudyPlanService) {}

  // BUGFIX: these three routes were missing entirely — the study-plan page
  // called them but got 404s, and Daily Test (which depends on a real
  // StudyPlan row existing) was unreachable as a result. See study-plan.service.ts.

  // GET /study-plan — the user's active plan + progress (null if none yet)
  @Get()
  getPlan(@CurrentUser() user: AuthenticatedUser) {
    return this.studyPlanService.getPlan(user.userId);
  }

  // GET /study-plan/daily-target — today's target/progress/streak
  @Get('daily-target')
  getDailyTarget(@CurrentUser() user: AuthenticatedUser) {
    return this.studyPlanService.getDailyTarget(user.userId);
  }

  // POST /study-plan/create — create or replace the user's plan
  @Post('create')
  createPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { examId: string; subjectId?: string; type?: 'COMBINED' | 'SUBJECT_WISE'; targetDate: string },
  ) {
    return this.studyPlanService.createPlan(user.userId, body);
  }

  @Post('generate')
  async generateStudyPlan(@Body() body: {
    testResults: {
      totalQuestions: number;
      correctAnswers: number;
      incorrectAnswers: number;
      skippedAnswers: number;
      subjectScores: { subject: string; score: number; total: number }[];
      topicScores: { topic: string; score: number; total: number }[];
    };
    userApiKey?: string;
  }) {
    return this.studyPlanService.generateStudyPlan({ userId: 'system', testResults: body.testResults }, body.userApiKey);
  }

  @Get('model')
  async getModel() {
    return {
      // BUGFIX: default here used to say 'openai/gpt-4o-mini' (paid) even
      // though the actual call in study-plan.service.ts has now been fixed
      // to always use free OpenRouter models. Kept in sync with the
      // FREE_MODELS fallback list there.
      model: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free',
      hasApiKey: !!process.env.OPENROUTER_API_KEY,
      availableModels: [
        'nvidia/nemotron-3-ultra-550b-a55b:free',
        'nvidia/nemotron-3-super-120b-a12b:free',
        'nvidia/nemotron-3.5-lightning:free',
        'meta-llama/llama-3.3-70b-instruct:free',
      ],
    };
  }
}
