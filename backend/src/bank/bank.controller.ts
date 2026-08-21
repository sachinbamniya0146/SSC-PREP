/* eslint-disable @typescript-eslint/no-explicit-any */
import { Controller, Get, Query, Post, Body, Param, Put, Delete, UseGuards, Req } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BankService } from './bank.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('bank')
@UseGuards(JwtAuthGuard)
export class BankController {
  constructor(private readonly bank: BankService) {}

  @Get('meta')
  @Public()
  meta() {
    return this.bank.meta();
  }

  // v3 §6.4 — ExamPattern blueprint for an exam (e.g. SSC CGL Tier 1)
  @Get('exam-pattern/:examId')
  @Public()
  examPattern(@Param('examId') examId: string) {
    return this.bank.getExamPattern(examId);
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

  @Get('questions')
  browse(
    @Query('examId') examId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('chapterId') chapterId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.bank.browse({
      examId,
      subjectId,
      chapterId,
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
    });
  }

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
  getById(@Param('id') id: string) {
    return this.bank.getById(id);
  }

  @Post('attempt')
  attempt(@Req() req: any, @Body() body: { questionId: string; selectedOption: string; templateId?: string }) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.bank.attempt(userId, body);
  }

  // ---- Video Solution Endpoints ----

  @Post('questions/:id/video')
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
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

  @Get('questions/:id/verification')
  getQuestionWithVerification(@Param('id') id: string) {
    return this.bank.getQuestionWithVerification(id);
  }

  @Get('topic-weightage')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  topicWeightage(@Query('examId') examId?: string) {
    return this.bank.getTopicWeightage(examId);
  }
}
