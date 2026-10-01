/* eslint-disable @typescript-eslint/no-explicit-any */
// BUG FIX (audit round 3, "Bonus check" item): BankUploadService existed with
// fully-working Excel/CSV/Text/JSON-lines/Word bulk-question-import logic
// (validation, duplicate detection, reference-ID checks, audit logging) but
// was NEVER registered as a provider anywhere and NO controller exposed it.
// Every "upload questions" template the admin could download
// (GET /admin/help/templates/*) had nothing on the other end to receive the
// filled-in file — the whole bulk-upload feature was dead on arrival.
// This controller wires it up for real, admin/moderator-only.
import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  Body,
  Req,
  BadRequestException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Department } from '../common/decorators/department.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { BankUploadService } from './bank-upload.service';
import { TaxonomyImportService } from './taxonomy-import.service';
import { parseQuestionKind } from '../common/question-visibility';
import { S3Service } from '../s3/s3.service';

// Oct 1 2026: 20MB -> 100MB so a 1-lakh-question Excel fits (100MB is also the Cloudflare free-plan request cap; nginx allows 300m).
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

@Controller('bank/admin/upload')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MODERATOR')
@Department('QUESTIONS', 'PRACTICE') // class default: either question department
export class BankUploadController {
  constructor(
    private readonly uploadService: BankUploadService,
    private readonly taxonomyImportService: TaxonomyImportService,
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  private adminId(req: any): string {
    return req.user?.userId ?? req.user?.id;
  }

  private isAdmin(req: any): boolean {
    return req.user?.role === 'ADMIN';
  }

  // DEPARTMENT RULE: PYQ / main-bank uploads need the QUESTIONS department,
  // practice-only uploads need PRACTICE. Admin passes both. RolesGuard has
  // already copied the live permissions onto req.user.
  private assertUploadDepartment(req: any, practice: boolean) {
    if (this.isAdmin(req)) return;
    const need = practice ? 'PRACTICE' : 'QUESTIONS';
    const has: string[] = req.user?.permissions ?? [];
    if (!has.includes(need)) {
      throw new ForbiddenException(
        practice
          ? 'Aapko Practice Questions upload karne ka access nahi hai. Admin se contact karein.'
          : 'Aapko PYQ / Question Bank upload karne ka access nahi hai. Admin se contact karein.',
      );
    }
  }

  // Staff (non-admin) can only see / touch upload batches they created
  // themselves — so a Practice uploader can never publish or wipe a
  // Questions uploader's batch (and vice-versa). Admin sees everything.
  private async assertBatchAccess(req: any, id: string) {
    if (this.isAdmin(req)) return;
    const b = await this.prisma.questionUploadBatch.findUnique({
      where: { id },
      select: { adminId: true },
    });
    if (!b) throw new BadRequestException('Upload batch not found');
    if (b.adminId !== this.adminId(req)) {
      throw new ForbiddenException('Ye upload kisi aur ne kiya hai — aap sirf apne uploads manage kar sakte hain.');
    }
  }

  // BUGFIX ("admin ke liye alag practice question upload feature" —
  // isPracticeOnly checkbox on /admin): the frontend's submitUpload()
  // already appended `formData.append("isPracticeOnly", "true")` when the
  // admin checked the box, but every handler below ignored it completely —
  // no @Body() param existed to read it, so the flag went nowhere and the
  // checkbox was a no-op. Multer (FileInterceptor) parses other multipart
  // text fields into req.body same as it always has; @Body('isPracticeOnly')
  // reads it as the string "true" (multipart fields are always strings) —
  // compared explicitly below rather than truthy-checked, since the
  // string "false" would otherwise also count as checked.
  //
  // Sep 21 2026: the admin page now has two big separate buttons and sends
  // `kind=practice` or `kind=pyq` (plus the legacy isPracticeOnly flag, still
  // honoured). kind=practice == isPracticeOnly.
  private isPracticeOnlyFlag(body: any): boolean {
    return body?.isPracticeOnly === 'true' || body?.isPracticeOnly === true || body?.kind === 'practice';
  }

  // A PYQ upload whose rows have no year would silently become practice
  // questions — surface that as a warning on the result instead.
  private async afterUpload<T extends { uploadBatchId?: string; warnings: any[] }>(result: T, body: any): Promise<T> {
    if (body?.kind === 'pyq') {
      await this.uploadService.warnYearlessInPyqUpload(result as any);
    }
    return result;
  }

  // Oct 1 2026: any unexpected (non-HTTP) failure used to surface as a blank
  // "Internal server error". Now the real cause is returned so the admin (and
  // I) can see what went wrong.
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new InternalServerErrorException(`Upload failed unexpectedly: ${msg}`);
    }
  }

  private isAsyncFlag(body: any): boolean {
    return body?.async === 'true' || body?.async === true;
  }

  // Progress / result of a background (async) import — poll every ~2 s.
  @Get('jobs/:id')
  getUploadJob(@Param('id') id: string, @Req() req: any) {
    return this.uploadService.getUploadJob(id, this.adminId(req));
  }

  @Post('excel')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadExcel(@UploadedFile() file: any, @Req() req: any, @Body() body: any) {
    this.assertUploadDepartment(req, this.isPracticeOnlyFlag(body));
    if (!file) throw new BadRequestException('Multipart field "file" (.xlsx/.xls) is required');
    if (this.isAsyncFlag(body)) {
      return this.guard(() =>
        this.uploadService.startBackgroundUpload('EXCEL', file.buffer, this.adminId(req), file.originalname, this.isPracticeOnlyFlag(body), (r) => this.afterUpload(r, body)),
      );
    }
    return this.guard(async () =>
      this.afterUpload(
        await this.uploadService.uploadFromExcel(file.buffer, this.adminId(req), file.originalname, this.isPracticeOnlyFlag(body)),
        body,
      ),
    );
  }

  @Post('csv')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadCsv(@UploadedFile() file: any, @Req() req: any, @Body() body: any) {
    this.assertUploadDepartment(req, this.isPracticeOnlyFlag(body));
    if (!file) throw new BadRequestException('Multipart field "file" (.csv) is required');
    if (this.isAsyncFlag(body)) {
      return this.guard(() =>
        this.uploadService.startBackgroundUpload('CSV', file.buffer, this.adminId(req), file.originalname, this.isPracticeOnlyFlag(body), (r) => this.afterUpload(r, body)),
      );
    }
    return this.guard(async () =>
      this.afterUpload(
        await this.uploadService.uploadFromCSV(file.buffer, this.adminId(req), file.originalname, this.isPracticeOnlyFlag(body)),
        body,
      ),
    );
  }

  // Accepts both tab-separated .txt files AND raw JSON-array .json/.txt files —
  // BankUploadService.uploadFromText() already auto-detects JSON vs tab-separated.
  @Post('text')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadText(@UploadedFile() file: any, @Req() req: any, @Body() body: any) {
    this.assertUploadDepartment(req, this.isPracticeOnlyFlag(body));
    if (!file) throw new BadRequestException('Multipart field "file" (.txt/.json) is required');
    return this.afterUpload(
      await this.uploadService.uploadFromText(file.buffer, this.adminId(req), file.originalname, this.isPracticeOnlyFlag(body)),
      body,
    );
  }

  // Same handler as /text but named for clarity when the admin picks "JSON file" in the UI.
  @Post('json')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadJsonFile(@UploadedFile() file: any, @Req() req: any, @Body() body: any) {
    this.assertUploadDepartment(req, this.isPracticeOnlyFlag(body));
    if (!file) throw new BadRequestException('Multipart field "file" (.json) is required');
    return this.afterUpload(
      await this.uploadService.uploadFromText(file.buffer, this.adminId(req), file.originalname, this.isPracticeOnlyFlag(body)),
      body,
    );
  }

  // Paste-in JSON (no file) — e.g. admin copy-pastes an array of question
  // objects generated by an AI prompt straight into a textarea.
  @Post('json-paste')
  async uploadJsonPaste(@Body() body: any, @Req() req: any) {
    this.assertUploadDepartment(req, !Array.isArray(body) && this.isPracticeOnlyFlag(body));
    const questions = Array.isArray(body) ? body : body?.questions;
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new BadRequestException('Body must be a JSON array of questions, or { "questions": [...] }');
    }
    // isPracticeOnly only applies when body is the { questions, isPracticeOnly }
    // shape — a bare array has nowhere to carry it, which is fine (that path
    // isn't used by the /admin checkbox flow today).
    const isPracticeOnly = !Array.isArray(body) && this.isPracticeOnlyFlag(body);
    const buffer = Buffer.from(JSON.stringify(questions), 'utf-8');
    return this.uploadService.uploadFromText(buffer, this.adminId(req), undefined, isPracticeOnly);
  }

  @Post('word')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadWord(@UploadedFile() file: any, @Req() req: any, @Body() body: any) {
    this.assertUploadDepartment(req, this.isPracticeOnlyFlag(body));
    if (!file) throw new BadRequestException('Multipart field "file" (.docx) is required');
    return this.afterUpload(
      await this.uploadService.uploadFromWord(file.buffer, this.adminId(req), file.originalname, this.isPracticeOnlyFlag(body)),
      body,
    );
  }

  // Session 24 — for diagram question types that AREN'T simple Venn circles
  // (mirror image, figure series, embedded figures, paper folding, dice/
  // clock). Upload ONE real image here, get back a URL, then paste that
  // URL into the questionImageUrl / optionImageUrls column of a normal
  // bulk Excel/CSV/JSON upload (same two-step pattern as diagramType
  // codes). See BankUploadService.uploadQuestionImage() / GET
  // /admin/help/diagram-types for the full explanation.
  @Post('question-image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadQuestionImage(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('Multipart field "file" (png/jpg/webp/svg) is required');
    return this.uploadService.uploadQuestionImage(file);
  }

  // NEW (Sep 29 2026) — upload MANY images in one request (up to 40) and get a
  // {originalName -> url} table back, so an admin can paste the URLs straight
  // into the questionImageUrl / optionImageUrls columns of the Excel. One bad
  // file never fails the rest: every file gets its own ok/error entry.
  @Post('question-images')
  @UseInterceptors(FilesInterceptor('files', 40, { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadQuestionImages(@UploadedFiles() files: any[]) {
    if (!files?.length) throw new BadRequestException('Multipart field "files" (one or more png/jpg/webp/svg) is required');
    const results: { name: string; ok: boolean; url?: string; key?: string; error?: string }[] = [];
    for (const f of files) {
      try {
        const r = await this.uploadService.uploadQuestionImage(f);
        results.push({ name: f.originalname, ok: true, url: r.url, key: r.key });
      } catch (e: any) {
        results.push({ name: f.originalname, ok: false, error: e?.response?.message || e?.message || 'Upload failed' });
      }
    }
    return { total: results.length, uploaded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }

  // NEW (Sep 29 2026) — one-click diagnosis of image storage. Does a real
  // write -> read -> delete round trip against R2/S3 (or local disk when S3 is
  // not configured) and returns plain-language hints for whatever is missing.
  @Get('storage-health')
  storageHealth() {
    return this.s3.healthCheck();
  }

  // NEW (Sep 29 2026) — the whole syllabus (Subject > Chapter > Topic >
  // Sub-topic) as an Excel the admin can download, edit and re-import via
  // /syllabus-excel. Same "English\nHindi" layout the importer reads.
  @Get('syllabus-export')
  @Department('QUESTIONS', 'PRACTICE')
  async syllabusExport(@Res() res: Response) {
    const buffer = await this.taxonomyImportService.exportToExcel();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="ssc-syllabus.xlsx"');
    res.send(buffer);
  }

  // NEW (this session) — "admin ek click me poora question bank download kar
  // sake" so re-uploads only ever add genuinely new questions. Exports in
  // the exact same column shape as the upload templates (uses examId/
  // subjectId/chapterId/year filters to keep an export scoped/manageable on
  // a large bank; omit all filters for the full bank, capped at 20,000 rows
  // — see BankUploadService.exportQuestionBank()).
  @Get('export')
  async exportBank(
    @Query('format') format: string | undefined,
    @Query('examId') examId: string | undefined,
    @Query('subjectId') subjectId: string | undefined,
    @Query('chapterId') chapterId: string | undefined,
    @Query('year') year: string | undefined,
    @Query('topicId') topicId: string | undefined,
    @Query('subTopicId') subTopicId: string | undefined,
    @Query('batchId') batchId: string | undefined,
    @Query('kind') kind: string | undefined,
    @Res() res: Response,
  ) {
    const fmt = (format === 'json' || format === 'csv' || format === 'excel') ? format : 'excel';
    const { buffer, contentType, filename } = await this.uploadService.exportQuestionBank(
      {
        examId, subjectId, chapterId, topicId, subTopicId,
        year: year ? parseInt(year, 10) : undefined,
        uploadBatchId: batchId,
        kind: parseQuestionKind(kind),
      },
      fmt,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  // NEW ("chuninda questions ka Excel export jinme Hindi translation ya
  // solution ya answer key missing hai — dono PYQ aur Practice questions ke
  // liye"): same auth/roles as the export above, one level down — narrows
  // to only the questions with a genuine gap instead of the whole bank.
  // ?type=hindi|solution|answer|all (default all) picks which gap(s) to
  // include; ?isPyq=true only exports year-tagged (PYQ) questions,
  // ?isPyq=false only exports year-less (practice) questions, omit for
  // both in one file (see BankService.questionsWithGaps() for exact
  // definitions).
  @Get('export-gaps')
  async exportGaps(
    @Query('format') format: string | undefined,
    @Query('type') type: string | undefined,
    @Query('examId') examId: string | undefined,
    @Query('chapterId') chapterId: string | undefined,
    @Query('isPyq') isPyq: string | undefined,
    @Res() res: Response,
  ) {
    const fmt = (format === 'json' || format === 'csv' || format === 'excel') ? format : 'excel';
    const gapType = (type === 'hindi' || type === 'solution' || type === 'answer') ? type : 'all';
    const { buffer, contentType, filename } = await this.uploadService.exportQuestionGaps(
      {
        type: gapType,
        examId,
        chapterId,
        isPyq: isPyq === 'true' ? true : isPyq === 'false' ? false : undefined,
      },
      fmt,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  // BUGFIX (this session — "last upload se aaye questions delete karne ka
  // option": frontend/src/app/admin/page.tsx's loadBatches()/
  // toggleBatchDetail()/deleteBatchHandler() were ALREADY calling
  // GET /bank/admin/upload/batches, GET .../batches/:id, and
  // DELETE .../batches/:id — but no route for any of them existed on this
  // controller, so every one of those calls 404'd. BankUploadService's
  // listUploadBatches()/getUploadBatchDetail()/deleteUploadBatch() were
  // fully implemented and completely unreachable. Wires them up for real.
  @Get('batches')
  async listBatches(@Req() req: any, @Query('mine') mine: string | undefined) {
    // Non-admin staff are always scoped to their own uploads.
    if (!this.isAdmin(req)) return this.uploadService.listUploadBatches(this.adminId(req));
    // `?mine=1` scopes to the calling admin's own uploads; omit it to see
    // every admin's upload history (both are ADMIN/MODERATOR-only anyway).
    return this.uploadService.listUploadBatches(mine === '1' || mine === 'true' ? this.adminId(req) : undefined);
  }

  @Get('batches/:id')
  async getBatch(@Param('id') id: string, @Req() req: any) {
    await this.assertBatchAccess(req, id);
    return this.uploadService.getUploadBatchDetail(id);
  }

  @Delete('batches/:id')
  async deleteBatch(@Param('id') id: string, @Query('keepQuestions') keepQuestions: string | undefined, @Req() req: any) {
    await this.assertBatchAccess(req, id);
    return this.uploadService.deleteUploadBatch(id, keepQuestions === '1' || keepQuestions === 'true', this.adminId(req));
  }

  // NEW (Sep 21 2026) — "us excel ke questions download bhi kar sake":
  // re-exports every question that upload still holds, in the same column
  // shape as the upload template (+ readable name columns), so the file can
  // be re-uploaded as-is.
  @Get('batches/:id/download')
  async downloadBatch(@Param('id') id: string, @Query('format') format: string | undefined, @Res() res: Response, @Req() req: any) {
    await this.assertBatchAccess(req, id);
    const fmt = (format === 'json' || format === 'csv' || format === 'excel') ? format : 'excel';
    const batch = await this.uploadService.getUploadBatchDetail(id);
    const { buffer, contentType, filename } = await this.uploadService.exportQuestionBank({ uploadBatchId: id }, fmt);
    const base = (batch.filename || `upload_${id.slice(0, 8)}`).replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\-]+/g, '_');
    const ext = filename.split('.').pop();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${base}_current.${ext}"`);
    res.send(buffer);
  }

  // NEW — publish every still-pending question of this upload in one click.
  @Post('batches/:id/publish')
  async publishBatch(@Param('id') id: string, @Req() req: any) {
    await this.assertBatchAccess(req, id);
    return this.uploadService.publishUploadBatch(id);
  }

  // NEW — delete only one subject's / chapter's / topic's / sub-topic's
  // questions out of an upload (the upload record itself stays).
  @Delete('batches/:id/questions')
  async deleteBatchQuestions(
    @Param('id') id: string,
    @Query('subjectId') subjectId: string | undefined,
    @Query('chapterId') chapterId: string | undefined,
    @Query('topicId') topicId: string | undefined,
    @Query('subTopicId') subTopicId: string | undefined,
    @Req() req: any,
  ) {
    await this.assertBatchAccess(req, id);
    return this.uploadService.deleteUploadBatchQuestions(id, { subjectId, chapterId, topicId, subTopicId }, this.adminId(req));
  }

  // Bulk syllabus (taxonomy) importer — upload a bilingual syllabus workbook
  // laid out like SSC_Exams_Complete_Syllabus_Hindi.xlsx (one sheet per
  // subject, "English\nHindi" cells for Chapter/Topic/Sub-Topic) and it gets
  // upserted straight into Subject -> Chapter -> Topic -> SubTopic. Safe to
  // re-run on the same or an edited file — matching rows are updated, not
  // duplicated. See TaxonomyImportService for the exact expected layout.
  @Post('syllabus-excel')
  @Department('QUESTIONS')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadSyllabusExcel(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('Multipart field "file" (.xlsx/.xls) is required');
    return this.taxonomyImportService.importFromExcel(file.buffer);
  }
}
