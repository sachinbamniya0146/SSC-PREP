/* eslint-disable @typescript-eslint/no-explicit-any */
import { Controller, Get, Post, Put, Body, Query, Param } from '@nestjs/common';
import { TestsService } from './tests.service';
import { TestStatsService } from './test-stats.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('tests')
export class TestsController {
  constructor(
    private readonly testsService: TestsService,
    private readonly statsService: TestStatsService,
  ) {}

  @Get()
  list() {
    return this.testsService.listAvailable();
  }

  // P1 — save a completed attempt (results history)
  @Post('attempts')
  saveAttempt(@CurrentUser() user: { userId: string }, @Body() body: any) {
    return this.testsService.saveAttempt(user.userId, body);
  }

  // P0 — server-authoritative timed session: start (stamps startedAt+expiresAt)
  @Post('attempts/start')
  startAttempt(@CurrentUser() user: { userId: string }, @Body() body: { testTemplateId: string }) {
    return this.testsService.startAttempt(user.userId, body.testTemplateId);
  }

  // P0 — submit a timed attempt (server-enforced expiry + server-side scoring)
  @Post('attempts/:attemptId/submit')
  submitAttempt(
    @CurrentUser() user: { userId: string },
    @Param('attemptId') attemptId: string,
    @Body() body: { answers?: { questionId: string; selectedOption: string | null; timeSpentSeconds?: number }[] },
  ) {
    return this.testsService.submitAttempt(user.userId, attemptId, body);
  }

  // P0 — live remaining-time check (client countdown is cosmetic only)
  @Get('attempts/:attemptId/remaining')
  attemptRemaining(@CurrentUser() user: { userId: string }, @Param('attemptId') attemptId: string) {
    return this.testsService.attemptRemaining(user.userId, attemptId);
  }

  // v4 §31 — autosave partial answers mid-attempt (debounced client-side)
  @Put('attempts/:attemptId/answers')
  saveAnswers(
    @CurrentUser() user: { userId: string },
    @Param('attemptId') attemptId: string,
    @Body() body: { answers: { questionId: string; selectedOption: string | null; timeSpentSeconds?: number }[]; timeSpentByQuestion?: Record<string, number> },
  ) {
    return this.testsService.saveAnswers(user.userId, attemptId, body);
  }

  // v6 §6 — per-template stats: attempts, averages, real cutoff (P90), toppers
  @Get('stats/:templateId')
  stats(@Param('templateId') templateId: string) {
    return this.statsService.getStats(templateId);
  }

  // P1 — student results history
  @Get('attempts')
  myAttempts(@CurrentUser() user: { userId: string }, @Query('take') take?: string) {
    return this.testsService.myAttempts(user.userId, take ? Number(take) : 50);
  }

  // P1 — single attempt detail with answers
  @Get('attempts/:attemptId')
  attemptDetail(@CurrentUser() user: { userId: string }, @Param('attemptId') attemptId: string) {
    return this.testsService.attemptDetail(user.userId, attemptId);
  }

  // v6 §2a — full shift paper (template-composed; auth required for premium)
  @Get('paper/:templateId')
  paper(@CurrentUser() user: { userId: string }, @Param('templateId') templateId: string) {
    return this.testsService.paper(user.userId, templateId);
  }

  // v6 §2c — sectional subjects picker
  @Get('sectional/subjects')
  sectionalSubjects() {
    return this.testsService.sectionalSubjects();
  }

  // v6 §2c — compose sectional test (subject-wise, multi-year, per-test dedup)
  @Get('sectional')
  sectional(@Query('subjectId') subjectId: string, @Query('count') count?: string) {
    return this.testsService.sectional(subjectId, count ? Number(count) : 25);
  }

  // SSC CGL Tier 1 2025 — full sectional exam (4 sections × 25 Qs, 15-min timers)
  @Get('sectional/cgl')
  cglExam() {
    return this.testsService.cglExam();
  }

  // v7 §NEW — Wrong/Skipped Auto-Practice: practice from weak chapters
  @Get('weak-areas/practice')
  weakAreasPractice(
    @CurrentUser() user: { userId: string },
    @Query('limit') limit?: string,
    @Query('includeSkipped') includeSkipped?: string,
    @Query('examId') examId?: string,
  ) {
    return this.testsService.getWeakAreasPractice(user.userId, {
      limit: limit ? Number(limit) : 25,
      includeSkipped: includeSkipped !== 'false',
      examId,
    });
  }
}
