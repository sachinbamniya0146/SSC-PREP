import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { StudyPlanService } from './study-plan.service';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('study-plan')
@UseGuards(JwtAuthGuard)
export class StudyPlanController {
  constructor(private readonly studyPlanService: StudyPlanService) {}

  @Post('create')
  createPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: {
      examId: string;
      subjectId?: string;
      type: 'COMBINED' | 'SUBJECT_WISE';
      targetDate: string;
    },
  ) {
    return this.studyPlanService.createPlan(
      user.userId,
      body.examId,
      body.subjectId,
      body.type,
      body.targetDate,
    );
  }

  @Get()
  getPlan(@CurrentUser() user: AuthenticatedUser) {
    return this.studyPlanService.getPlan(user.userId);
  }

  @Post('practice')
  recordPractice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { planId: string; questionsAttempted: number; correct: number },
  ) {
    return this.studyPlanService.recordPractice(
      user.userId,
      body.planId,
      body.questionsAttempted,
      body.correct,
    );
  }

  @Get('daily-target')
  getDailyTarget(@CurrentUser() user: AuthenticatedUser) {
    return this.studyPlanService.getDailyTarget(user.userId);
  }
}