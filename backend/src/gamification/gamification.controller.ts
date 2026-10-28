/* eslint-disable @typescript-eslint/no-explicit-any */
import { Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { GamificationService } from './gamification.service';
import { FeaturesService } from '../features/features.service';

@Controller('gamification')
@UseGuards(JwtAuthGuard)
export class GamificationController {
  constructor(
    private gamification: GamificationService,
    private features: FeaturesService,
  ) {}

  @Get('me')
  myState(@Req() req: any) {
    return this.gamification.myState(req.user.userId);
  }

  @Post('checkin')
  checkIn(@Req() req: any) {
    return this.gamification.checkIn(req.user.userId);
  }

  @Get('leaderboard')
  async leaderboard(@Req() req: any, @Query('period') period?: string, @Query('scope') scope?: string) {
    await this.features.assertEnabled('leaderboard');
    return this.gamification.leaderboard(req.user.userId, period === 'weekly' ? 'weekly' : 'all', 50, scope === 'state' ? 'state' : 'india');
  }
}
