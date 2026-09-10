import { Controller, Get, Post, Body, UseGuards, Param, ParseUUIDPipe, BadRequestException } from '@nestjs/common';
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

  @Get('earnings')
  getEarnings(@CurrentUser() user: AuthenticatedUser) {
    return this.referralService.getMyEarnings(user.userId);
  }

  // ---- Payout method ----
  @Get('payout-method')
  getPayoutMethod(@CurrentUser() user: AuthenticatedUser) {
    return this.referralService.getPayoutMethod(user.userId);
  }

  @Post('payout-method')
  savePayoutMethod(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      type: 'UPI' | 'BANK_ACCOUNT';
      upiId?: string;
      bankAccountNo?: string;
      bankIfsc?: string;
      bankAccountName?: string;
    },
  ) {
    if (!body?.type) throw new BadRequestException('type is required (UPI or BANK_ACCOUNT)');
    return this.referralService.savePayoutMethod(user.userId, body);
  }

  // ---- Withdrawals ----
  @Post('withdraw')
  requestWithdrawal(@CurrentUser() user: AuthenticatedUser, @Body() body: { amountInr: number }) {
    return this.referralService.requestWithdrawal(user.userId, Number(body?.amountInr));
  }

  @Get('withdrawals')
  getMyWithdrawals(@CurrentUser() user: AuthenticatedUser) {
    return this.referralService.getMyWithdrawals(user.userId);
  }

  @Post('withdrawals/:id/cancel')
  cancelWithdrawal(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.referralService.cancelWithdrawal(user.userId, id);
  }
}
