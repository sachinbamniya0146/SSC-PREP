/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AuditLogService } from '../audit-log/audit-log.service';
import { FeaturesService } from './features.service';
import { FLAG_DEFS } from './features-config';

/** What the student app asks on every load: which sections are on, and the announcement banner. No login needed (signup page uses it). */
@Controller('features')
export class FeaturesPublicController {
  constructor(private readonly features: FeaturesService) {}

  @Public()
  @Get()
  get() {
    return this.features.getPublic();
  }
}

/** Admin: the Feature Controller page. */
@Controller('admin/features')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class FeaturesAdminController {
  constructor(
    private readonly features: FeaturesService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  async get() {
    return { ...(await this.features.get()), defs: FLAG_DEFS };
  }

  @Put()
  async save(@CurrentUser() admin: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    const { state, before } = await this.features.save(body, admin.userId);
    await this.audit.log({
      userId: admin.userId,
      action: 'FEATURES_CHANGED',
      targetEntity: 'AppSetting',
      entityId: 'features.config',
      metadataJson: { before, after: state } as any,
    });
    return { ...state, defs: FLAG_DEFS };
  }
}
