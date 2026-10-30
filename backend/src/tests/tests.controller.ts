/* eslint-disable @typescript-eslint/no-explicit-any */
import { Controller, Get, Post, Put, Body, Query, Param, BadRequestException } from '@nestjs/common';
import { SECTIONAL_FAMILIES, SectionalFamily, TestsService } from './tests.service';
import { TestStatsService } from './test-stats.service';
import { TestBuilderService } from './test-builder.service';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { normalizeExamTier, normalizeTierPaper } from '../common/pyq-paper-key';

@Controller('tests')
export class TestsController {
  constructor(
    private readonly testsService: TestsService,
    private readonly statsService: TestStatsService,
    private readonly builder: TestBuilderService,
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
  startAttempt(@CurrentUser() user: { userId: string }, @Body() body: { testTemplateId: string; scribe?: boolean; fromPaper?: boolean; sectional?: string }) {
    // `scribe` = extra-time accessibility option; only has an effect on strict-sectional patterns that offer it.
    // `fromPaper` = the client got its questions from GET /tests/paper/:id (the /test?template= page): the server then ties the attempt to that paper.
    // `sectional` = the CGL sectional page: the server composes the exam itself, stores its question list on the attempt and returns it as `exam`
    // (a resume returns the same questions). An unknown value is ignored, so an old client keeps working.
    const fam = String(body.sectional ?? '').toLowerCase();
    const sectionalFamily = (SECTIONAL_FAMILIES as readonly string[]).includes(fam) ? (fam as SectionalFamily) : undefined;
    return this.testsService.startAttempt(user.userId, body.testTemplateId, { scribe: body.scribe === true, fromPaper: body.fromPaper === true, sectionalFamily });
  }

  // P0 — submit a timed attempt (server-enforced expiry + server-side scoring)
  @Post('attempts/:attemptId/submit')
  submitAttempt(
    @CurrentUser() user: { userId: string },
    @Param('attemptId') attemptId: string,
    @Body() body: { answers?: { questionId: string; selectedOption: string | null; timeSpentSeconds?: number }[]; clientSubmittedAt?: number | string; answeredAt?: Record<string, number>; tabSwitches?: number },
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
    @Body() body: { answers: { questionId: string; selectedOption: string | null; timeSpentSeconds?: number }[]; timeSpentByQuestion?: Record<string, number>; tabSwitches?: number },
  ) {
    return this.testsService.saveAnswers(user.userId, attemptId, body);
  }

  // P0 — section timers / scribe option of a strict-sectional template (instructions screen). {pattern:null} for normal mocks.
  @Get('pattern/:templateId')
  templatePattern(@Param('templateId') templateId: string) {
    return this.testsService.templatePattern(templateId);
  }

  // v6 §6 — per-template stats: attempts, averages, real cutoff (P90), toppers
  @Get('stats/:templateId')
  stats(@CurrentUser() user: { userId: string }, @Param('templateId') templateId: string) {
    return this.statsService.getStats(templateId, user?.userId);
  }

  // P1 — student results history
  // S48 — unfinished tests of this student that are still inside their time: the "Continue your test" pop-up reads this.
  // MUST stay above @Get('attempts/:attemptId') or "active" would be taken for an attempt id.
  @Get('attempts/active')
  activeAttempts(@CurrentUser() user: { userId: string }) {
    return this.builder.activeAttempts(user.userId);
  }

  // S48 — reopen an unfinished ad-hoc test (custom test, smart mock, year-wise) with the same questions and the saved answers.
  @Get('attempts/:attemptId/resume')
  resumeAttempt(@CurrentUser() user: { userId: string }, @Param('attemptId') attemptId: string) {
    return this.builder.resumeAttempt(user.userId, attemptId);
  }

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

  // BUGFIX (bonus grep — "sari exams ke test dena ka option"): generalizes
  // the sectional-exam flow beyond CGL to the other 3 exam families the
  // full-paper flow (paper(), above) already supports. Additive route —
  // /tests/sectional/cgl above is untouched and keeps working exactly as
  // before for the existing frontend.
  @Get('sectional/exam/:family')
  sectionalExamForFamily(@Param('family') family: string) {
    const f = family.toLowerCase();
    if (f !== 'cgl' && f !== 'chsl' && f !== 'mts' && f !== 'cpo') {
      throw new BadRequestException(`Unknown exam family: ${family}. Supported: cgl, chsl, mts, cpo`);
    }
    return this.testsService.sectionalExamForFamily(f as 'cgl' | 'chsl' | 'mts' | 'cpo');
  }

  // Session 18+ — Year-wise custom test: exam+year (+ optional subject/
  // chapter/topic narrowing, or `full: true` for the whole year's paper).
  // Returns an attemptId immediately (ad-hoc TestTemplate under the hood),
  // so the live test page + submit + attemptDetail analysis all work
  // exactly like every other test type.
  @Post('year-wise/start')
  yearWiseStart(
    @CurrentUser() user: { userId: string },
    @Body()
    body: {
      examId: string;
      year: number;
      shift?: string;
      tier?: string;
      tierPaper?: string;
      subjectIds?: string[];
      chapterIds?: string[];
      topicIds?: string[];
      full?: boolean;
    },
  ) {
    return this.testsService.yearWiseStart(user.userId, {
      examId: body.examId,
      year: Number(body.year),
      shift: body.shift || undefined,
      tier: normalizeExamTier(body.tier).tier,
      tierPaper: normalizeTierPaper(body.tierPaper).paper,
      subjectIds: body.subjectIds,
      chapterIds: body.chapterIds,
      topicIds: body.topicIds,
      full: !!body.full,
    });
  }

  // S48 — Test builder: what can be asked (only topics that have questions; for an exam only topics its previous-year papers asked).
  @Get('builder/quota')
  builderQuota(@CurrentUser() user: { userId: string }) {
    return this.builder.quota(user.userId);
  }

  @Get('builder/catalog')
  builderCatalog(@Query('examId') examId?: string) {
    return this.builder.catalog(examId || undefined);
  }

  // S48 — Custom test (student picks topics + counts + minutes) or Smart mock (exam-wise, weighted by its previous-year papers).
  // Returns the same shape as year-wise/start, so /test runs it like every other server-timed attempt.
  @Post('builder/start')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  builderStart(
    @CurrentUser() user: { userId: string },
    @Body() body: { mode?: string; examId?: string; items?: { chapterId?: string; topicId?: string; count?: number }[]; durationMinutes?: number | string; tier?: string },
  ) {
    return this.builder.start(user.userId, { ...body, tier: body?.tier ? normalizeExamTier(body.tier).tier ?? undefined : undefined });
  }

  // v7 §NEW — Wrong/Skipped Auto-Practice: practice from weak chapters
  @Get('weak-areas/practice')
  weakAreasPractice(
    @CurrentUser() user: { userId: string },
    @Query('limit') limit?: string,
    @Query('includeSkipped') includeSkipped?: string,
    @Query('examId') examId?: string,
    @Query('chapterId') chapterId?: string,
  ) {
    return this.testsService.getWeakAreasPractice(user.userId, {
      limit: limit ? Number(limit) : 25,
      includeSkipped: includeSkipped !== 'false',
      examId,
      chapterId,
    });
  }

  // ---- Enhanced Analytics Endpoints ----
  @Get('analytics/performance/:templateId')
  getPerformanceAnalytics(
    @CurrentUser() user: { userId: string },
    @Param('templateId') templateId: string,
  ) {
    return this.testsService.getPerformanceAnalytics(user.userId, templateId);
  }

  @Get('analytics/subject-wise')
  getSubjectWiseAnalytics(@CurrentUser() user: { userId: string }) {
    return this.testsService.getSubjectWiseAnalytics(user.userId);
  }

  @Get('analytics/time-spent')
  getTimeSpentAnalytics(
    @CurrentUser() user: { userId: string },
    @Query('templateId') templateId?: string,
  ) {
    return this.testsService.getTimeSpentAnalytics(user.userId, templateId);
  }

  @Get('analytics/accuracy-trend')
  getAccuracyTrend(
    @CurrentUser() user: { userId: string },
    @Query('days') days?: string,
  ) {
    return this.testsService.getAccuracyTrend(user.userId, days ? Number(days) : 30);
  }

  @Get('analytics/weak-chapters')
  getWeakChapters(@CurrentUser() user: { userId: string }) {
    return this.testsService.getWeakChapters(user.userId);
  }

  @Get('analytics/strength-chapters')
  getStrengthChapters(@CurrentUser() user: { userId: string }) {
    return this.testsService.getStrengthChapters(user.userId);
  }

  @Get('analytics/comparison/:templateId')
  getComparisonWithToppers(
    @CurrentUser() user: { userId: string },
    @Param('templateId') templateId: string,
  ) {
    return this.testsService.getComparisonWithToppers(user.userId, templateId);
  }
}
