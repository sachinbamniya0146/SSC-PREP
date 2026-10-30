import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { StudyStatsService } from './study-stats.service';

@ApiTags('Study stats')
@ApiBearerAuth()
@Controller('study-stats')
export class StudyStatsController {
  constructor(private readonly svc: StudyStatsService) {}

  @Get()
  @ApiOperation({ summary: 'My solved-question counts: today / week / month / year / all time, daily-weekly-monthly series, subject and chapter split' })
  overview(@CurrentUser() user: { userId: string }, @Query('period') period?: string) {
    return this.svc.overview(user.userId, period);
  }
}
