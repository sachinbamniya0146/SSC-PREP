/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Department } from '../common/decorators/department.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AutoPublishService } from './auto-publish.service';
import { DEFAULT_AUTO_PUBLISH } from './auto-publish.util';

/** Admin: the "Auto-publish" card of the Duplicates page. */
@Controller('bank/admin/auto-publish')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MODERATOR')
@Department('QUESTIONS')
export class AutoPublishController {
  constructor(
    private readonly auto: AutoPublishService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  async get() {
    const [config, log] = await Promise.all([this.auto.config(), this.auto.log()]);
    return { config, defaults: DEFAULT_AUTO_PUBLISH, log };
  }

  @Get('preview')
  preview() {
    return this.auto.preview();
  }

  @Put()
  async save(@CurrentUser() admin: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    const { config, before } = await this.auto.saveConfig(body, admin.userId);
    await this.audit.log({
      userId: admin.userId,
      action: 'AUTO_PUBLISH_SETTINGS_CHANGED',
      targetEntity: 'AppSetting',
      entityId: 'autopublish.config',
      metadataJson: { before, after: config } as any,
    });
    return { config };
  }

  @Post('run')
  async run() {
    const summary = await this.auto.run('manual');
    return { summary };
  }
}
