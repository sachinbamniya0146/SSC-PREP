import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { StudyPlanService } from './study-plan.service';
import { StudyPlanV2Service } from './study-plan-v2.service';

@Controller('study-plan')
@UseGuards(JwtAuthGuard)
export class StudyPlanController {
  constructor(
    private readonly studyPlanService: StudyPlanService,
    private readonly v2: StudyPlanV2Service,
  ) {}

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
  }) {
    return this.studyPlanService.generateStudyPlan({ userId: 'system', testResults: body.testResults });
  }

  // ---- Study Plan v2 (Sep 29 2026) ----
  @Get('chapters')
  chapterBoard(@CurrentUser() user: AuthenticatedUser, @Query('examId') examId?: string) {
    return this.v2.board(user.userId, examId || undefined);
  }

  @Post('chapters/mark')
  markChapters(@CurrentUser() user: AuthenticatedUser, @Body() body: { chapterIds: string[]; complete?: boolean }) {
    return this.v2.markChapters(user.userId, body?.chapterIds ?? [], body?.complete !== false);
  }

  @Get('test/upcoming')
  upcomingTest(@CurrentUser() user: AuthenticatedUser) {
    return this.v2.upcomingTest(user.userId);
  }

  @Post('test/:id/start')
  startTest(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.v2.startTest(user.userId, id);
  }

  @Get('test/:id/result')
  testResult(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.v2.testResult(user.userId, id);
  }

  @Get('attempt/:attemptId/verdict')
  verdictByAttempt(@CurrentUser() user: AuthenticatedUser, @Param('attemptId') attemptId: string) {
    return this.v2.verdictByAttempt(user.userId, attemptId);
  }

  @Get('weak')
  weakBoard(@CurrentUser() user: AuthenticatedUser, @Query('examId') examId?: string) {
    return this.v2.weakBoard(user.userId, examId || undefined);
  }

  // NEW (Oct 3 2026): mandatory daily revision of completed chapters (50 questions)
  @Get('revision/today')
  revisionToday(@CurrentUser() user: AuthenticatedUser) {
    return this.v2.revisionToday(user.userId);
  }

  @Get('today')
  todayPlan(@CurrentUser() user: AuthenticatedUser) {
    return this.v2.todayPlan(user.userId);
  }
}
