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
      queuedForReview: j.queuedForReview, queuedExact: j.queuedExact,
      errors: j.errors, warnings: j.warnings, uploadBatchId: j.uploadBatchId, fatalError: j.fatalError,
      hasRejected: j.rejectedRows.length > 0, kind: j.kind,
    };
  }

  private own(req: any, id: string): UploadJob {
    const j = this.jobs.get(id);
    if (!j) throw new NotFoundException('Upload job nahi mila (server restart ho gaya ya 1 ghante se purana hai). Upload History me result dekhein.');
    if (!this.isAdmin(req) && j.adminId !== this.adminId(req)) throw new ForbiddenException('Ye upload kisi aur ka hai.');
    return j;
  }

  @Post('start')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async start(@UploadedFile() file: any, @Req() req: any, @Body() body: any) {
    const practice = body?.kind === 'practice' || body?.isPracticeOnly === 'true';
    if (!this.isAdmin(req)) {
      const need = practice ? 'PRACTICE' : 'QUESTIONS';
      if (!(req.user?.permissions ?? []).includes(need)) {
        throw new ForbiddenException(practice
          ? 'Aapko Practice Questions upload karne ka access nahi hai. Admin se contact karein.'
          : 'Aapko PYQ / Question Bank upload karne ka access nahi hai. Admin se contact karein.');
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
    if (!j.rejectedRows.length) throw new BadRequestException('Koi rejected row nahi hai.');
    const out = this.jobs.buildRejected(j);
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="rejected_${j.id}.${out.ext}"`);
    res.send(out.buffer);
  }
}
