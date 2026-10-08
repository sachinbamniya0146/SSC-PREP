/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SearchService } from '../search/search.service';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import { BankAdminService, AdminQuestionFilter } from './bank-admin.service';
import { BankUploadService } from './bank-upload.service';
import { normalizeMathText, normalizeQuestionMath } from '../common/math-text';
import { normalizeShift } from '../common/shift';

// =============================================================================
// QuestionEditService  (NEW — Oct 3 2026)
//
// Everything an admin needs to look at ONE question and change it:
//   * getForEdit()       — by uuid OR by the unique question number (Q-No)
//   * update()           — edit text / Hindi / options / answer / images /
//                          solution image / exam-shift-year / syllabus place.
//                          Old values are saved as a QuestionVersion.
//   * bulkUpdateMeta()   — set exam / year / shift / exam-date on MANY questions
//   * filterOptions()    — real years / shifts / dates that exist (dropdowns)
//   * translateToHindi() — English -> Hindi through the admin free-model key pool
//   * fixMath()          — rewrite old "2^2" questions into "2²"
// =============================================================================

const SOLUTION_IMG_G = /\n*!\[solution\]\([^)]*\)/g;
const SOLUTION_IMG_1 = /!\[solution\]\(([^)\s]+)\)/;
const OPTION_KEYS = ['A', 'B', 'C', 'D'] as const;

function str(v: unknown, max: number, label: string): string {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new BadRequestException(`${label} bahut lamba hai (max ${max} characters).`);
  return s;
}

function cleanUrl(v: unknown, label: string): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (s.length > 2_000_000) throw new BadRequestException(`${label} bahut badi hai.`);
  if (!/^(https?:\/\/|\/|data:image\/)/i.test(s)) throw new BadRequestException(`${label}: sahi image link chahiye.`);
  return s;
}

@Injectable()
export class QuestionEditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: BankAdminService,
    private readonly upload: BankUploadService,
    private readonly search: SearchService,
    private readonly aiProvider: AiProviderService,
  ) {}

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  /** Splits "text\n\n![solution](url)" into plain text + the solution picture url. */
  private splitSolution(text: string | null | undefined): { text: string; imageUrl: string | null } {
    const t = text ?? '';
    const m = SOLUTION_IMG_1.exec(t);
    return { text: t.replace(SOLUTION_IMG_G, '').trim(), imageUrl: m ? m[1] : null };
  }

  private mergeSolution(text: string, imageUrl: string | null): string {
    if (!imageUrl) return text;
    return `${text ? text + '\n\n' : ''}![solution](${imageUrl})`;
  }

  private async resolveTaxonomy(t: { subjectId?: string; chapterId?: string; topicId?: string; subTopicId?: string }) {
    if (t.subTopicId) {
      const sub = await this.prisma.subTopic.findUnique({
        where: { id: t.subTopicId },
        select: { id: true, topicId: true, topic: { select: { chapterId: true, chapter: { select: { subjectId: true } } } } },
      });
      if (!sub) throw new BadRequestException('Sub-topic nahi mila.');
      return { subjectId: sub.topic.chapter.subjectId, chapterId: sub.topic.chapterId, topicId: sub.topicId, subTopicId: sub.id };
    }
    if (t.topicId) {
      const topic = await this.prisma.topic.findUnique({
        where: { id: t.topicId },
        select: { id: true, chapterId: true, chapter: { select: { subjectId: true } } },
      });
      if (!topic) throw new BadRequestException('Topic nahi mila.');
      return { subjectId: topic.chapter.subjectId, chapterId: topic.chapterId, topicId: topic.id, subTopicId: null };
    }
    if (t.chapterId) {
      const ch = await this.prisma.chapter.findUnique({ where: { id: t.chapterId }, select: { id: true, subjectId: true } });
      if (!ch) throw new BadRequestException('Chapter nahi mila.');
      return { subjectId: ch.subjectId, chapterId: ch.id, topicId: null, subTopicId: null };
    }
    throw new BadRequestException('Chapter / topic / sub-topic chunein.');
  }

  private normalizeDate(v: unknown): string | null {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) throw new BadRequestException('Exam date YYYY-MM-DD format me honi chahiye.');
    const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (dt.getUTCFullYear() !== +m[1] || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) {
      throw new BadRequestException('Exam date galat hai.');
    }
    return s;
  }

  private async derivePaperCode(examId: string | null | undefined, examDate: string | null, shift: string | null): Promise<string | null> {
    if (!examId || !examDate || !shift) return null;
    const exam = await this.prisma.exam.findUnique({ where: { id: examId }, select: { slug: true } });
    return `${exam?.slug ?? examId}-${examDate}-${shift}`;
  }

  private hashOf(q: { questionText: string; options: any[]; correctAnswer: string; questionImageUrl?: string | null; questionDiagramType?: string | null; questionDiagramLabels?: any }): string {
    return this.upload.computeSearchHash({
      questionText: q.questionText ?? '',
      options: (q.options ?? []).map((o: any) => ({
        key: o.key,
        text: o.text ?? '',
        diagramType: o.diagramType,
        diagramLabels: o.diagramLabels,
        imageUrl: o.imageUrl,
      })),
      correctAnswer: q.correctAnswer,
      questionImageUrl: q.questionImageUrl ?? undefined,
      questionDiagramType: q.questionDiagramType ?? undefined,
      questionDiagramLabels: (q.questionDiagramLabels as string[] | null) ?? undefined,
    } as any);
  }

  // ---------------------------------------------------------------------------
  // read ONE question for the edit screen
  // ---------------------------------------------------------------------------

  async getForEdit(key: string) {
    const k = String(key ?? '').trim().replace(/^#|^q\.?\s*/i, '');
    if (!k) throw new BadRequestException('Question number ya id likhein.');
    const isNo = /^\d{1,9}$/.test(k);
    const q = await this.prisma.question.findFirst({
      where: isNo ? { questionNo: parseInt(k, 10) } : { id: k },
      include: {
        exam: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
        chapter: { select: { id: true, name: true } },
        topic: { select: { id: true, name: true } },
        subTopic: { select: { id: true, name: true } },
        uploadBatch: { select: { id: true, filename: true, createdAt: true, sourceType: true } },
        _count: { select: { versions: true, errorReports: true } },
      },
    });
    if (!q) throw new NotFoundException(isNo ? `Question number ${k} nahi mila.` : 'Question nahi mila.');

    const reports = await this.prisma.questionErrorReport.findMany({
      where: { questionId: q.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        description: true,
        category: true,
        status: true,
        createdAt: true,
        user: { select: { fullName: true, email: true } },
      },
    });

    const expl = this.splitSolution(q.explanation);
    const explHi = this.splitSolution(q.explanationHindi);
    const options = (Array.isArray(q.optionsJson) ? (q.optionsJson as any[]) : []).map((o) => ({
      key: o?.key,
      text: o?.text ?? '',
      textHi: o?.textHi ?? '',
      imageUrl: o?.imageUrl ?? '',
      diagramType: o?.diagramType ?? null,
      diagramLabels: o?.diagramLabels ?? null,
    }));

    return {
      id: q.id,
      questionNo: q.questionNo,
      kind: q.year != null ? 'pyq' : 'practice',
      status: q.isApproved && q.isActive && !q.autoSuspended ? 'live' : !q.isApproved && q.isActive ? 'pending' : 'hidden',
      isApproved: q.isApproved,
      isActive: q.isActive,
      autoSuspended: q.autoSuspended,
      reviewStatus: q.reviewStatus,
      examId: q.examId,
      subjectId: q.subjectId,
      chapterId: q.chapterId,
      topicId: q.topicId,
      subTopicId: q.subTopicId,
      names: {
        exam: q.exam?.name ?? null,
        subject: q.subject?.name ?? null,
        chapter: q.chapter?.name ?? null,
        topic: q.topic?.name ?? null,
        subTopic: q.subTopic?.name ?? null,
      },
      year: q.year,
      shift: q.shift,
      examDate: q.examDate,
      paperCode: q.paperCode,
      questionText: q.questionText,
      questionTextHindi: q.questionTextHindi ?? '',
      questionImageUrl: q.questionImageUrl ?? '',
      questionDiagramType: q.questionDiagramType,
      questionDiagramLabels: q.questionDiagramLabels,
      options,
      correctAnswer: q.correctAnswer,
      explanation: expl.text,
      explanationHindi: explHi.text,
      solutionImageUrl: expl.imageUrl || explHi.imageUrl || '',
      marks: q.marks,
      negativeMarks: q.negativeMarks,
      difficulty: q.difficulty,
      errorReportCount: q.errorReportCount,
      reports,
      batch: q.uploadBatch,
      versionsCount: q._count.versions,
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // update ONE question
  // ---------------------------------------------------------------------------

  async update(id: string, body: any, adminId?: string) {
    const existing = await this.prisma.question.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Question nahi mila.');
    const warnings: string[] = [];
    const data: Prisma.QuestionUncheckedUpdateInput = {};
    const has = (k: string) => body && Object.prototype.hasOwnProperty.call(body, k);

    // ---- text ----
    const questionText = has('questionText') ? normalizeMathText(str(body.questionText, 5000, 'Question')) : existing.questionText;
    const questionTextHindi = has('questionTextHindi') ? normalizeMathText(str(body.questionTextHindi, 5000, 'Question (Hindi)')) : existing.questionTextHindi ?? '';
    data.questionText = questionText;
    data.questionTextHindi = questionTextHindi;

    // ---- stem image ----
    let questionImageUrl: string | null = existing.questionImageUrl;
    if (has('questionImageUrl')) questionImageUrl = cleanUrl(body.questionImageUrl, 'Question image');
    data.questionImageUrl = questionImageUrl;
    if (!questionText.trim() && !questionImageUrl && !existing.questionDiagramType) {
      throw new BadRequestException('Question text likhein ya question image lagayein.');
    }

    // ---- options ----
    const oldOptions = (Array.isArray(existing.optionsJson) ? (existing.optionsJson as any[]) : []) as any[];
    let options = oldOptions;
    if (has('options')) {
      if (!Array.isArray(body.options) || body.options.length !== 4) throw new BadRequestException('Chaaron options (A–D) chahiye.');
      options = OPTION_KEYS.map((k, i) => {
        const src = body.options.find((o: any) => String(o?.key ?? '').toUpperCase() === k) ?? body.options[i] ?? {};
        const prev = oldOptions.find((o) => o?.key === k) ?? {};
        const imageUrl = src.imageUrl !== undefined ? cleanUrl(src.imageUrl, `Option ${k} image`) : prev.imageUrl ?? null;
        const text = normalizeMathText(str(src.text, 2000, `Option ${k}`));
        const textHi = normalizeMathText(str(src.textHi, 2000, `Option ${k} (Hindi)`));
        const diagramType = src.diagramType !== undefined ? src.diagramType || undefined : prev.diagramType || undefined;
        const diagramLabels = src.diagramLabels !== undefined ? src.diagramLabels || undefined : prev.diagramLabels || undefined;
        if (!text && !imageUrl && !diagramType) throw new BadRequestException(`Option ${k} me text ya image zaroori hai.`);
        return {
          key: k,
          text,
          textHi,
          ...(diagramType ? { diagramType } : {}),
          ...(diagramLabels?.length ? { diagramLabels } : {}),
          ...(imageUrl ? { imageUrl } : {}),
        };
      });
      data.optionsJson = options as any;
    }

    // ---- correct answer ----
    let correctAnswer = existing.correctAnswer;
    if (has('correctAnswer')) {
      correctAnswer = String(body.correctAnswer ?? '').trim().toUpperCase();
      if (!OPTION_KEYS.includes(correctAnswer as any)) throw new BadRequestException('Sahi answer A/B/C/D me se chunein.');
      data.correctAnswer = correctAnswer;
    }

    // ---- explanation + solution picture ----
    const curExpl = this.splitSolution(existing.explanation);
    const curExplHi = this.splitSolution(existing.explanationHindi);
    const explanation = has('explanation') ? normalizeMathText(str(body.explanation, 8000, 'Explanation')) : curExpl.text;
    const explanationHindi = has('explanationHindi') ? normalizeMathText(str(body.explanationHindi, 8000, 'Explanation (Hindi)')) : curExplHi.text;
    let solutionImageUrl: string | null = curExpl.imageUrl || curExplHi.imageUrl;
    if (has('solutionImageUrl')) solutionImageUrl = cleanUrl(body.solutionImageUrl, 'Solution image');
    if (has('explanation') || has('explanationHindi') || has('solutionImageUrl')) {
      // same convention as the upload path: the picture is stored as a markdown line inside the explanation
      data.explanation = this.mergeSolution(explanation, solutionImageUrl && (explanation || !explanationHindi) ? solutionImageUrl : null);
      data.explanationHindi = this.mergeSolution(explanationHindi, solutionImageUrl && explanationHindi ? solutionImageUrl : null);
    }

    // ---- exam / paper identity ----
    let examId = existing.examId;
    if (has('examId')) {
      examId = String(body.examId ?? '').trim() || null;
      if (examId) {
        const ex = await this.prisma.exam.findUnique({ where: { id: examId }, select: { id: true } });
        if (!ex) throw new BadRequestException('Exam nahi mila.');
      }
      data.examId = examId;
    }
    let year = existing.year;
    if (has('year')) {
      const raw = String(body.year ?? '').trim();
      if (!raw) year = null;
      else {
        const y = Number(raw);
        if (!Number.isInteger(y) || y < 1990 || y > 2100) throw new BadRequestException('Year sahi likhein (jaise 2024).');
        year = y;
      }
      data.year = year;
    }
    let shift = existing.shift;
    if (has('shift')) {
      shift = normalizeShift(str(body.shift, 60, 'Shift'));
      data.shift = shift;
    }
    let examDate = existing.examDate;
    if (has('examDate')) {
      examDate = this.normalizeDate(body.examDate);
      data.examDate = examDate;
    }
    let paperCode = existing.paperCode;
    if (has('paperCode')) {
      paperCode = str(body.paperCode, 120, 'Paper code') || null;
      data.paperCode = paperCode;
    }
    const identityChanged = has('examId') || has('year') || has('shift') || has('examDate');
    if (year != null && !paperCode && examDate && shift) {
      paperCode = await this.derivePaperCode(examId, examDate, shift);
      data.paperCode = paperCode;
    } else if (identityChanged && !has('paperCode') && existing.paperCode && existing.paperCode.includes('-') && examDate && shift && year != null) {
      // a paper code that was auto-derived earlier must follow the new date / shift
      const old = await this.derivePaperCode(existing.examId, existing.examDate, existing.shift);
      if (old && old === existing.paperCode) {
        paperCode = await this.derivePaperCode(examId, examDate, shift);
        data.paperCode = paperCode;
      }
    }

    // ---- syllabus place ----
    let subjectId = existing.subjectId;
    if (has('subjectId') || has('chapterId') || has('topicId') || has('subTopicId')) {
      const t = await this.resolveTaxonomy({
        subjectId: body.subjectId || undefined,
        chapterId: body.chapterId || undefined,
        topicId: body.topicId || undefined,
        subTopicId: body.subTopicId || undefined,
      });
      Object.assign(data, t);
      subjectId = t.subjectId;
    }

    // ---- marks / difficulty ----
    if (has('marks')) {
      const m = Number(body.marks);
      if (!Number.isFinite(m) || m <= 0 || m > 100) throw new BadRequestException('Marks 0 se bade hone chahiye.');
      data.marks = m;
    }
    if (has('negativeMarks')) {
      const m = Number(body.negativeMarks);
      if (!Number.isFinite(m) || m < 0 || m > 100) throw new BadRequestException('Negative marks galat hain.');
      data.negativeMarks = m;
    }
    if (has('difficulty')) {
      const d = String(body.difficulty ?? '').toUpperCase();
      if (!['EASY', 'MEDIUM', 'HARD'].includes(d)) throw new BadRequestException('Difficulty EASY, MEDIUM ya HARD honi chahiye.');
      data.difficulty = d as any;
    }

    // ---- duplicate guard (hash of what the question will look like) ----
    const finalOptions = options;
    const newHash = this.hashOf({
      questionText,
      options: finalOptions,
      correctAnswer,
      questionImageUrl,
      questionDiagramType: existing.questionDiagramType,
      questionDiagramLabels: existing.questionDiagramLabels,
    });
    data.searchHash = newHash;
    if (newHash !== existing.searchHash && !body?.allowDuplicate) {
      const dup = await this.prisma.question.findFirst({
        where: { searchHash: newHash, isActive: true, id: { not: id } },
        select: { id: true, questionNo: true, questionText: true },
      });
      if (dup) {
        throw new ConflictException({
          message: `Aisa hi question pehle se hai (Q#${dup.questionNo}). Fir bhi save karna ho to "duplicate allow" ke saath dobara save karein.`,
          code: 'DUPLICATE',
          existing: { id: dup.id, questionNo: dup.questionNo, questionText: dup.questionText.slice(0, 200) },
        });
      }
    }

    // ---- publish state ----
    const hasHindi = !!questionTextHindi.trim();
    const subjectExempt = subjectId
      ? !!(await this.prisma.subject.findFirst({ where: { id: subjectId, slug: 'english' }, select: { id: true } }))
      : false;
    const imageOnly = !questionText.trim() && !!questionImageUrl;
    const status = has('status') ? String(body.status) : '';
    let autoPublished = false;
    if (status === 'live') {
      data.isApproved = true;
      data.isActive = true;
      data.autoSuspended = false;
      data.reviewStatus = 'APPROVED';
      if (!hasHindi && !subjectExempt && !imageOnly) warnings.push('Hindi text nahi hai — kuch screens par ye question students ko nahi dikhega.');
    } else if (status === 'hidden') {
      data.isActive = false;
    } else if (status === 'pending') {
      data.isApproved = false;
      data.isActive = true;
      data.reviewStatus = 'PENDING';
    } else if (!existing.isApproved && existing.isActive && existing.reviewStatus === 'PENDING' && (hasHindi || subjectExempt || imageOnly)) {
      // the documented flow: "add the Hindi text to publish it"
      data.isApproved = true;
      data.reviewStatus = 'APPROVED';
      autoPublished = true;
    }

    // ---- save (+ keep the old values as a version) ----
    await this.prisma.$transaction([
      this.prisma.questionVersion.create({
        data: {
          questionId: id,
          editedByUserId: adminId ?? 'system',
          previousText: existing.questionText,
          previousOptions: (existing.optionsJson ?? []) as any,
          previousAnswer: existing.correctAnswer,
          reason: str(body?.reason, 300, 'Reason') || 'Admin edit',
        },
      }),
      this.prisma.question.update({ where: { id }, data }),
    ]);

    this.admin.clearCaches();
    void this.search.indexQuestion(id).catch(() => undefined);
    if (adminId) {
      this.prisma.auditLog
        .create({ data: { userId: adminId, action: 'QUESTION_EDITED', targetEntity: 'Question', entityId: id, metadataJson: { questionNo: existing.questionNo, fields: Object.keys(data) } as any } })
        .catch(() => undefined);
    }
    if (year != null && shift && examId && identityChanged) {
      try {
        await this.upload.upsertPyqMockForPaper(examId, year, shift, paperCode ?? null, examDate ?? null);
      } catch {
        /* the edit is saved; the mock refreshes on the next upload */
      }
    }
    return { ok: true, id, questionNo: existing.questionNo, autoPublished, warnings };
  }

  // ---------------------------------------------------------------------------
  // many questions at once: exam / year / shift / date
  // ---------------------------------------------------------------------------

  async bulkUpdateMeta(input: { ids?: string[]; filter?: AdminQuestionFilter; set: any }, adminId?: string) {
    const set = input?.set ?? {};
    const data: Prisma.QuestionUncheckedUpdateManyInput = {};
    const has = (k: string) => Object.prototype.hasOwnProperty.call(set, k);

    if (has('examId')) {
      const examId = String(set.examId ?? '').trim();
      if (examId) {
        const ex = await this.prisma.exam.findUnique({ where: { id: examId }, select: { id: true } });
        if (!ex) throw new BadRequestException('Exam nahi mila.');
      }
      data.examId = examId || null;
    }
    if (has('year')) {
      const raw = String(set.year ?? '').trim();
      if (!raw) data.year = null;
      else {
        const y = Number(raw);
        if (!Number.isInteger(y) || y < 1990 || y > 2100) throw new BadRequestException('Year sahi likhein (jaise 2024).');
        data.year = y;
      }
    }
    if (has('shift')) data.shift = normalizeShift(str(set.shift, 60, 'Shift'));
    if (has('examDate')) data.examDate = this.normalizeDate(set.examDate);
    if (has('paperCode')) data.paperCode = str(set.paperCode, 120, 'Paper code') || null;
    if (has('difficulty')) {
      const d = String(set.difficulty ?? '').toUpperCase();
      if (!['EASY', 'MEDIUM', 'HARD'].includes(d)) throw new BadRequestException('Difficulty EASY, MEDIUM ya HARD honi chahiye.');
      data.difficulty = d as any;
    }
    if (has('marks')) {
      const m = Number(set.marks);
      if (!Number.isFinite(m) || m <= 0 || m > 100) throw new BadRequestException('Marks 0 se bade hone chahiye.');
      data.marks = m;
    }
    if (has('negativeMarks')) {
      const m = Number(set.negativeMarks);
      if (!Number.isFinite(m) || m < 0 || m > 100) throw new BadRequestException('Negative marks galat hain.');
      data.negativeMarks = m;
    }
    if (Object.keys(data).length === 0) throw new BadRequestException('Kam se kam ek detail (exam / year / shift / date …) bharein.');

    const ids = await this.admin.resolveTargetIds(input.ids, input.filter);
    if (ids.length === 0) return { updated: 0 };

    let updated = 0;
    const touchesPaper = has('examId') || has('year') || has('shift') || has('examDate');
    if (touchesPaper && !has('paperCode') && data.examDate !== undefined && data.shift !== undefined) {
      // date + shift both given -> give every question the matching paper code (per exam)
      const rows = await this.prisma.question.findMany({ where: { id: { in: ids } }, select: { id: true, examId: true } });
      const byExam = new Map<string | null, string[]>();
      for (const r of rows) {
        const exId = (data.examId as string | null | undefined) !== undefined ? (data.examId as string | null) : r.examId;
        byExam.set(exId, [...(byExam.get(exId) ?? []), r.id]);
      }
      for (const [exId, list] of byExam) {
        const code = await this.derivePaperCode(exId, data.examDate as string | null, data.shift as string | null);
        for (let i = 0; i < list.length; i += 500) {
          const r = await this.prisma.question.updateMany({ where: { id: { in: list.slice(i, i + 500) } }, data: { ...data, ...(code ? { paperCode: code } : {}) } });
          updated += r.count;
        }
      }
    } else {
      for (let i = 0; i < ids.length; i += 500) {
        const r = await this.prisma.question.updateMany({ where: { id: { in: ids.slice(i, i + 500) } }, data });
        updated += r.count;
      }
    }

    this.admin.clearCaches();
    if (adminId) {
      this.prisma.auditLog
        .create({ data: { userId: adminId, action: 'QUESTION_BULK_META', targetEntity: 'Question', entityId: 'bulk', metadataJson: { count: updated, set } as any } })
        .catch(() => undefined);
    }

    // refresh the real-paper mocks the touched questions now belong to
    if (touchesPaper) {
      try {
        const papers = await this.prisma.question.groupBy({
          by: ['examId', 'year', 'shift', 'paperCode', 'examDate'],
          where: { id: { in: ids.slice(0, 5000) }, year: { not: null }, shift: { not: null }, examId: { not: null } },
        });
        for (const p of papers) {
          await this.upload.upsertPyqMockForPaper(p.examId as string, p.year as number, p.shift as string, p.paperCode, p.examDate).catch(() => undefined);
        }
      } catch {
        /* non-fatal */
      }
    }
    return { updated };
  }

  // ---------------------------------------------------------------------------
  // dropdown values that really exist
  // ---------------------------------------------------------------------------

  async filterOptions(examId?: string) {
    const base: Prisma.QuestionWhereInput = examId ? { examId } : {};
    const [years, shifts, dates] = await Promise.all([
      this.prisma.question.groupBy({ by: ['year'], where: { ...base, year: { not: null } }, _count: { _all: true }, orderBy: { year: 'desc' } }),
      this.prisma.question.groupBy({ by: ['shift'], where: { ...base, shift: { not: null } }, _count: { _all: true }, orderBy: { shift: 'asc' } }),
      this.prisma.question.groupBy({ by: ['examDate'], where: { ...base, examDate: { not: null } }, _count: { _all: true }, orderBy: { examDate: 'desc' }, take: 200 }),
    ]);
    return {
      years: years.map((y) => ({ year: y.year as number, count: y._count._all })),
      shifts: shifts.map((s) => ({ shift: s.shift as string, count: s._count._all })),
      examDates: dates.map((d) => ({ examDate: d.examDate as string, count: d._count._all })),
    };
  }

  // ---------------------------------------------------------------------------
  // English -> Hindi (admin key pool, free models only)
  // ---------------------------------------------------------------------------

  async translateToHindi(body: { questionText?: string; options?: { key: string; text?: string }[]; explanation?: string }) {
    const questionText = String(body?.questionText ?? '').trim();
    const explanation = String(body?.explanation ?? '').replace(SOLUTION_IMG_G, '').trim();
    const options = (Array.isArray(body?.options) ? body.options : [])
      .map((o) => ({ key: String(o?.key ?? '').toUpperCase(), text: String(o?.text ?? '').trim() }))
      .filter((o) => OPTION_KEYS.includes(o.key as any));
    if (!questionText && !explanation && !options.some((o) => o.text)) {
      throw new BadRequestException('Translate karne ke liye English question / options / explanation likhein.');
    }
    const payload = {
      questionText,
      options: Object.fromEntries(options.map((o) => [o.key, o.text])),
      explanation,
    };
    const prompt = [
      'You translate Indian SSC competitive-exam questions from English into Hindi (Devanagari script).',
      'Rules:',
      '- Keep every number, formula, symbol, unit, option letter and proper noun exactly as they are (names of people/places may be written in Devanagari).',
      '- Do NOT solve the question and do NOT add or remove information. Translate only.',
      '- Use the standard Hindi terms used in SSC Hindi-medium papers.',
      '- If a field is empty, return an empty string for it.',
      '- Reply with ONE JSON object only, no markdown, with exactly these keys:',
      '{"questionTextHindi": string, "options": {"A": string, "B": string, "C": string, "D": string}, "explanationHindi": string}',
      '',
      'English input:',
      JSON.stringify(payload),
    ].join('\n');

    const result = await this.aiProvider.generate(prompt, { jsonResponse: true, feature: 'QUESTION_HINDI_TRANSLATE' });
    const parsed = this.parseJsonLoose(result.content);
    if (!parsed) throw new BadRequestException('AI ka jawab samajh nahi aaya — dobara try karein.');
    const opts: Record<string, string> = {};
    for (const k of OPTION_KEYS) opts[k] = normalizeMathText(String(parsed?.options?.[k] ?? '').trim());
    return {
      questionTextHindi: normalizeMathText(String(parsed?.questionTextHindi ?? '').trim()),
      options: opts,
      explanationHindi: normalizeMathText(String(parsed?.explanationHindi ?? '').trim()),
      model: result.model,
    };
  }

  private parseJsonLoose(text: string): any | null {
    const t = String(text ?? '').replace(/```json|```/gi, '').trim();
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try {
      return JSON.parse(t.slice(a, b + 1));
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // one-click backfill: "2^2" -> "2²" for questions that were saved earlier
  // ---------------------------------------------------------------------------

  async fixMath(adminId?: string, maxRows = 3000) {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM questions
      WHERE "questionText" LIKE '%^%' OR "questionText" LIKE '%**%'
         OR "explanation" LIKE '%^%' OR "explanationHindi" LIKE '%^%'
         OR "questionTextHindi" LIKE '%^%'
         OR "optionsJson"::text LIKE '%^%'
      LIMIT ${maxRows}`;
    let fixed = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const ids = rows.slice(i, i + 100).map((r) => r.id);
      const qs = await this.prisma.question.findMany({ where: { id: { in: ids } } });
      for (const q of qs) {
        const copy: any = {
          questionText: q.questionText,
          questionTextHindi: q.questionTextHindi,
          explanation: q.explanation,
          explanationHindi: q.explanationHindi,
          options: (Array.isArray(q.optionsJson) ? (q.optionsJson as any[]) : []).map((o) => ({ ...o })),
        };
        normalizeQuestionMath(copy);
        const changed =
          copy.questionText !== q.questionText ||
          copy.questionTextHindi !== q.questionTextHindi ||
          copy.explanation !== q.explanation ||
          copy.explanationHindi !== q.explanationHindi ||
          JSON.stringify(copy.options) !== JSON.stringify(q.optionsJson);
        if (!changed) continue;
        await this.prisma.question.update({
          where: { id: q.id },
          data: {
            questionText: copy.questionText,
            questionTextHindi: copy.questionTextHindi,
            explanation: copy.explanation,
            explanationHindi: copy.explanationHindi,
            optionsJson: copy.options as any,
            searchHash: this.hashOf({
              questionText: copy.questionText,
              options: copy.options,
              correctAnswer: q.correctAnswer,
              questionImageUrl: q.questionImageUrl,
              questionDiagramType: q.questionDiagramType,
              questionDiagramLabels: q.questionDiagramLabels,
            }),
          },
        });
        fixed++;
      }
    }
    this.admin.clearCaches();
    if (adminId) {
      this.prisma.auditLog
        .create({ data: { userId: adminId, action: 'QUESTION_MATH_FIXED', targetEntity: 'Question', entityId: 'bulk', metadataJson: { scanned: rows.length, fixed } as any } })
        .catch(() => undefined);
    }
    return { scanned: rows.length, fixed };
  }
}
