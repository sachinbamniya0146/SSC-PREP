import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import { AiJobService, JobScopeDto } from './ai-job.service';
import { AiSystemCheckService } from './ai-system-check.service';

// Admin: central AI job engine (NEW Oct 15 2026).  Route ORDER matters: fixed paths first, ":id" paths last.
//   GET  /admin/ai-jobs/overview        health badge + keys + jobs + current item (polled every 3 s)
//   GET  /admin/ai-jobs/scope-meta      exams / subjects / chapters for the scope pickers
//   POST /admin/ai-jobs/estimate        how many questions / AI calls / ~time
//   POST /admin/ai-jobs/system-check    real end-to-end test
//   POST /admin/ai-jobs/model-health    run the hourly model health check now
//   POST /admin/ai-jobs/undo            { changeIds? | itemIds? | jobId }
//   POST /admin/ai-jobs/items/:itemId/accept|reject
//   POST /admin/ai-jobs                 create + start
//   GET  /admin/ai-jobs/:id , /:id/items
//   POST /admin/ai-jobs/:id/pause|resume|cancel|retry-failed|accept-all|reject-all
@Controller('admin/ai-jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AiJobController {
  constructor(
    private readonly jobs: AiJobService,
    private readonly check: AiSystemCheckService,
    private readonly ai: AiProviderService,
  ) {}

  @Get('overview')
  overview() {
    return this.jobs.overview();
  }

  @Get('scope-meta')
  scopeMeta() {
    return this.jobs.scopeMeta();
  }

  @Post('estimate')
  estimate(@Body() body: { type?: string; scope?: JobScopeDto; passes?: number }) {
    return this.jobs.estimate({ type: String(body?.type ?? ''), scope: body?.scope, passes: body?.passes });
  }

  @Post('system-check')
  systemCheck() {
    return this.check.run();
  }

  @Post('model-health')
  modelHealth() {
    return this.ai.runModelHealthCheck();
  }

  @Post('revive-keys')
  reviveKeys() {
    return this.ai.reviveKeys();
  }

  @Post('undo')
  undo(@CurrentUser() user: { userId: string }, @Body() body: { changeIds?: string[]; itemIds?: string[]; jobId?: string }) {
    return this.jobs.undo({ changeIds: body?.changeIds, itemIds: body?.itemIds, jobId: body?.jobId }, user.userId);
  }

  @Post('items/:itemId/accept')
  accept(@CurrentUser() user: { userId: string }, @Param('itemId') itemId: string) {
    return this.jobs.acceptItem(itemId, user.userId);
  }

  @Post('items/:itemId/reject')
  reject(@Param('itemId') itemId: string) {
    return this.jobs.rejectItem(itemId);
  }

  @Post()
  create(@CurrentUser() user: { userId: string }, @Body() body: { type?: string; scope?: JobScopeDto; passes?: number; title?: string }) {
    return this.jobs.createJob({ type: String(body?.type ?? ''), scope: body?.scope, passes: body?.passes, title: body?.title }, user.userId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.jobs.getJob(id);
  }

  @Get(':id/items')
  items(@Param('id') id: string, @Query('status') status?: string, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.jobs.listItems(id, { status: status || undefined, skip: skip ? Number(skip) : 0, take: take ? Number(take) : 25 });
  }

  @Post(':id/pause')
  pause(@Param('id') id: string) {
    return this.jobs.pause(id);
  }

  @Post(':id/resume')
  resume(@Param('id') id: string) {
    return this.jobs.resume(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.jobs.cancel(id);
  }

  @Post(':id/retry-failed')
  retry(@Param('id') id: string) {
    return this.jobs.retryFailed(id);
  }

  @Post(':id/accept-all')
  acceptAll(@CurrentUser() user: { userId: string }, @Param('id') id: string, @Body() body: { itemIds?: string[] }) {
    return this.jobs.bulkReview(id, 'accept', user.userId, body?.itemIds);
  }

  @Post(':id/reject-all')
  rejectAll(@CurrentUser() user: { userId: string }, @Param('id') id: string, @Body() body: { itemIds?: string[] }) {
    if (body?.itemIds && !Array.isArray(body.itemIds)) throw new BadRequestException('itemIds array hona chahiye.');
    return this.jobs.bulkReview(id, 'reject', user.userId, body?.itemIds);
  }
}
