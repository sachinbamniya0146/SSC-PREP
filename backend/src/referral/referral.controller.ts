import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ReferralService } from './referral.service';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('referral')
@UseGuards(JwtAuthGuard)
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Get('me')
  getMyReferral(@CurrentUser() user: AuthenticatedUser) {
    return this.referralService.getStats(user.userId);
  }

  @Post('apply')
  applyCode(@CurrentUser() user: AuthenticatedUser, @Body() body: { code?: string }) {
    return this.referralService.applyReferralCode(body.code ?? '', user.userId);
  }
}
