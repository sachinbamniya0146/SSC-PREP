/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Department } from '../common/decorators/department.decorator';
import { BankAdminService } from './bank-admin.service';
import { QuestionEditService } from './question-edit.service';

// =============================================================================
// Admin: open / edit ONE question, change details of many, translate, fix math.
// (NEW — Oct 3 2026)  Same guard rules as the rest of /bank/admin/manage.
// =============================================================================
@Controller('bank/admin/manage')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MODERATOR')
@Department('QUESTIONS', 'PRACTICE')
export class QuestionEditController {
  constructor(
    private readonly edit: QuestionEditService,
    private readonly admin: BankAdminService,
  ) {}

  private adminId(req: any): string | undefined {
    return req.user?.userId ?? req.user?.id;
  }

  /** :key = question uuid OR the unique question number (e.g. 1042). */
  // support staff may LOOK at a reported question; only question staff can change it
  @Get('question/:key')
  @Department('QUESTIONS', 'PRACTICE', 'SUPPORT')
  getOne(@Param('key') key: string) {
    return this.edit.getForEdit(key);
  }

  @Put('question/:id')
  updateOne(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.edit.update(id, body ?? {}, this.adminId(req));
  }

  // body: { ids?, filter?, set: { examId?, year?, shift?, examDate?, paperCode?, difficulty?, marks?, negativeMarks? } }
  @Post('questions/bulk-meta')
  bulkMeta(@Body() body: any, @Req() req: any) {
    return this.edit.bulkUpdateMeta(
      { ids: body?.ids, filter: body?.filter ? this.admin.parseFilter(body.filter) : undefined, set: body?.set ?? {} },
      this.adminId(req),
    );
  }

  @Get('filter-options')
  filterOptions(@Query('examId') examId?: string) {
    return this.edit.filterOptions(examId || undefined);
  }

  // body: { questionText?, options?: [{key,text}], explanation? }  ->  Hindi version
  @Post('translate')
  translate(@Body() body: any) {
    if (!body) throw new BadRequestException('Body required');
    return this.edit.translateToHindi(body);
  }

  @Post('fix-math')
  @Roles('ADMIN')
  fixMath(@Req() req: any) {
    return this.edit.fixMath(this.adminId(req));
  }
}
