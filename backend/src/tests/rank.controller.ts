import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RankService } from './rank.service';

/** Result-page rank: All-India + State, and the per-test toppers list. */
@Controller('tests')
export class RankController {
  constructor(private readonly rank: RankService) {}

  @Get('attempts/:attemptId/rank')
  attemptRank(@CurrentUser() user: { userId: string }, @Param('attemptId') attemptId: string) {
    return this.rank.forAttempt(user.userId, attemptId);
  }

  @Get('rank/leaderboard/:templateId')
  leaderboard(
    @CurrentUser() user: { userId: string },
    @Param('templateId') templateId: string,
    @Query('scope') scope?: string,
  ) {
    return this.rank.leaderboard(user.userId, templateId, scope === 'state' ? 'mine' : undefined);
  }
}
