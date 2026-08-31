/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Controller, Get, Query, Post, Body, Param, Put, Delete, UseGuards, Req } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BankService } from './bank.service';
import { QuestionBankPracticeService } from './question-bank-practice.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('bank')
@UseGuards(JwtAuthGuard)
export class BankController {
  constructor(
    private readonly bank: BankService,
    private readonly practiceService: QuestionBankPracticeService,
  ) {}

  @Get('meta')
  @Public()
  meta() {
    return this.bank.meta();
  }

  // Admin-only: exam × subject breakdown of question counts + Hindi
  // translation coverage, in one response — answers "kitne question kis
  // exam ke kis subject ke hain, aur kitne translate hue hain" directly
  // from the app instead of needing a manual DB query.
  @Get('admin/coverage')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  coverageReport() {
    return this.bank.contentCoverageReport();
  }

  // v4 §18 — SearchMiss demand log: user searched, nothing matched.
  @Post('search-miss')
  searchMiss(@Req() req: any, @Body() body: { query: string; exam?: string }) {
    const userId = req.user?.userId ?? req.user?.id ?? null;
    return this.bank.logSearchMiss(body?.query, body?.exam, userId);
  }

  @Get('subjects')
  subjects(@Query('examId') examId?: string) {
    return this.bank.subjects(examId);
  }

  @Get('chapters')
  chapters(@Query('subjectId') subjectId?: string, @Query('examId') examId?: string) {
    return this.bank.chapters(subjectId, examId);
  }

  // Admin chapter management — see BankService.createChapter/
  // listAllChaptersForAdmin doc comment for why this was missing and why
  // it's required before bulk question upload can work at all.
  @Get('admin/chapters')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  listChaptersForAdmin(@Query('subjectId') subjectId?: string) {
    return this.bank.listAllChaptersForAdmin(subjectId);
  }

  @Post('admin/chapters')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  createChapter(@Body() body: { subjectId: string; name: string }) {
    if (!body?.subjectId || !body?.name) {
      throw new BadRequestException('subjectId and name are required');
    }
    return this.bank.createChapter(body.subjectId, body.name);
  }

  // FIX (CRITICAL answer-key leak, see BankService.getAttemptedQuestionIds
  // doc comment): browse/getSet/chapterPyq/getById never received the
  // caller's userId at all, so the service had no way to gate
  // correctAnswer/explanation by "has this user attempted it". Now threading
  // req.user through on every read route, matching the pattern already used
  // by attempt()/practice endpoints below.
  @Get('questions')
  browse(
    @Req() req: any,
    @Query('examId') examId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('chapterId') chapterId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.bank.browse(
      {
        examId,
        subjectId,
        chapterId,
        skip: skip ? parseInt(skip, 10) : undefined,
        take: take ? parseInt(take, 10) : undefined,
      },
      userId,
    );
  }

  // set() and chapterPyq() intentionally do NOT thread userId through —
  // see the "do not apply the attempted-gate" notes on BankService.getSet()
  // and .chapterPyq(): /test's Show-Answer/AI-Hint self-check feature relies
  // on these returning correctAnswer/explanation up front.
  @Get('set')
  set(
    @Query('examId') examId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('count') count?: string,
  ) {
    return this.bank.getSet({
      examId,
      subjectId,
      count: count ? parseInt(count, 10) : undefined,
    });
  }

  // Chapter-wise PYQ practice
  @Get('chapters/:id/pyq')
  chapterPyq(
    @Param('id') id: string,
    @Query('examId') examId?: string,
    @Query('year') year?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.bank.chapterPyq({
      chapterId: id,
      examId,
      year: year ? parseInt(year, 10) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
    });
  }

  @Get('questions/:id')
  getById(@Req() req: any, @Param('id') id: string) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.bank.getById(id, userId);
  }

  @Post('attempt')
  attempt(@Req() req: any, @Body() body: { questionId: string; selectedOption: string; templateId?: string }) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.bank.attempt(userId, body);
  }

  // ---- Video Solution Endpoints ----
  // BUG FIX (audit round 3): add/removeVideoSolution had only the
  // class-level @UseGuards(JwtAuthGuard) — i.e. ANY logged-in student
  // (not just admins/moderators) could attach or wipe the video-solution
  // link on any question in the bank. Locked down to ADMIN/MODERATOR,
  // matching the pattern already used a few lines below for verifyQuestion.
  // getVideoSolution (read) is intentionally left open to any logged-in
  // user — students are supposed to be able to watch the video solution.

  @Post('questions/:id/video')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  addVideoSolution(
    @Param('id') id: string,
    @Body() dto: { 
      videoUrl: string; 
      videoSource?: string; 
      videoTitle?: string; 
      videoDescription?: string; 
      videoDurationSeconds?: number;
      videoLanguage?: string;
    },
    @Req() req: any,
  ) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.bank.addVideoSolution(id, dto, userId);
  }

  @Get('questions/:id/video')
  @UseGuards(JwtAuthGuard)
  getVideoSolution(
    @Param('id') id: string,
  ) {
    return this.bank.getVideoSolution(id);
  }

  @Delete('questions/:id/video')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  removeVideoSolution(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.bank.removeVideoSolution(id, userId);
  }
  @Put('questions/:id/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  verifyQuestion(
    @Param('id') id: string,
    @Body() body: { status: string },
    @Req() req: any,
  ) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.bank.verifyQuestion(id, body.status, userId);
  }

  @Get('verification-stats')
  verificationStats() {
    return this.bank.getVerificationStats();
  }

  // FIX: this returns the full correctAnswer/explanation unconditionally
  // (it's the admin verification-queue detail view, not a student-facing
  // route) but had no @Roles guard beyond "logged in" — any authenticated
  // student could hit it directly and get the answer key for any question
  // by id. Locked down to ADMIN/MODERATOR, matching verifyQuestion() above.
  @Get('questions/:id/verification')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  getQuestionWithVerification(@Param('id') id: string) {
    return this.bank.getQuestionWithVerification(id);
  }

  @Get('topic-weightage')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  topicWeightage(@Query('examId') examId?: string) {
    return this.bank.getTopicWeightage(examId);
  }

  // ================= QUESTION BANK PRACTICE =================

  @Get('practice/subjects')
  async getPracticeSubjects(@Req() req: any, @Query('examId') examId?: string) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.practiceService.getAvailableSubjects(userId, examId);
  }

  @Get('practice/progress')
  async getUserProgress(@Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.practiceService.getUserProgress(userId);
  }

  @Get('practice/history')
  async getPracticeHistory(@Req() req: any, @Query('subjectId') subjectId?: string) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.practiceService.getPracticeHistory(userId, subjectId);
  }

  @Post('practice/start')
  async startPracticeSet(
    @Req() req: any,
    @Body() body: {
      subjectId?: string;
      chapterId?: string;
      examId?: string;
      setNumber?: number;
      mode?: 'practice' | 'test';
      resume?: boolean; // if true, resume existing incomplete set
    }
  ) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.practiceService.getOrCreateSet(userId, body);
  }

  @Get('practice/set/:setId')
  async getPracticeSet(@Req() req: any, @Param('setId') setId: string) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.practiceService.getSetById(userId, setId, true); // resume by default when getting set
  }

  @Post('practice/set/:setId/answer')
  async submitAnswer(
    @Req() req: any,
    @Param('setId') setId: string,
    @Body() body: { questionId: string; selectedOption: string }
  ) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.practiceService.submitAnswer(userId, setId, body.questionId, body.selectedOption);
  }

  @Post('practice/set/:setId/skip')
  async skipQuestion(
    @Req() req: any,
    @Param('setId') setId: string,
    @Body() body: { questionId: string }
  ) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.practiceService.skipQuestion(userId, setId, body.questionId);
  }

  @Post('practice/set/:setId/previous')
  async previousQuestion(@Req() req: any, @Param('setId') setId: string) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.practiceService.previousQuestion(userId, setId);
  }

  @Post('practice/set/:setId/goto')
  async gotoQuestion(
    @Req() req: any,
    @Param('setId') setId: string,
    @Body() body: { index: number }
  ) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.practiceService.goToQuestion(userId, setId, body.index);
  }
}
