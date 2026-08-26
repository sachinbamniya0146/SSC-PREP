import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
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

  @Get()
  async getKeys(@Body() body?: { provider?: string }) {
    return this.apiKeysService.getKeys(body?.provider);
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
