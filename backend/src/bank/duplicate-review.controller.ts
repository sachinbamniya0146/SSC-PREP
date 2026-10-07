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
      throw new BadRequestException('Filter ke hisaab se sab par lagane ke liye confirm: true bhejein. / confirm: true required.');
    }
    return this.reviews.bulkResolve(
      { ids: body?.ids, matchType: body?.matchType, batchId: body?.batchId, action: body?.action },
      this.adminId(req),
    );
  }

  // POST /bank/admin/duplicates/:id/resolve   body: { action: KEEP_EXISTING | KEEP_NEW | KEEP_BOTH }
  @Post(':id/resolve')
  resolve(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.reviews.resolve(id, body?.action, this.adminId(req));
  }
}
