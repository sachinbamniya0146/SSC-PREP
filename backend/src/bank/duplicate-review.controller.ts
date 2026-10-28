/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Department } from '../common/decorators/department.decorator';
import { DuplicateReviewService } from './duplicate-review.service';

// =============================================================================
// Duplicate review queue (NEW — Oct 6 2026). ADMIN / MODERATOR only.
// Routes are declared most-specific first so ":id/resolve" never swallows them.
// =============================================================================
@Controller('bank/admin/duplicates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MODERATOR')
@Department('QUESTIONS')
export class DuplicateReviewController {
  constructor(private readonly reviews: DuplicateReviewService) {}

  private adminId(req: any): string {
    return req.user?.userId ?? req.user?.id;
  }

  // GET /bank/admin/duplicates/counts  -> { pendingExact, pendingSimilar, pending, resolved }
  @Get('counts')
  counts() {
    return this.reviews.counts();
  }

  // GET /bank/admin/duplicates?status=PENDING|RESOLVED|ALL&matchType=EXACT|SIMILAR&batchId=&skip=&take=
  @Get()
  list(@Query() q: any) {
    return this.reviews.list({
      status: q?.status,
      matchType: q?.matchType,
      batchId: q?.batchId,
      resolvedStatus: q?.resolvedStatus,
      skip: q?.skip ? parseInt(q.skip, 10) || 0 : 0,
      take: q?.take ? parseInt(q.take, 10) || 20 : 20,
    });
  }

  // POST /bank/admin/duplicates/scan   body: { examId?, includeSimilar? }
  @Post('scan')
  scan(@Body() body: any, @Req() req: any) {
    return this.reviews.scan(this.adminId(req), {
      examId: body?.examId || undefined,
      includeSimilar: !!body?.includeSimilar,
    });
  }

  // POST /bank/admin/duplicates/bulk-resolve
  // body: { action, ids? }  OR  { action, matchType?, batchId?, confirm: true }  (every pending review matching the filter)
  @Post('bulk-resolve')
  bulkResolve(@Body() body: any, @Req() req: any) {
    const hasIds = Array.isArray(body?.ids) && body.ids.length > 0;
    if (!hasIds && !body?.confirm) {
      throw new BadRequestException('To apply to everything matching the filter, send confirm: true.');
    }
    return this.reviews.bulkResolve(
      {
        ids: body?.ids,
        matchType: body?.matchType,
        batchId: body?.batchId,
        action: body?.action,
        publish: body?.publish === true || body?.publish === 'true',
        skipIds: Array.isArray(body?.skipIds) ? body.skipIds : undefined,
      },
      this.adminId(req),
    );
  }

  // POST /bank/admin/duplicates/bulk-undo   (NEW Oct 14 2026)
  // body: { ids? }  OR  { resolvedStatus?: KEPT_NEW|KEPT_EXISTING|KEPT_BOTH, batchId?, confirm: true }
  @Post('bulk-undo')
  bulkUndo(@Body() body: any, @Req() req: any) {
    const hasIds = Array.isArray(body?.ids) && body.ids.length > 0;
    if (!hasIds && !body?.confirm) {
      throw new BadRequestException('To undo everything matching the filter, send confirm: true.');
    }
    return this.reviews.bulkUndo(
      {
        ids: body?.ids,
        resolvedStatus: body?.resolvedStatus,
        batchId: body?.batchId,
        skipIds: Array.isArray(body?.skipIds) ? body.skipIds : undefined,
      },
      this.adminId(req),
    );
  }

  // POST /bank/admin/duplicates/:id/undo   -> a resolved review goes back to PENDING (new hidden, old live again)
  @Post(':id/undo')
  undo(@Param('id') id: string, @Req() req: any) {
    return this.reviews.undo(id, this.adminId(req));
  }

  // POST /bank/admin/duplicates/:id/resolve   body: { action: KEEP_EXISTING | KEEP_NEW | KEEP_BOTH, publish?: boolean }
  @Post(':id/resolve')
  resolve(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.reviews.resolve(id, body?.action, this.adminId(req), { publish: body?.publish === true || body?.publish === 'true' });
  }
}
