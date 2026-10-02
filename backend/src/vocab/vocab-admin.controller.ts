import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Department } from '../common/decorators/department.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { VocabUploadService } from './vocab-upload.service';
import { archiveWordProgress } from './vocab-unlock-memory';
import { AuditLogService } from '../audit-log/audit-log.service';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

@Controller('vocab/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MODERATOR')
@Department('VOCABULARY') // only staff granted the Vocabulary department (admin always passes)
export class VocabAdminController {
  constructor(
    private readonly upload: VocabUploadService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // Ready-to-fill Excel template (Words + Questions + Instructions sheets).
  @Get('template')
  template(@Res() res: Response) {
    const buf = this.upload.buildTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="vocabulary_import_template.xlsx"');
    res.send(buf);
  }

  // "admin vocab ke questions ko bhi excel se... upload kar sake, jesa PYQ ka
  // scene hai same vesa hi" — see Vocabulary_30Words_Import.xlsx for the
  // exact two-sheet (Words + Questions) format this expects.
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadExcel(@UploadedFile() file: any, @Req() req: any, @Body() body: any) {
    if (!file) throw new BadRequestException('Multipart field "file" (.xlsx) is required');
    const dryRun = body?.dryRun === 'true' || body?.dryRun === true;
    const result = await this.upload.uploadFromExcel(file.buffer, dryRun);
    // who uploaded what — visible to the admin in the audit log
    if (!dryRun) await this.audit.log({
      userId: req.user?.userId,
      action: 'VOCAB_UPLOAD',
      targetEntity: 'VocabWord',
      metadataJson: {
        filename: file.originalname,
        wordsCreated: result.wordsCreated,
        wordsSkipped: result.wordsSkipped,
        questionsCreated: result.questionsCreated,
        questionsSkipped: result.questionsSkipped,
        errorCount: result.errors.length,
      },
    }).catch(() => undefined);
    return result;
  }

  @Get('words')
  async listWords(@Query('q') q?: string) {
    const words = await this.prisma.vocabWord.findMany({
      where: q ? { word: { contains: q, mode: 'insensitive' } } : undefined,
      orderBy: { orderIndex: 'asc' },
      include: { _count: { select: { questions: true, progress: true } } },
    });
    return words.map((w) => ({
      id: w.id,
      slug: w.slug,
      word: w.word,
      orderIndex: w.orderIndex,
      isActive: w.isActive,
      questionCount: w._count.questions,
      studentsProgressing: w._count.progress,
    }));
  }

  @Put('words/:id')
  async updateWord(@Param('id') id: string, @Body() body: { orderIndex?: number; isActive?: boolean }) {
    const existing = await this.prisma.vocabWord.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Word not found');
    const data: { orderIndex?: number; isActive?: boolean } = {};
    if (body.orderIndex !== undefined) data.orderIndex = Number(body.orderIndex);
    if (body.isActive !== undefined) data.isActive = !!body.isActive;
    return this.prisma.vocabWord.update({ where: { id }, data });
  }

  // Oct 2026: delete is now SOFT by default (word hidden from students, everything kept) because a hard
  // delete wipes every student's progress and used to push them backwards / re-lock words. Re-uploading the
  // same word later simply re-activates it with all progress intact. Pass ?hard=true only for a mis-import
  // that no student has touched — a hard delete still cascades questions AND progress.
  @Delete('words/:id')
  async deleteWord(@Param('id') id: string, @Query('hard') hard?: string) {
    const existing = await this.prisma.vocabWord.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Word not found');
    if (hard === 'true') {
      // keep every student's unlock/mastery of this word so a later re-upload of the same word restores it
      const kept = await archiveWordProgress(this.prisma, id);
      await this.prisma.vocabWord.delete({ where: { id } });
      return { deleted: true, hard: true, studentsKept: kept };
    }
    await this.prisma.vocabWord.update({ where: { id }, data: { isActive: false } });
    return { deleted: true, hard: false, note: 'Word hide ho gaya; students ka progress safe hai. Dobara upload karne par wapas active ho jayega.' };
  }
}
