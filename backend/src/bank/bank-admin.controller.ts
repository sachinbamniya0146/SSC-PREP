/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Department } from '../common/decorators/department.decorator';
import { BankAdminService } from './bank-admin.service';
import { BankUploadService, ExportSplit } from './bank-upload.service';

// =============================================================================
// Admin question manager + syllabus editor  (NEW — Sep 21 2026)
// Everything is ADMIN/MODERATOR only. See BankAdminService for the behaviour.
// =============================================================================
@Controller('bank/admin/manage')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MODERATOR')
@Department('QUESTIONS')
export class BankAdminController {
  constructor(private readonly admin: BankAdminService, private readonly uploads: BankUploadService) {}

  private adminId(req: any): string | undefined {
    return req.user?.userId ?? req.user?.id;
  }

  // ---- question manager ----
  @Get('questions')
  list(@Query() q: any) {
    return this.admin.listQuestions(
      this.admin.parseFilter(q),
      q?.skip ? parseInt(q.skip, 10) || 0 : 0,
      q?.take ? parseInt(q.take, 10) || 30 : 30,
    );
  }

  // GET /bank/admin/manage/export?<same filters as the list>&format=excel|csv|json&split=none|subject|chapter|subject_chapter|year|shift|exam&includeAll=1 (pending/hidden bhi)
  // (Oct 7 2026) — downloads every question matching the current filters; see BankUploadService.exportFiltered().
  @Get('export')
  async exportQuestions(@Query() q: any, @Res() res: Response) {
    const format = q?.format === 'csv' || q?.format === 'json' ? q.format : 'excel';
    const splits: ExportSplit[] = ['none', 'subject', 'chapter', 'subject_chapter', 'year', 'shift', 'exam'];
    const split: ExportSplit = splits.includes(q?.split) ? q.split : 'none';
    const out = await this.uploads.exportFiltered(this.admin.parseFilter(q), { format, split, includeAll: q?.includeAll === '1' || q?.includeAll === 'true' });
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(out.filename)}"; filename*=UTF-8''${encodeURIComponent(out.filename)}`);
    res.setHeader('X-Export-Total', String(out.total));
    res.setHeader('X-Export-Exported', String(out.exported));
    res.setHeader('X-Export-Capped', out.capped ? '1' : '0');
    res.setHeader('Access-Control-Expose-Headers', 'X-Export-Total, X-Export-Exported, X-Export-Capped, Content-Disposition');
    res.send(out.buffer);
  }

  // GET /bank/admin/manage/chapter-counts?subjectId=..&<other filters>  (Oct 7 2026)
  // -> { chapters: [{ id, name, nameHindi, total, visible }], noChapter } for the Download chapter picker
  @Get('chapter-counts')
  chapterCounts(@Query() q: any) {
    return this.admin.chapterCounts(this.admin.parseFilter(q));
  }

  @Get('stats')
  stats(@Query('examId') examId?: string) {
    return this.admin.stats(examId || undefined);
  }

  // body: { ids?: string[], filter?: {...}, target: { chapterId? | topicId? | subTopicId? } }
  @Post('questions/move')
  move(@Body() body: any, @Req() req: any) {
    return this.admin.moveQuestions(
      { ids: body?.ids, filter: body?.filter ? this.admin.parseFilter(body.filter) : undefined, target: body?.target ?? {} },
      this.adminId(req),
    );
  }

  // body: { ids?, filter?, action: 'publish' | 'unpublish' }
  @Post('questions/visibility')
  visibility(@Body() body: any, @Req() req: any) {
    return this.admin.setVisibility(
      { ids: body?.ids, filter: body?.filter ? this.admin.parseFilter(body.filter) : undefined, action: body?.action },
      this.adminId(req),
    );
  }

  // body: { ids?, filter?, confirm: true }  — a filter-based delete needs confirm:true
  @Post('questions/delete')
  remove(@Body() body: any, @Req() req: any) {
    if (!body?.confirm) throw new BadRequestException('confirm: true required for delete');
    return this.admin.deleteQuestions(
      { ids: body?.ids, filter: body?.filter ? this.admin.parseFilter(body.filter) : undefined },
      this.adminId(req),
    );
  }

  // ---- syllabus edit ----
  @Put('chapters/:id')
  updateChapter(@Param('id') id: string, @Body() body: any) {
    return this.admin.updateChapter(id, body ?? {});
  }
  @Put('topics/:id')
  updateTopic(@Param('id') id: string, @Body() body: any) {
    return this.admin.updateTopic(id, body ?? {});
  }
  @Put('subtopics/:id')
  updateSubTopic(@Param('id') id: string, @Body() body: any) {
    return this.admin.updateSubTopic(id, body ?? {});
  }

  @Delete('topics/:id')
  deleteTopic(@Param('id') id: string) {
    return this.admin.deleteTopic(id);
  }
  @Delete('chapters/:id')
  deleteChapter(@Param('id') id: string) {
    return this.admin.deleteChapter(id);
  }
  @Delete('subjects/:id')
  deleteSubject(@Param('id') id: string) {
    return this.admin.deleteSubject(id);
  }

  // body: { targetId }
  @Post('chapters/:id/merge')
  mergeChapter(@Param('id') id: string, @Body() body: any) {
    if (!body?.targetId) throw new BadRequestException('targetId required');
    return this.admin.mergeChapter(id, body.targetId);
  }
  @Post('topics/:id/merge')
  mergeTopic(@Param('id') id: string, @Body() body: any) {
    if (!body?.targetId) throw new BadRequestException('targetId required');
    return this.admin.mergeTopic(id, body.targetId);
  }
}
