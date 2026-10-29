import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ReferralService } from './referral.service';
import { ReferralConfigService } from './referral-config.service';
import { DEFAULT_REFERRAL_CONFIG, parseWithdrawOverride } from './referral-config';

/** Admin control for the Refer & Earn programme: rules, commission review, reversals. */
@Controller('admin/referral-program')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ReferralAdminController {
  constructor(
    private readonly referral: ReferralService,
    private readonly config: ReferralConfigService,
    private readonly audit: AuditLogService,
  ) {}

  @Get('overview')
  overview() {
    return this.referral.adminOverview();
  }

  @Get('settings')
  async settings() {
    return { config: await this.config.get(), defaults: DEFAULT_REFERRAL_CONFIG };
  }

  @Put('settings')
  async saveSettings(@CurrentUser() admin: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    const { config, before } = await this.config.save(body, admin.userId);
    await this.audit.log({
      userId: admin.userId,
      action: 'REFERRAL_SETTINGS_CHANGED',
      targetEntity: 'AppSetting',
      entityId: 'referral.config',
      metadataJson: { before, after: config } as any,
    });
    return { config };
  }

  @Get('earnings')
  earnings(@Query('filter') filter?: string) {
    return this.referral.adminListEarnings(String(filter || 'all'));
  }

  @Post('earnings/:id/approve')
  async approve(@CurrentUser() admin: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.referral.approveHeldEarning(id);
    await this.audit.log({ userId: admin.userId, action: 'REFERRAL_EARNING_APPROVED', targetEntity: 'ReferralEarning', entityId: id });
    return r;
  }

  @Post('earnings/:id/reverse')
  async reverse(@CurrentUser() admin: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { note?: string }) {
    const note = String(body?.note ?? '').trim();
    const r = await this.referral.reverseEarning(id, note || 'Reversed by admin');
    await this.audit.log({
      userId: admin.userId,
      action: 'REFERRAL_EARNING_REVERSED',
      targetEntity: 'ReferralEarning',
      entityId: id,
      metadataJson: { note } as any,
    });
    return r;
  }

  // 30 Oct 2026 (Sachin: "admin kisi ko bhi 2 refer ke pehle ya 1 refer par hi paise nikalne ka option de sake").
  // Per-student override of "paying friends needed before a withdrawal". minFriends: 0..100, or null = follow the programme rule.
  @Post('users/:userId/withdraw-rule')
  async setWithdrawRule(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: { minFriends?: number | string | null; note?: string },
  ) {
    const parsed = parseWithdrawOverride(body?.minFriends);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    const note = String(body?.note ?? '').trim().slice(0, 200) || null;
    const r = await this.referral.setWithdrawRule(admin.userId, userId, parsed.value, note);
    await this.audit.log({
      userId: admin.userId,
      action: 'REFERRAL_WITHDRAW_RULE_CHANGED',
      targetEntity: 'User',
      entityId: userId,
      metadataJson: { ...r, note } as any,
    });
    return { ok: true, withdrawMinFriends: parsed.value };
  }

  // Release this student's pending commission now (skips the hold days). Flagged ones still need their own Approve.
  @Post('users/:userId/release-pending')
  async releaseUserPending(@CurrentUser() admin: AuthenticatedUser, @Param('userId', ParseUUIDPipe) userId: string) {
    const r = await this.referral.releaseUserNow(userId);
    await this.audit.log({
      userId: admin.userId,
      action: 'REFERRAL_PENDING_RELEASED_BY_ADMIN',
      targetEntity: 'User',
      entityId: userId,
      metadataJson: r as any,
    });
    return { ok: true, ...r };
  }

  @Post('release-now')
  async releaseNow() {
    return { released: await this.referral.releaseDue() };
  }
}
