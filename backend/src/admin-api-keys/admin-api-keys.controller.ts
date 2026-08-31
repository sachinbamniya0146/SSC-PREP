import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import { AdminApiKeyService } from './admin-api-keys.service';

@Controller('admin/api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminApiKeyController {
  constructor(private readonly apiKeysService: AdminApiKeyService) {}

  // BUGFIX: this used @Body() on a GET request. GET requests don't carry a
  // body in normal browser/fetch usage (fetch() silently drops/rejects a
  // body on GET, and many proxies strip it too), so the `provider` filter
  // could never actually reach this handler from a real client — it always
  // received undefined and always returned every key regardless of the
  // filter the caller intended. Query params are how GET requests pass
  // filters; switched to @Query().
  @Get()
  async getKeys(@Query('provider') provider?: string) {
    return this.apiKeysService.getKeys(provider);
  }

  /** Active/total key counts per provider — for a small dashboard widget. */
  @Get('health')
  async getPoolHealth() {
    return this.apiKeysService.getPoolHealth();
  }

  /** Unresolved (or, with ?all=1, every) low-key / exhausted-key alerts. */
  @Get('alerts')
  async getAlerts(@Query('all') all?: string) {
    return this.apiKeysService.getAlerts(all === '1' || all === 'true');
  }

  @Post('alerts/:id/resolve')
  async resolveAlert(@Param('id') id: string) {
    return this.apiKeysService.resolveAlert(id);
  }

  @Post()
  async addKey(
    @CurrentUser() user: { userId: string },
    @Body() dto: {
      provider: string;
      keyName: string;
      apiKey: string;
      freeModelOnly?: boolean;
      isPrimary?: boolean;
    },
  ) {
    return this.apiKeysService.addKey(dto, user.userId);
  }

  /**
   * Bulk-upload many API keys for one provider at once — e.g. pasting a
   * newline/comma-separated list of free OpenRouter keys. Duplicate keys
   * (already stored, or repeated within the same paste) are skipped, not
   * duplicated, so re-uploading an overlapping list is safe.
   */
  @Post('bulk')
  async bulkAddKeys(
    @CurrentUser() user: { userId: string },
    @Body() dto: {
      provider: string;
      freeModelOnly?: boolean;
      // Either structured entries, or a single raw blob (newline/comma
      // separated) for quick copy-paste from a spreadsheet or notes app.
      keys?: { apiKey: string; keyName?: string }[];
      rawKeys?: string;
    },
  ) {
    const fromRaw = (dto.rawKeys || '')
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((apiKey) => ({ apiKey }));
    const keys = [...(dto.keys ?? []), ...fromRaw];
    return this.apiKeysService.bulkAddKeys({ provider: dto.provider, freeModelOnly: dto.freeModelOnly, keys }, user.userId);
  }

  @Put(':id')
  async updateKey(@Param('id') id: string, @Body() dto: {
    keyName?: string;
    apiKey?: string;
    isActive?: boolean;
    freeModelOnly?: boolean;
    isPrimary?: boolean;
  }) {
    return this.apiKeysService.updateKey(id, dto, 'system');
  }

  @Delete(':id')
  async deleteKey(@Param('id') id: string) {
    return this.apiKeysService.deleteKey(id);
  }
}
