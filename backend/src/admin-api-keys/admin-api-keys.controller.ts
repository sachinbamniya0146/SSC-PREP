import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
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

  @Post()
  async addKey(@Body() dto: {
    provider: string;
    keyName: string;
    apiKey: string;
    freeModelOnly?: boolean;
    isPrimary?: boolean;
  }) {
    return this.apiKeysService.addKey(dto, 'system');
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
