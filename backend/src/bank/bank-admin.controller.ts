/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BankAdminService } from './bank-admin.service';

// =============================================================================
// Admin question manager + syllabus editor  (NEW — Sep 21 2026)
// Everything is ADMIN/MODERATOR only. See BankAdminService for the behaviour.
// =============================================================================
@Controller('bank/admin/manage')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MODERATOR')
export class BankAdminController {
  constructor(private readonly admin: BankAdminService) {}

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
