import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MockTestService } from './mock-test.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TestType } from '@prisma/client';

@Controller('mock-tests')
@UseGuards(JwtAuthGuard)
export class MockTestController {
  constructor(private mockTestService: MockTestService) {}

  // Get all SSC exams with their mock tests
  @Get('exams')
  async getExamsWithMocks(@CurrentUser() user: { userId: string }) {
    return this.mockTestService.getAllExamsWithMocks(user.userId);
  }

  // Create/start a mock test for an exam
  @Post('start')
  async startMockTest(
    @CurrentUser() user: { userId: string },
    @Body() body: {
      examId: string;
      templateId?: string;
      type: TestType;
      durationMinutes: number;
      totalQuestions: number;
      totalMarks: number;
      sections?: any[];
    }
  ) {
    return this.mockTestService.createMockTest(user.userId, body);
  }

  // Submit mock test and get detailed analysis
  @Post('submit/:testAttemptId')
  async submitMockTest(
    @CurrentUser() user: { userId: string },
    @Param('testAttemptId') testAttemptId: string,
    @Body() body: { answers: { questionId: string; selectedOption: string; timeSpentSeconds: number }[] }
  ) {
    return this.mockTestService.submitMockTest(user.userId, testAttemptId, body.answers);
  }

  // Get weak chapter practice test
  @Post('weak-chapters/practice')
  async getWeakChapterPractice(
    @CurrentUser() user: { userId: string },
    @Body() body: {
      examId?: string;
      subjectId?: string;
      chapterIds?: string[];
      questionCount?: number;
    }
  ) {
    return this.mockTestService.getWeakChapterPracticeTest(user.userId, body);
  }

  // Retest weak chapters with new questions
  @Post('weak-chapters/retest')
  async retestWeakChapters(
    @CurrentUser() user: { userId: string },
    @Body() body: {
      previousAttemptId?: string;
      chapterIds?: string[];
    }
  ) {
    return this.mockTestService.retestWeakChapters(user.userId, body);
  }

  // Get chapter-wise questions with year distribution
  @Get('chapter-wise/:examId')
  async getChapterWise(
    @Param('examId') examId: string,
    @Query('subjectId') subjectId?: string,
    @Query('chapterId') chapterId?: string
  ) {
    return this.mockTestService.getChapterWiseQuestions(examId, subjectId, chapterId);
  }

  // Search questions with multiple filters
  @Get('questions/search')
  async searchQuestions(
    @Query('examId') examId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('chapterId') chapterId?: string,
    @Query('year') year?: number,
    @Query('shift') shift?: string,
    @Query('difficulty') difficulty?: string,
    @Query('verifiedOnly') verifiedOnly?: boolean,
    @Query('hasHindi') hasHindi?: boolean,
    @Query('hasVideo') hasVideo?: boolean,
    @Query('keyword') keyword?: string,
    @Query('skip') skip?: number,
    @Query('take') take?: number
  ) {
    return this.mockTestService.searchQuestions({
      examId,
      subjectId,
      chapterId,
      year,
      shift,
      difficulty,
      verifiedOnly,
      hasHindi,
      hasVideo,
      keyword,
      skip,
      take,
    });
  }
}
