import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BankUploadService } from '../bank/bank-upload.service';
import { Tier, cleanQuestionText, isValidIsoDate, normalizeTier } from './pyq-date.util';
import { parseExamDate } from '../common/exam-date-format';

/**
 * PYQ exam dates (manual).
 *
 * The admin types the real exam date (and Tier 1 / Tier 2) of a PYQ question by hand. There is NO
 * automatic internet search and NO AI any more. Old rows written by the earlier automatic finder
 * (status MAPPED / NEEDS_REVIEW / NOT_FOUND / FAILED / PENDING) stay in the table so nothing is lost:
 * the admin can still accept or reject an old proposed date, or overwrite it with a hand-typed one.
 *
 * "UNMAPPED" (a virtual status) = PYQ questions (year set) that have no exam date and no row yet.
 */

const STATUSES = ['PENDING', 'RUNNING', 'MAPPED', 'NEEDS_REVIEW', 'NOT_FOUND', 'FAILED', 'MANUAL'] as const;
export type MapStatus = (typeof STATUSES)[number];

interface QuestionForRun {
  id: string;
  examId: string | null;
  year: number | null;
  shift: string | null;
  paperCode: string | null;
  examDate: string | null;
  examTier: string | null;
}

interface PaperKey {
  examId: string;
  year: number;
  shift: string;
  paperCode: string | null;
}

@Injectable()
export class PyqDateService {
  private readonly logger = new Logger(PyqDateService.name);
  private readonly touchedPapers = new Map<string, PaperKey>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bankUpload: BankUploadService,
  ) {}

  /** PYQ questions (year set) that have no exam date and no row in the date table yet. */
  private unmappedWhere(f: { examId?: string; subjectId?: string; chapterId?: string; year?: number } = {}): Prisma.QuestionWhereInput {
    return {
      year: f.year ?? { not: null },
      isActive: true,
      examId: f.examId ?? { not: null },
      ...(f.subjectId ? { subjectId: f.subjectId } : {}),
      ...(f.chapterId ? { chapterId: f.chapterId } : {}),
      OR: [{ examDate: null }, { examDate: '' }],
      pyqDateMap: { is: null },
    };
  }

  private markPaper(q: Pick<QuestionForRun, 'examId' | 'year' | 'shift' | 'paperCode'>) {
    if (!q.examId || !q.year || !q.shift) return;
    const key = `${q.examId}|${q.year}|${q.shift}|${q.paperCode ?? ''}`;
    this.touchedPapers.set(key, { examId: q.examId, year: q.year, shift: q.shift, paperCode: q.paperCode ?? null });
  }

  private async applyDate(q: QuestionForRun, date: string, tier: Tier | null, mapId: string, extra: Record<string, unknown>) {
    await this.prisma.$transaction([
      this.prisma.question.update({ where: { id: q.id }, data: { examDate: date, ...(tier && !q.examTier ? { examTier: tier } : {}) } }),
      this.prisma.pyqDateMap.update({
        where: { id: mapId },
        data: { ...(extra as Prisma.PyqDateMapUncheckedUpdateInput), status: 'MAPPED', proposedDate: date, appliedAt: new Date(), finishedAt: new Date(), lastError: null },
      }),
    ]);
    this.markPaper(q);
  }

  /** After a change: make the shift-wise mock test of every touched paper show the (majority) real date. */
  private async flushPapers() {
    const papers = Array.from(this.touchedPapers.values());
    this.touchedPapers.clear();
    for (const p of papers) {
      try {
        const rows = await this.prisma.question.groupBy({
          by: ['examDate'],
          where: { examId: p.examId, year: p.year, shift: p.shift, paperCode: p.paperCode, examDate: { not: null } },
          _count: { _all: true },
        });
        const top = rows.filter((r) => r.examDate).sort((a, b) => b._count._all - a._count._all)[0];
        if (top?.examDate) await this.bankUpload.upsertPyqMockForPaper(p.examId, p.year, p.shift, p.paperCode, top.examDate);
      } catch (e) {
        this.logger.warn(`Mock title refresh failed for ${p.examId}/${p.year}/${p.shift}: ${(e as Error).message}`);
      }
    }
  }

  // ------------------------------------------------------------------ admin actions

  async acceptProposed(questionId: string) {
    const map = await this.prisma.pyqDateMap.findUnique({ where: { questionId }, include: { question: { select: { id: true, examId: true, year: true, shift: true, paperCode: true, examTier: true, examDate: true } } } });
    if (!map) throw new NotFoundException('No date-mapping entry was found for this question.');
    if (!map.proposedDate || !isValidIsoDate(map.proposedDate)) throw new BadRequestException('There is no proposed date.');
    const q = map.question as QuestionForRun;
    await this.applyDate(q, map.proposedDate, normalizeTier(map.examTier), map.id, { note: `Admin ne accept ki (${map.agreeCount}/${map.passesDone} passes).` });
    await this.flushPapers();
    return { ok: true, examDate: map.proposedDate };
  }

  async setManual(questionId: string, dto: { examDate?: string; examTier?: string | null }) {
    // 30 Oct 2026: the admin types the date ONLY as DD/MM/YYYY (same single format as the Excel upload); stored as YYYY-MM-DD.
    let iso: string | undefined;
    try { iso = parseExamDate(dto.examDate); } catch (e) { throw new BadRequestException(e instanceof Error ? e.message : 'Invalid date.'); }
    if (!iso || !isValidIsoDate(iso)) throw new BadRequestException('Invalid date — write it as DD/MM/YYYY (e.g. 12/09/2025), a real past date from 2010 onwards.');
    const tier = dto.examTier === null || dto.examTier === '' || dto.examTier === undefined ? null : normalizeTier(dto.examTier);
    if (dto.examTier && !tier) throw new BadRequestException('Tier can only be Tier 1 or Tier 2.');
    const q = await this.prisma.question.findUnique({ where: { id: questionId }, select: { id: true, year: true, examId: true, shift: true, paperCode: true } });
    if (!q) throw new NotFoundException('Question not found.');
    await this.prisma.$transaction([
      this.prisma.question.update({ where: { id: questionId }, data: { examDate: iso, ...(tier ? { examTier: tier } : {}) } }),
      this.prisma.pyqDateMap.upsert({
        where: { questionId },
        create: { questionId, status: 'MANUAL', proposedDate: iso, proposedYear: +iso.slice(0, 4), examTier: tier, note: 'Admin ne haath se date daali.', appliedAt: new Date(), finishedAt: new Date() },
        update: { status: 'MANUAL', proposedDate: iso, proposedYear: +iso.slice(0, 4), examTier: tier, note: 'Admin ne haath se date daali.', appliedAt: new Date(), finishedAt: new Date() },
      }),
    ]);
    this.markPaper(q);
    await this.flushPapers();
    return { ok: true, examDate: iso, examTier: tier };
  }

  async reject(questionId: string) {
    const r = await this.prisma.pyqDateMap.updateMany({ where: { questionId }, data: { status: 'NOT_FOUND', note: 'Admin ne proposed date reject ki.', finishedAt: new Date() } });
    if (r.count === 0) throw new NotFoundException('Entry not found.');
    return { ok: true };
  }

  // ------------------------------------------------------------------ read APIs for the admin screen

  async overview() {
    const [byStatus, pyqTotal, pyqWithDate, notQueued, tierGroups, byExamRows] = await Promise.all([
      this.prisma.pyqDateMap.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.question.count({ where: { year: { not: null }, isActive: true } }),
      this.prisma.question.count({ where: { year: { not: null }, isActive: true, examDate: { not: null }, NOT: { examDate: '' } } }),
      this.prisma.question.count({ where: this.unmappedWhere() }),
      this.prisma.question.groupBy({ by: ['examTier'], where: { year: { not: null }, isActive: true }, _count: { _all: true } }),
      this.prisma.$queryRaw<Array<{ exam: string | null; status: string; n: number }>>`
        SELECT e.name AS exam, m.status AS status, COUNT(*)::int AS n
        FROM pyq_date_maps m
        JOIN questions q ON q.id = m."questionId"
        LEFT JOIN exams e ON e.id = q."examId"
        GROUP BY e.name, m.status
        ORDER BY e.name`,
    ]);

    const counts: Record<string, number> = {};
    for (const s of STATUSES) counts[s] = 0;
    for (const g of byStatus) counts[g.status] = g._count._all;
    counts.UNMAPPED = notQueued;

    const examMap = new Map<string, Record<string, number>>();
    for (const r of byExamRows) {
      const k = r.exam ?? '(no exam)';
      const e = examMap.get(k) ?? {};
      e[r.status] = r.n;
      examMap.set(k, e);
    }

    return {
      totals: { pyqTotal, pyqWithDate, pyqWithoutDate: pyqTotal - pyqWithDate, notQueued },
      counts,
      tiers: tierGroups.map((t) => ({ tier: t.examTier ?? 'UNKNOWN', count: t._count._all })),
      byExam: Array.from(examMap.entries()).map(([exam, c]) => ({ exam, counts: c })),
    };
  }

  async listItems(f: { status?: string; examId?: string; subjectId?: string; chapterId?: string; year?: number; tier?: string; q?: string; skip?: number; take?: number }) {
    if (f.status === 'UNMAPPED') return this.listUnmapped(f);
    const questionWhere: Prisma.QuestionWhereInput = {};
    if (f.examId) questionWhere.examId = f.examId;
    if (f.subjectId) questionWhere.subjectId = f.subjectId;
    if (f.chapterId) questionWhere.chapterId = f.chapterId;
    if (f.year) questionWhere.year = f.year;
    const search = (f.q || '').trim();
    if (search) {
      if (/^\d{1,9}$/.test(search)) questionWhere.questionNo = parseInt(search, 10);
      else questionWhere.questionText = { contains: search, mode: 'insensitive' };
    }
    const where: Prisma.PyqDateMapWhereInput = {
      ...(f.status && (STATUSES as readonly string[]).includes(f.status) ? { status: f.status } : {}),
      ...(f.tier ? { examTier: f.tier } : {}),
      ...(Object.keys(questionWhere).length ? { question: questionWhere } : {}),
    };
    const take = Math.max(1, Math.min(f.take ?? 30, 100));
    const [total, rows] = await Promise.all([
      this.prisma.pyqDateMap.count({ where }),
      this.prisma.pyqDateMap.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: Math.max(0, f.skip ?? 0),
        take,
        select: {
          id: true, questionId: true, status: true, examTier: true, proposedDate: true, proposedYear: true, agreeCount: true, passesDone: true,
          confidence: true, note: true, attempts: true, lastError: true, verifyExisting: true, finishedAt: true, appliedAt: true, updatedAt: true,
          question: {
            select: {
              questionNo: true, questionText: true, year: true, shift: true, examDate: true, examTier: true, paperCode: true,
              exam: { select: { name: true } }, subject: { select: { name: true } }, chapter: { select: { name: true } },
            },
          },
        },
      }),
    ]);
    return {
      total,
      rows: rows.map((r) => ({
        ...r,
        question: { ...r.question, questionText: cleanQuestionText(r.question.questionText).slice(0, 220) },
      })),
    };
  }

  /** Virtual status "UNMAPPED": PYQ questions without a date and without a row yet (shaped like the table rows). */
  private async listUnmapped(f: { examId?: string; subjectId?: string; chapterId?: string; year?: number; tier?: string; q?: string; skip?: number; take?: number }) {
    const where: Prisma.QuestionWhereInput = { ...this.unmappedWhere({ examId: f.examId, subjectId: f.subjectId, chapterId: f.chapterId, year: f.year }) };
    if (f.tier) where.examTier = f.tier;
    const search = (f.q || '').trim();
    if (search) {
      if (/^\d{1,9}$/.test(search)) where.questionNo = parseInt(search, 10);
      else where.questionText = { contains: search, mode: 'insensitive' };
    }
    const take = Math.max(1, Math.min(f.take ?? 30, 100));
    const [total, rows] = await Promise.all([
      this.prisma.question.count({ where }),
      this.prisma.question.findMany({
        where,
        orderBy: [{ year: 'desc' }, { questionNo: 'asc' }],
        skip: Math.max(0, f.skip ?? 0),
        take,
        select: {
          id: true, questionNo: true, questionText: true, year: true, shift: true, examDate: true, examTier: true, paperCode: true, updatedAt: true,
          exam: { select: { name: true } }, subject: { select: { name: true } }, chapter: { select: { name: true } },
        },
      }),
    ]);
    return {
      total,
      rows: rows.map((r) => ({
        id: r.id,
        questionId: r.id,
        status: 'UNMAPPED',
        examTier: r.examTier,
        proposedDate: null,
        proposedYear: null,
        agreeCount: 0,
        passesDone: 0,
        confidence: null,
        note: null,
        attempts: 0,
        lastError: null,
        verifyExisting: false,
        finishedAt: null,
        appliedAt: null,
        updatedAt: r.updatedAt,
        question: {
          questionNo: r.questionNo,
          questionText: cleanQuestionText(r.questionText).slice(0, 220),
          year: r.year,
          shift: r.shift,
          examDate: r.examDate,
          examTier: r.examTier,
          paperCode: r.paperCode,
          exam: r.exam,
          subject: r.subject,
          chapter: r.chapter,
        },
      })),
    };
  }

  async getItem(questionId: string) {
    const m = await this.prisma.pyqDateMap.findUnique({
      where: { questionId },
      include: {
        question: {
          select: {
            id: true, questionNo: true, questionText: true, questionTextHindi: true, optionsJson: true, correctAnswer: true, year: true, shift: true, paperCode: true,
            examDate: true, examTier: true, exam: { select: { name: true } }, subject: { select: { name: true } }, chapter: { select: { name: true } },
          },
        },
      },
    });
    if (!m) throw new NotFoundException('No date-mapping entry was found for this question.');
    return m;
  }
}
