/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Department } from '../common/decorators/department.decorator';
import { TaxonomyDedupeService } from './taxonomy-dedupe.service';

// Duplicate topics / sub-topics panel. Merges are destructive → ADMIN only (moderators can't).
@Controller('bank/admin/taxonomy')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Department('QUESTIONS')
export class TaxonomyDedupeController {
  constructor(private readonly dedupe: TaxonomyDedupeService) {}

  private adminId(req: any): string | undefined {
    return req.user?.userId ?? req.user?.id;
  }

  @Get('duplicates')
  duplicates() {
    return this.dedupe.audit();
  }

  @Post('merge')
  merge(@Req() req: any, @Body() body: { kind?: string; survivorId?: string; loserIds?: string[] }) {
    if (body?.kind !== 'TOPIC' && body?.kind !== 'SUBTOPIC') throw new BadRequestException('kind TOPIC ya SUBTOPIC hona chahiye');
    if (!body.survivorId || !Array.isArray(body.loserIds) || body.loserIds.length === 0) throw new BadRequestException('survivorId aur loserIds required');
    return this.dedupe.mergeGroup(body.kind, body.survivorId, body.loserIds, this.adminId(req));
  }

  /** dryRun defaults to TRUE — a real run needs { dryRun: false, confirm: true }. */
  @Post('merge-all-exact')
  mergeAll(@Req() req: any, @Body() body: { dryRun?: boolean; confirm?: boolean }) {
    const dryRun = body?.dryRun !== false || body?.confirm !== true;
    return this.dedupe.mergeAllExact(this.adminId(req), dryRun);
  }

  @Get('merge-log')
  log(@Query('take') take?: string) {
    return this.dedupe.listLog(take ? Number(take) : 50);
  }

  @Post('merge-log/:id/undo')
  undo(@Param('id') id: string) {
    return this.dedupe.undo(id);
  }
}
