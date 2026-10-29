/* eslint-disable @typescript-eslint/no-explicit-any */
// Background upload jobs — lives under /bank/admin/upload/job so it inherits
// nginx's long-timeout / big-body "upload" location.
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Req, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Department } from '../common/decorators/department.decorator';
import { BankUploadJobService, UploadJob } from './bank-upload-job.service';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

@Controller('bank/admin/upload/job')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MODERATOR')
@Department('QUESTIONS', 'PRACTICE')
export class BankUploadJobController {
  constructor(private readonly jobs: BankUploadJobService) {}

  private adminId(req: any): string { return req.user?.userId ?? req.user?.id; }
  private isAdmin(req: any): boolean { return req.user?.role === 'ADMIN'; }

  private view(j: UploadJob) {
    return {
      id: j.id, status: j.status, phase: j.phase, dryRun: j.dryRun, filename: j.filename,
      total: j.total, processed: j.processed, created: j.created, failed: j.failed,
      queuedForReview: j.queuedForReview, queuedExact: j.queuedExact, reviewAlready: j.reviewAlready, unaccounted: j.unaccounted,
      errors: j.errors, warnings: j.warnings, uploadBatchId: j.uploadBatchId, fatalError: j.fatalError,
      hasRejected: j.rejectedRows.length > 0, kind: j.kind,
      updated: j.updated, unchanged: j.unchanged, preview: j.preview,
      papers: j.papers, pending: j.pending, pendingTotal: j.pendingTotal,
      // S37: PYQ + practice in one file (admin screens only - these carry exam dates)
      mixed: j.mixed, pyqRows: j.pyqRows, practiceRows: j.practiceRows, pyqWithoutQuestionNo: j.pyqWithoutQuestionNo,
      practicePlan: j.practicePlan, practicePlanTruncated: j.practicePlanTruncated, unknownExams: j.unknownExams, hindiMissingRows: j.hindiMissingRows.slice(0, 200),
    };
  }

  private own(req: any, id: string): UploadJob {
    const j = this.jobs.get(id);
    if (!j) throw new NotFoundException('Upload job not found (the server restarted or the job is older than 1 hour). Check Upload History for the result.');
    if (!this.isAdmin(req) && j.adminId !== this.adminId(req)) throw new ForbiddenException('This upload belongs to someone else.');
    return j;
  }

  @Post('start')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async start(@UploadedFile() file: any, @Req() req: any, @Body() body: any) {
    const practice = body?.kind === 'practice' || body?.isPracticeOnly === 'true';
    // S37: kind=mixed is the "PYQ + Practice (one Excel)" button - each row decides by itself, so the uploader needs BOTH departments
    const mixed = body?.kind === 'mixed' && !practice;
    if (!this.isAdmin(req)) {
      const has: string[] = req.user?.permissions ?? [];
      const need = mixed ? ['QUESTIONS', 'PRACTICE'] : [practice ? 'PRACTICE' : 'QUESTIONS'];
      if (!need.every((n) => has.includes(n))) {
        throw new ForbiddenException(mixed
          ? 'A PYQ + Practice file needs both the Questions and the Practice access. Please contact the admin.'
          : practice
            ? 'You do not have access to upload Practice Questions. Please contact the admin.'
            : 'You do not have access to upload PYQ / Question Bank questions. Please contact the admin.');
      }
    }
    if (!file) throw new BadRequestException('Multipart field "file" (.xlsx/.xls/.csv/.json) is required');
    const job = this.jobs.start({
      buffer: file.buffer,
      filename: file.originalname,
      adminId: this.adminId(req),
      isPracticeOnly: practice,
      requireSolution: body?.requireSolution !== 'false',
      dryRun: body?.dryRun === 'true',
      mixed,
    });
    return this.view(job);
  }

  @Get(':id')
  status(@Param('id') id: string, @Req() req: any) {
    return this.view(this.own(req, id));
  }

  @Get(':id/rejected')
  rejected(@Param('id') id: string, @Req() req: any, @Res() res: Response) {
    const j = this.own(req, id);
    if (!j.rejectedRows.length) throw new BadRequestException('There are no rejected rows.');
    const out = this.jobs.buildRejected(j);
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="rejected_${j.id}.${out.ext}"`);
    res.send(out.buffer);
  }
}
