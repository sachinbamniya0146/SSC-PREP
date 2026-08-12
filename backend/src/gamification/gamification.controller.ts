import { Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { GamificationService } from './gamification.service';

@Controller('gamification')
@UseGuards(JwtAuthGuard)
export class GamificationController {
  constructor(private gamification: GamificationService) {}

  @Get('me')
  myState(@Req() req: any) {
    return this.gamification.myState(req.user.userId);
  }

  @Post('checkin')
  checkIn(@Req() req: any) {
    return this.gamification.checkIn(req.user.userId);
  }

  @Get('leaderboard')
  leaderboard(@Req() req: any, @Query('period') period?: string) {
    return this.gamification.leaderboard(req.user.userId, period === 'weekly' ? 'weekly' : 'all');
  }
}
