import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DailyTestService } from './daily-test.service';

@ApiTags('daily-test')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tests/daily-test')
export class DailyTestController {
  constructor(private readonly dailyTest: DailyTestService) {}

  // v3 §6.4 — today's Daily Test state (taken / resumable / fresh)
  @Get('status')
  @ApiOperation({ summary: 'Today Daily Test status' })
  status(@CurrentUser() user: { userId: string }) {
    return this.dailyTest.status(user.userId);
  }

  // Start (or resume) today's Daily Test — server-authoritative timed attempt
  @Post('start')
  @ApiOperation({ summary: 'Start/resume today Daily Test (one per day)' })
  start(@CurrentUser() user: { userId: string }) {
    return this.dailyTest.start(user.userId);
  }

  // Snapshot-backed paper — identical question set on mid-test refresh
  @Get('paper/:attemptId')
  @ApiOperation({ summary: 'Daily Test paper from the attempt snapshot' })
  paper(@CurrentUser() user: { userId: string }, @Param('attemptId') attemptId: string) {
    return this.dailyTest.paper(user.userId, attemptId);
  }
}