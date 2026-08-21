/* eslint-disable @typescript-eslint/no-explicit-any */
import { Controller, Get, Post, Query, Req, UseGuards, Body } from '@nestjs/common';
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
  leaderboard(@Req() req: any, @Query('period') period?: string, @Query('includeFriends') includeFriends?: string) {
    return this.gamification.leaderboard(req.user.userId, period === 'weekly' ? 'weekly' : 'all', undefined, includeFriends === 'true');
  }

  /** Compare rank with friends */
  @Get('compare')
  async compareWithFriends(@Req() req: any) {
    return this.gamification.compareWithFriends(req.user.userId);
  }

  /** Get friends list */
  @Get('friends')
  async getFriends(@Req() req: any) {
    return this.gamification.getFriends(req.user.userId);
  }

  /** Send a friend request */
  @Post('friends/request')
  async sendFriendRequest(@Req() req: any, @Body() body: { receiverId: string; message?: string }) {
    return this.gamification.sendFriendRequest(req.user.userId, body.receiverId, body.message);
  }

  /** Accept/reject a friend request */
  @Post('friends/respond')
  async respondToFriendRequest(@Req() req: any, @Body() body: { requestId: string; action: 'accept' | 'reject' }) {
    return this.gamification.respondToFriendRequest(req.user.userId, body.requestId, body.action);
  }
}
