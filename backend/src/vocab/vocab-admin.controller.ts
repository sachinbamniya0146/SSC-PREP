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
import { archiveWordProgress, preserveUnlockBeforeMove, restoreArchivedProgress, vocabWordKey } from './vocab-unlock-memory';
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

  /** One word with every learning field — feeds the admin "Edit word" form. */
  @Get('words/:id')
  async getWord(@Param('id') id: string) {
    const w = await this.prisma.vocabWord.findUnique({ where: { id }, include: { _count: { select: { questions: true } } } });
    if (!w) throw new BadRequestException('Word not found');
    return w;
  }

  private static slugify(s: string): string {
    return String(s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  /** Validate + normalise one quiz question from the admin form (same rules as the Excel import). */
  private static cleanQuestion(body: Record<string, any>) {
    const questionText = String(body?.questionText ?? '').trim();
    if (!questionText) throw new BadRequestException('Question text khali hai');
    const raw: any[] = Array.isArray(body?.optionsJson) ? body.optionsJson : [];
    const options = ['A', 'B', 'C', 'D'].map((key) => {
      const found = raw.find((o) => String(o?.key ?? '').toUpperCase() === key);
      const text = String(found?.text ?? '').trim();
      if (!text) throw new BadRequestException(`Option ${key} khali hai — char options zaroori hain`);
      return { key, text };
    });
    const correctAnswer = String(body?.correctAnswer ?? '').trim().toUpperCase();
    if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) throw new BadRequestException('Sahi answer A, B, C ya D hona chahiye');
    const explanation = String(body?.explanation ?? '').trim();
    if (!explanation) throw new BadRequestException('Solution / explanation zaroori hai');
    const qt = body?.questionType === undefined || body?.questionType === null ? '' : String(body.questionType).trim().toUpperCase();
    if (qt && !['SYNONYM', 'ANTONYM', 'CONTEXT'].includes(qt)) throw new BadRequestException('questionType SYNONYM, ANTONYM ya CONTEXT hona chahiye');
    return { questionText, optionsJson: options as any, correctAnswer, explanation, questionType: qt || null };
  }

  /** Add one word by hand (no Excel). It goes to the END of the list; a word deleted earlier gets its students' unlocks back. */
  @Post('words')
  async createWord(@Body() body: Record<string, any>) {
    const str = (k: string, required = false): string | null => {
      const v = body?.[k] === undefined || body?.[k] === null ? '' : String(body[k]).trim();
      if (required && !v) throw new BadRequestException(`'${k}' zaroori hai`);
      return v || null;
    };
    const word = str('word', true) as string;
    const meaningHindi = str('meaningHindi', true) as string;
    const meaningEnglish = str('meaningEnglish', true) as string;
    const slug = VocabAdminController.slugify(str('slug') || word);
    if (!slug) throw new BadRequestException('Word se valid slug nahi ban paya');

    const all = await this.prisma.vocabWord.findMany({ select: { word: true, slug: true, orderIndex: true } });
    const key = vocabWordKey(word);
    const dup = all.find((w) => w.slug === slug || vocabWordKey(w.word) === key);
    if (dup) throw new BadRequestException(`Word "${dup.word}" pehle se maujood hai — usse Edit karein`);

    const lists: Record<string, any> = {};
    for (const k of ['examplesJson', 'synonymsJson', 'antonymsJson']) {
      const v = body?.[k];
      if (v === undefined || v === null) { lists[k] = []; continue; }
      if (!Array.isArray(v)) throw new BadRequestException(`'${k}' must be a list`);
      lists[k] = v;
    }
    const created = await this.prisma.vocabWord.create({
      data: {
        slug, word, meaningHindi, meaningEnglish,
        orderIndex: all.reduce((m, w) => Math.max(m, w.orderIndex ?? 0), 0) + 1,
        partOfSpeech: str('partOfSpeech'), pronunciation: str('pronunciation'), memoryTrick: str('memoryTrick'),
        etymology: str('etymology'), registerNote: str('registerNote'), examTrendNote: str('examTrendNote'),
        confusingPairNote: str('confusingPairNote'),
        ...lists,
      },
    });
    await restoreArchivedProgress(this.prisma, created.id, created.word);
    return created;
  }

  /**
   * Edit a word after upload. Any learning field can be changed; `orderIndex` is NOT taken from here any more (a raw
   * number created duplicate / gapped positions) — use POST words/:id/move or POST words/reorder instead.
   */
  @Put('words/:id')
  async updateWord(@Param('id') id: string, @Body() body: Record<string, any>) {
    const existing = await this.prisma.vocabWord.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Word not found');

    const data: Record<string, any> = {};
    const str = (k: string, required = false) => {
      if (body[k] === undefined) return;
      const v = body[k] === null ? '' : String(body[k]).trim();
      if (required && !v) throw new BadRequestException(`'${k}' cannot be empty`);
      data[k] = v || (required ? v : null);
    };
    str('word', true);
    str('meaningHindi', true);
    str('meaningEnglish', true);
    for (const k of ['partOfSpeech', 'pronunciation', 'memoryTrick', 'etymology', 'registerNote', 'examTrendNote', 'confusingPairNote']) str(k);
    for (const k of ['examplesJson', 'synonymsJson', 'antonymsJson']) {
      if (body[k] === undefined) continue;
      if (body[k] !== null && !Array.isArray(body[k])) throw new BadRequestException(`'${k}' must be a list`);
      data[k] = body[k] === null ? null : body[k];
    }
    if (body.isActive !== undefined) data.isActive = !!body.isActive;

    // a changed word text must not collide with another word's text/slug
    if (data.word && data.word !== existing.word) {
      const dup = await this.prisma.vocabWord.findFirst({ where: { id: { not: id }, word: { equals: data.word, mode: 'insensitive' } } });
      if (dup) throw new BadRequestException(`Another word "${dup.word}" already exists`);
    }
    if (!Object.keys(data).length) return existing;
    return this.prisma.vocabWord.update({ where: { id }, data });
  }

  /**
   * Put a word at ANY position (1 = first). Everything in between shifts by one, so the list always stays 1..N with
   * no duplicates or gaps. Students who could already reach the word keep it unlocked.
   */
  @Post('words/:id/move')
  async moveWord(@Param('id') id: string, @Body() body: { position?: number }) {
    const pos = Math.floor(Number(body?.position));
    if (!Number.isFinite(pos) || pos < 1) throw new BadRequestException('position must be a number >= 1');
    const all = await this.prisma.vocabWord.findMany({ orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }], select: { id: true, orderIndex: true, word: true } });
    const from = all.findIndex((w) => w.id === id);
    if (from < 0) throw new BadRequestException('Word not found');
    const to = Math.min(pos, all.length) - 1;
    if (from !== to) {
      if (to > from) await preserveUnlockBeforeMove(this.prisma, id);
      const ids = all.map((w) => w.id);
      ids.splice(from, 1);
      ids.splice(to, 0, id);
      await this.applyOrder(ids, all);
    }
    return { moved: true, word: all[from].word, from: from + 1, to: to + 1, total: all.length };
  }

  /** Full re-order in one call (drag & drop): body.orderedIds is the complete list of word ids in the new order. */
  @Post('words/reorder')
  async reorderWords(@Body() body: { orderedIds?: string[] }) {
    const ids = Array.isArray(body?.orderedIds) ? body.orderedIds.map(String) : [];
    const all = await this.prisma.vocabWord.findMany({ orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }], select: { id: true, orderIndex: true } });
    const known = new Set(all.map((w) => w.id));
    if (ids.length !== all.length || new Set(ids).size !== ids.length || ids.some((x) => !known.has(x))) {
      throw new BadRequestException('orderedIds must list every word exactly once');
    }
    const oldPos = new Map(all.map((w, i) => [w.id, i]));
    for (let i = 0; i < ids.length; i++) {
      if ((oldPos.get(ids[i]) ?? i) < i) await preserveUnlockBeforeMove(this.prisma, ids[i]); // word moved later
    }
    await this.applyOrder(ids, all);
    return { reordered: true, total: ids.length };
  }

  /** Close gaps / remove duplicate numbers (e.g. after many uploads and deletes): renumber 1..N keeping the current order. */
  @Post('words/normalize')
  async normalizeOrder() {
    const all = await this.prisma.vocabWord.findMany({ orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }], select: { id: true, orderIndex: true } });
    await this.applyOrder(all.map((w) => w.id), all);
    return { normalized: true, total: all.length };
  }

  private async applyOrder(ids: string[], before: { id: string; orderIndex: number }[]) {
    const prev = new Map(before.map((w) => [w.id, w.orderIndex]));
    const changed = ids.map((wid, i) => ({ wid, idx: i + 1 })).filter((x) => prev.get(x.wid) !== x.idx);
    const CHUNK = 200;
    for (let i = 0; i < changed.length; i += CHUNK) {
      await this.prisma.$transaction(
        changed.slice(i, i + CHUNK).map((x) => this.prisma.vocabWord.update({ where: { id: x.wid }, data: { orderIndex: x.idx } })),
      );
    }
  }

  /** Every quiz question of one word — feeds the admin "Questions" panel (so single questions can be deleted). */
  @Get('words/:id/questions')
  async listWordQuestions(@Param('id') id: string) {
    const word = await this.prisma.vocabWord.findUnique({ where: { id }, select: { id: true, word: true } });
    if (!word) throw new BadRequestException('Word not found');
    const questions = await this.prisma.vocabQuestion.findMany({
      where: { wordId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, questionText: true, optionsJson: true, correctAnswer: true, explanation: true, questionType: true },
    });
    return { word: word.word, questions };
  }

  /** Delete ONE quiz question. Students' word progress is untouched (it is stored per word, not per question). */
  @Delete('questions/:qid')
  async deleteQuestion(@Param('qid') qid: string) {
    const q = await this.prisma.vocabQuestion.findUnique({ where: { id: qid }, select: { id: true, wordId: true } });
    if (!q) throw new BadRequestException('Question not found');
    await this.prisma.vocabQuestion.delete({ where: { id: qid } });
    return { deleted: true, wordId: q.wordId };
  }

  /** Add one quiz question to a word by hand. */
  @Post('words/:id/questions')
  async createQuestion(@Param('id') id: string, @Body() body: Record<string, any>) {
    const word = await this.prisma.vocabWord.findUnique({ where: { id }, select: { id: true } });
    if (!word) throw new BadRequestException('Word not found');
    const data = VocabAdminController.cleanQuestion(body);
    const existing = await this.prisma.vocabQuestion.findMany({ where: { wordId: id }, select: { questionText: true } });
    const key = vocabWordKey(data.questionText);
    if (existing.some((q) => vocabWordKey(q.questionText) === key)) throw new BadRequestException('Ye question is word me pehle se hai');
    return this.prisma.vocabQuestion.create({ data: { wordId: id, ...data } });
  }

  /** Edit one quiz question (text, the four options, correct answer, solution, type). */
  @Put('questions/:qid')
  async updateQuestion(@Param('qid') qid: string, @Body() body: Record<string, any>) {
    const q = await this.prisma.vocabQuestion.findUnique({ where: { id: qid }, select: { id: true, wordId: true } });
    if (!q) throw new BadRequestException('Question not found');
    const data = VocabAdminController.cleanQuestion(body);
    const siblings = await this.prisma.vocabQuestion.findMany({ where: { wordId: q.wordId, id: { not: qid } }, select: { questionText: true } });
    const key = vocabWordKey(data.questionText);
    if (siblings.some((x) => vocabWordKey(x.questionText) === key)) throw new BadRequestException('Isi word me ye question pehle se hai');
    return this.prisma.vocabQuestion.update({ where: { id: qid }, data });
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
