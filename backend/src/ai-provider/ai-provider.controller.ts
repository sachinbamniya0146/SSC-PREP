import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminApiKeyService } from '../admin-api-keys/admin-api-keys.service';
import { AiProviderService } from './ai-provider.service';

// Admin: easy OpenRouter key handling (NEW — Oct 3 2026)
//   POST /admin/ai/keys/quick      { apiKey }  -> tests the key live, saves it as "OpenRouter Key N"
//   POST /admin/ai/keys/:id/test               -> "Test key" button on a saved key
//   GET  /admin/ai/keys/next-number            -> N for the "Add Key N" button
//   GET  /admin/ai/models                      -> the free models that are used right now
@Controller('admin/ai')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AiProviderController {
  constructor(
    private readonly ai: AiProviderService,
    private readonly keys: AdminApiKeyService,
  ) {}

  @Get('keys/next-number')
  async nextNumber() {
    return { next: await this.keys.nextKeyNumber('openrouter') };
  }

  @Get('models')
  async models() {
    return { models: await this.ai.getFreeModels() };
  }

  @Post('keys/quick')
  async quickAdd(@CurrentUser() user: { userId: string }, @Body() body: { apiKey?: string }) {
    const apiKey = String(body?.apiKey ?? '').trim();
    if (!apiKey) throw new BadRequestException('Key paste karein.');
    const test = await this.ai.testKey(apiKey);
    // a key OpenRouter itself rejects is not saved; a merely busy key is saved (it works later)
    if (test.status === 'invalid') throw new BadRequestException(test.message);
    const created = await this.keys.addNumbered(apiKey, user.userId, 'openrouter');
    if (test.ok) await this.keys.markHealthy(created.id);
    const next = await this.keys.nextKeyNumber('openrouter');
    return { key: created, test, next };
  }

  @Post('keys/:id/test')
  async testSaved(@Param('id') id: string) {
    const raw = await this.keys.getRawKey(id);
    const test = await this.ai.testKey(raw);
    if (test.ok) await this.keys.markHealthy(id);
    else await this.keys.markBroken(id, test.message);
    return test;
  }
}
