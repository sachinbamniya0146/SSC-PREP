/* eslint-disable @typescript-eslint/no-explicit-any */
import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Department } from '../common/decorators/department.decorator';
import { PyqExportService, PyqGroupBy, PyqLayout } from './pyq-export.service';

const GROUPS: PyqGroupBy[] = ['none', 'exam', 'subject', 'chapter', 'hierarchy', 'tier', 'year', 'date'];

// GET /bank/admin/pyq-export?groupBy=chapter&layout=sheets|zip&examId=&subjectId=&chapterId=&year=&examDate=&tier=&dateState=&published=
@Controller('bank/admin/pyq-export')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MODERATOR')
@Department('QUESTIONS')
export class PyqExportController {
  constructor(private readonly exporter: PyqExportService) {}

  @Get('count')
  async count(@Query() q: any) {
    return { count: await this.exporter.count(this.filters(q)) };
  }

  @Get()
  async download(@Query() q: any, @Res() res: Response) {
    const groupBy: PyqGroupBy = GROUPS.includes(q.groupBy) ? q.groupBy : 'none';
    const layout: PyqLayout = q.layout === 'zip' ? 'zip' : 'sheets';
    const { buffer, contentType, filename } = await this.exporter.exportPyq(this.filters(q), groupBy, layout);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  private filters(q: any) {
    const year = q.year ? parseInt(q.year, 10) : undefined;
    return {
      examId: q.examId || undefined,
      subjectId: q.subjectId || undefined,
      chapterId: q.chapterId || undefined,
      topicId: q.topicId || undefined,
      year: year && Number.isFinite(year) ? year : undefined,
      examDate: /^\d{4}-\d{2}-\d{2}$/.test(q.examDate || '') ? q.examDate : undefined,
      tier: q.tier || undefined,
      dateState: ['mapped', 'unmapped'].includes(q.dateState) ? q.dateState : 'all',
      published: ['published', 'unpublished'].includes(q.published) ? q.published : 'all',
    } as const;
  }
}
