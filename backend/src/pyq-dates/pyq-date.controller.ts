/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, Controller, Get, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PyqDateService } from './pyq-date.service';
import { PyqExportService } from './pyq-export.service';

// Admin screen /admin/pyq-dates talks to these routes (ADMIN only: they spend AI-key quota).
@Controller('admin/pyq-dates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class PyqDateController {
  constructor(
    private readonly svc: PyqDateService,
    private readonly exporter: PyqExportService,
  ) {}

  @Get('overview')
  overview() {
    return this.svc.overview();
  }

  @Get('items')
  items(@Query() q: any) {
    return this.svc.listItems({
      status: q.status || undefined,
      examId: q.examId || undefined,
      subjectId: q.subjectId || undefined,
      chapterId: q.chapterId || undefined,
      year: q.year ? parseInt(q.year, 10) || undefined : undefined,
      tier: q.tier || undefined,
      q: q.q || undefined,
      skip: q.skip ? parseInt(q.skip, 10) || 0 : 0,
      take: q.take ? parseInt(q.take, 10) || 30 : 30,
    });
  }

  @Get('items/:questionId')
  item(@Param('questionId') id: string) {
    return this.svc.getItem(id);
  }

  @Put('config')
  config(@Body() body: any) {
    return this.svc.updateConfig({ autoRun: body?.autoRun, minAgeMinutes: body?.minAgeMinutes, batchSize: body?.batchSize, passes: body?.passes });
  }

  // body: { scope: 'unmapped'|'ids'|'retry', ids?, examId?, subjectId?, chapterId?, year?, statuses?, verifyExisting? }
  @Post('enqueue')
  enqueue(@Body() body: any) {
    return this.svc.enqueue(body ?? {});
  }

  @Post('run-now')
  runNow(@Body() body: any) {
    const n = Number(body?.limit);
    return this.svc.kick(Number.isFinite(n) && n > 0 ? Math.min(n, 10) : undefined);
  }

  @Post('items/:questionId/accept')
  accept(@Param('questionId') id: string) {
    return this.svc.acceptProposed(id);
  }

  @Post('items/:questionId/manual')
  manual(@Param('questionId') id: string, @Body() body: any) {
    return this.svc.setManual(id, { examDate: body?.examDate, examTier: body?.examTier });
  }

  @Post('items/:questionId/reject')
  reject(@Param('questionId') id: string) {
    return this.svc.reject(id);
  }

  @Post('test-search')
  testSearch(@Body() body: any) {
    return this.svc.testSearch(body?.q);
  }

  @Get('export')
  async export(@Query('status') status: string | undefined, @Query('examId') examId: string | undefined, @Res() res: Response) {
    const { buffer, filename } = await this.exporter.exportDateMapping({ status: status || undefined, examId: examId || undefined });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
