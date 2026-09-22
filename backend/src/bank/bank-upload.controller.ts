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
  Body,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BankUploadService } from './bank-upload.service';
import { TaxonomyImportService } from './taxonomy-import.service';
import { parseQuestionKind } from '../common/question-visibility';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB — question files are text/spreadsheets, not media

@Controller('bank/admin/upload')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MODERATOR')
export class BankUploadController {
  constructor(
    private readonly uploadService: BankUploadService,
    private readonly taxonomyImportService: TaxonomyImportService,
  ) {}

  private adminId(req: any): string {
    return req.user?.userId ?? req.user?.id;
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

  @Post('excel')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadExcel(@UploadedFile() file: any, @Req() req: any, @Body() body: any) {
    if (!file) throw new BadRequestException('Multipart field "file" (.xlsx/.xls) is required');
    return this.afterUpload(
      await this.uploadService.uploadFromExcel(file.buffer, this.adminId(req), file.originalname, this.isPracticeOnlyFlag(body)),
      body,
    );
  }

  @Post('csv')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadCsv(@UploadedFile() file: any, @Req() req: any, @Body() body: any) {
    if (!file) throw new BadRequestException('Multipart field "file" (.csv) is required');
    return this.afterUpload(
      await this.uploadService.uploadFromCSV(file.buffer, this.adminId(req), file.originalname, this.isPracticeOnlyFlag(body)),
      body,
    );
  }

  // Accepts both tab-separated .txt files AND raw JSON-array .json/.txt files —
  // BankUploadService.uploadFromText() already auto-detects JSON vs tab-separated.
  @Post('text')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadText(@UploadedFile() file: any, @Req() req: any, @Body() body: any) {
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
    // `?mine=1` scopes to the calling admin's own uploads; omit it to see
    // every admin's upload history (both are ADMIN/MODERATOR-only anyway).
    return this.uploadService.listUploadBatches(mine === '1' || mine === 'true' ? this.adminId(req) : undefined);
  }

  @Get('batches/:id')
  async getBatch(@Param('id') id: string) {
    return this.uploadService.getUploadBatchDetail(id);
  }

  @Delete('batches/:id')
  async deleteBatch(@Param('id') id: string, @Query('keepQuestions') keepQuestions: string | undefined, @Req() req: any) {
    return this.uploadService.deleteUploadBatch(id, keepQuestions === '1' || keepQuestions === 'true', this.adminId(req));
  }

  // NEW (Sep 21 2026) — "us excel ke questions download bhi kar sake":
  // re-exports every question that upload still holds, in the same column
  // shape as the upload template (+ readable name columns), so the file can
  // be re-uploaded as-is.
  @Get('batches/:id/download')
  async downloadBatch(@Param('id') id: string, @Query('format') format: string | undefined, @Res() res: Response) {
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
  async publishBatch(@Param('id') id: string) {
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
    return this.uploadService.deleteUploadBatchQuestions(id, { subjectId, chapterId, topicId, subTopicId }, this.adminId(req));
  }

  // Bulk syllabus (taxonomy) importer — upload a bilingual syllabus workbook
  // laid out like SSC_Exams_Complete_Syllabus_Hindi.xlsx (one sheet per
  // subject, "English\nHindi" cells for Chapter/Topic/Sub-Topic) and it gets
  // upserted straight into Subject -> Chapter -> Topic -> SubTopic. Safe to
  // re-run on the same or an edited file — matching rows are updated, not
  // duplicated. See TaxonomyImportService for the exact expected layout.
  @Post('syllabus-excel')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadSyllabusExcel(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('Multipart field "file" (.xlsx/.xls) is required');
    return this.taxonomyImportService.importFromExcel(file.buffer);
  }
}
