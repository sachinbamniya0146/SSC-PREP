import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ReferralService } from './referral.service';
import { ReferralConfigService } from './referral-config.service';
import { DEFAULT_REFERRAL_CONFIG } from './referral-config';

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

  @Post('release-now')
  async releaseNow() {
    return { released: await this.referral.releaseDue() };
  }
}
