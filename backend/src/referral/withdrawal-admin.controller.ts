import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { WithdrawalService } from './withdrawal.service';
import { MarkPaidDto, ReasonDto } from './dto/withdrawal.dto';

/** Admin: the withdrawal queue of Refer & Earn. Money moves here, so ADMIN only (no staff permission can reach it). */
@Controller('admin/withdrawals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class WithdrawalAdminController {
  constructor(private readonly withdrawals: WithdrawalService) {}

  @Get()
  list(@Query('status') status?: string, @Query('q') q?: string) {
    return this.withdrawals.list(status, q);
  }

  @Get('stats')
  stats() {
    return this.withdrawals.stats();
  }

  /** Sanction the request (nothing is sent yet). */
  @Post(':id/approve')
  approve(@CurrentUser() admin: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.approve(admin.userId, id);
  }

  /** Send a sanctioned request through Cashfree Payouts (only when it is configured). */
  @Post(':id/pay')
  pay(@CurrentUser() admin: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.pay(admin.userId, id);
  }

  /** The admin paid by hand and records the UTR. */
  @Post(':id/mark-paid')
  markPaid(@CurrentUser() admin: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: MarkPaidDto) {
    return this.withdrawals.markPaid(admin.userId, id, body.reference, body.note);
  }

  @Post(':id/reject')
  reject(@CurrentUser() admin: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.withdrawals.reject(admin.userId, id, body.reason);
  }

  /** Override for a stuck "Processing" request that the Cashfree dashboard shows as failed. */
  @Post(':id/mark-failed')
  markFailed(@CurrentUser() admin: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.withdrawals.markFailed(admin.userId, id, body.reason);
  }

  @Post(':id/check-status')
  checkStatus(@CurrentUser() admin: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.checkStatus(admin.userId, id);
  }
}
