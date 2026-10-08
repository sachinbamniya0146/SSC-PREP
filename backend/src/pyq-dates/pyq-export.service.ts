import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { buildZip } from './zip.util';
import { cleanQuestionText, normalizeTier } from './pyq-date.util';

/**
 * Admin PYQ export (NEW Oct 7 2026): previous-year questions as Excel, grouped
 * exam-wise / subject-wise / chapter-wise (or exam > subject > chapter, tier, year, date),
 * either as ONE workbook with a sheet per group (+ a Summary sheet) or as a ZIP with a real
 * folder tree  Exam / Subject / Chapter.xlsx.
 */

export type PyqGroupBy = 'none' | 'exam' | 'subject' | 'chapter' | 'hierarchy' | 'tier' | 'year' | 'date';
export type PyqLayout = 'sheets' | 'zip';

export interface PyqExportFilters {
  examId?: string;
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
  year?: number;
  examDate?: string;
  tier?: string;
  dateState?: 'mapped' | 'unmapped' | 'all';
  published?: 'published' | 'unpublished' | 'all';
}

const ROW_CAP = 120_000;
const PAGE = 4000;
const MAX_SHEETS = 200;
const CELL_MAX = 32000;

type Row = Record<string, string | number | boolean>;

interface Flat {
  exam: string;
  tier: string;
  subject: string;
  chapter: string;
  year: number | null;
  examDate: string;
  shift: string;
  hasDate: boolean;
  qno: number;
  row: Row;
}

const HEADERS = [
  'Q No', 'Exam', 'Tier', 'Subject', 'Chapter', 'Topic', 'Sub-Topic', 'Year', 'Exam Date', 'Shift', 'Paper Code',
  'Question (EN)', 'Question (HI)', 'A', 'B', 'C', 'D', 'A (HI)', 'B (HI)', 'C (HI)', 'D (HI)', 'Answer',
  'Explanation (EN)', 'Explanation (HI)', 'Difficulty', 'Marks', 'Negative', 'Published', 'Date Map Status', 'Date Confidence', 'Question ID',
];

function cell(v: unknown): string {
  const s = String(v ?? '');
  return s.length > CELL_MAX ? `${s.slice(0, CELL_MAX)}…` : s;
}

function safeName(s: string, max = 80): string {
  const t = String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return (t || 'Unknown').slice(0, max).trim();
}

function sheetName(parts: string[], used: Set<string>): string {
  const clean = parts.map((p) => String(p || 'Unknown').replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Unknown');
  let name = clean.join(' - ');
  if (name.length > 31 && clean.length > 1) {
    // short leading parts ("CGL", "Quant"), the last part (chapter) gets the room that is left
    const head = clean.slice(0, -1).map((p) => p.replace(/^SSC\s+/i, '').slice(0, 9).trim());
    const room = 31 - head.join(' - ').length - 3;
    name = `${head.join(' - ')} - ${clean[clean.length - 1].slice(0, Math.max(6, room))}`;
  }
  name = name.slice(0, 31).trim();
  let candidate = name;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = `~${n++}`;
    candidate = `${name.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

@Injectable()
export class PyqExportService {
  constructor(private readonly prisma: PrismaService) {}

  private where(f: PyqExportFilters): Prisma.QuestionWhereInput {
    const and: Prisma.QuestionWhereInput[] = [{ year: { not: null } }];
    if (f.examId) and.push({ examId: f.examId });
    if (f.subjectId) and.push({ subjectId: f.subjectId });
    if (f.chapterId) and.push({ chapterId: f.chapterId });
    if (f.topicId) and.push({ topicId: f.topicId });
    if (f.year) and.push({ year: f.year });
    if (f.examDate) and.push({ examDate: f.examDate });
    if (f.tier) {
      const t = normalizeTier(f.tier);
      if (f.tier.toUpperCase() === 'UNKNOWN') and.push({ examTier: null });
      else if (t) and.push({ examTier: t });
    }
    if (f.dateState === 'mapped') and.push({ examDate: { not: null } }, { NOT: { examDate: '' } });
    if (f.dateState === 'unmapped') and.push({ OR: [{ examDate: null }, { examDate: '' }] });
    if (f.published === 'published') and.push({ isApproved: true, isActive: true, autoSuspended: false });
    if (f.published === 'unpublished') and.push({ OR: [{ isApproved: false }, { isActive: false }, { autoSuspended: true }] });
    return { AND: and };
  }

  async count(f: PyqExportFilters): Promise<number> {
    return this.prisma.question.count({ where: this.where(f) });
  }

  private async load(f: PyqExportFilters): Promise<{ rows: Flat[]; total: number; truncated: boolean }> {
    const where = this.where(f);
    const total = await this.prisma.question.count({ where });
    const rows: Flat[] = [];
    let last = 0;
    while (rows.length < ROW_CAP) {
      const page = await this.prisma.question.findMany({
        where: { AND: [where, { questionNo: { gt: last } }] },
        orderBy: { questionNo: 'asc' },
        take: Math.min(PAGE, ROW_CAP - rows.length),
        select: {
          id: true, questionNo: true, year: true, shift: true, paperCode: true, examDate: true, examTier: true,
          questionText: true, questionTextHindi: true, optionsJson: true, correctAnswer: true, explanation: true, explanationHindi: true,
          difficulty: true, marks: true, negativeMarks: true, isApproved: true, isActive: true, autoSuspended: true,
          exam: { select: { name: true } }, subject: { select: { name: true } }, chapter: { select: { name: true } },
          topic: { select: { name: true } }, subTopic: { select: { name: true } },
          pyqDateMap: { select: { status: true, confidence: true } },
        },
      });
      if (page.length === 0) break;
      for (const q of page) {
        const opts = (Array.isArray(q.optionsJson) ? q.optionsJson : []) as Array<{ key?: string; text?: string; textHi?: string }>;
        const o = (k: string) => opts.find((x) => x?.key === k) ?? {};
        const hasDate = !!q.examDate;
        const published = q.isApproved && q.isActive && !q.autoSuspended;
        const row: Row = {
          'Q No': q.questionNo,
          Exam: q.exam?.name ?? '',
          Tier: q.examTier === 'TIER_1' ? 'Tier 1' : q.examTier === 'TIER_2' ? 'Tier 2' : '',
          Subject: q.subject?.name ?? '',
          Chapter: q.chapter?.name ?? '',
          Topic: q.topic?.name ?? '',
          'Sub-Topic': q.subTopic?.name ?? '',
          Year: q.year ?? '',
          'Exam Date': q.examDate ?? '',
          Shift: q.shift ?? '',
          'Paper Code': q.paperCode ?? '',
          'Question (EN)': cell(cleanQuestionText(q.questionText)),
          'Question (HI)': cell(cleanQuestionText(q.questionTextHindi || '')),
          A: cell((o('A') as any).text ?? ''), B: cell((o('B') as any).text ?? ''), C: cell((o('C') as any).text ?? ''), D: cell((o('D') as any).text ?? ''),
          'A (HI)': cell((o('A') as any).textHi ?? ''), 'B (HI)': cell((o('B') as any).textHi ?? ''), 'C (HI)': cell((o('C') as any).textHi ?? ''), 'D (HI)': cell((o('D') as any).textHi ?? ''),
          Answer: q.correctAnswer ?? '',
          'Explanation (EN)': cell(q.explanation ?? ''),
          'Explanation (HI)': cell(q.explanationHindi ?? ''),
          Difficulty: String(q.difficulty ?? ''),
          Marks: q.marks,
          Negative: q.negativeMarks,
          Published: published ? 'Yes' : 'No',
          'Date Map Status': q.pyqDateMap?.status ?? (hasDate ? 'HAD_DATE' : 'NOT_QUEUED'),
          'Date Confidence': q.pyqDateMap?.confidence ?? '',
          'Question ID': q.id,
        };
        rows.push({
          exam: q.exam?.name ?? '(No exam)',
          tier: q.examTier === 'TIER_1' ? 'Tier 1' : q.examTier === 'TIER_2' ? 'Tier 2' : 'Tier unknown',
          subject: q.subject?.name ?? '(No subject)',
          chapter: q.chapter?.name ?? '(No chapter)',
          year: q.year,
          examDate: q.examDate ?? '',
          shift: q.shift ?? '',
          hasDate,
          qno: q.questionNo,
          row,
        });
      }
      last = page[page.length - 1].questionNo;
      if (page.length < PAGE) break;
    }
    rows.sort(
      (a, b) =>
        a.exam.localeCompare(b.exam) || a.subject.localeCompare(b.subject) || a.chapter.localeCompare(b.chapter) ||
        (b.year ?? 0) - (a.year ?? 0) || a.examDate.localeCompare(b.examDate) || a.shift.localeCompare(b.shift) || a.qno - b.qno,
    );
    return { rows, total, truncated: total > rows.length };
  }

  private keyParts(r: Flat, g: PyqGroupBy): string[] {
    switch (g) {
      case 'exam': return [r.exam];
      case 'subject': return [r.subject];
      case 'chapter': return [r.subject, r.chapter];
      case 'hierarchy': return [r.exam, r.subject, r.chapter];
      case 'tier': return [r.tier];
      case 'year': return [String(r.year ?? 'No year')];
      case 'date': return [r.examDate || 'No date mapped'];
      default: return ['All PYQ'];
    }
  }

  private sheetOf(rows: Flat[]): XLSX.WorkSheet {
    const ws = XLSX.utils.json_to_sheet(rows.map((r) => r.row), { header: HEADERS });
    const widths = [8, 16, 8, 22, 28, 22, 22, 7, 12, 14, 20, 60, 60, 24, 24, 24, 24, 24, 24, 24, 24, 8, 60, 60, 11, 7, 9, 10, 15, 10, 38];
    ws['!cols'] = widths.map((wch) => ({ wch }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length), c: HEADERS.length - 1 } }) };
    return ws;
  }

  private summarySheet(all: Flat[], f: PyqExportFilters, meta: { total: number; truncated: boolean; groupBy: PyqGroupBy }): XLSX.WorkSheet {
    const aoa: Array<Array<string | number>> = [];
    aoa.push(['PYQ Export — Summary']);
    aoa.push(['Generated', new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC']);
    aoa.push(['Grouping', meta.groupBy]);
    aoa.push(['Filters', JSON.stringify(f)]);
    aoa.push(['Questions in this file', all.length]);
    if (meta.truncated) aoa.push([`NOTE: ${meta.total} questions matched, only the first ${all.length} are exported. Narrow the filter (exam / subject / chapter / year) for the rest.`]);
    aoa.push([]);

    const count = <K>(keyFn: (r: Flat) => K[]) => {
      const m = new Map<string, { k: K[]; n: number; d: number }>();
      for (const r of all) {
        const k = keyFn(r);
        const id = JSON.stringify(k);
        const e = m.get(id) ?? { k, n: 0, d: 0 };
        e.n++;
        if (r.hasDate) e.d++;
        m.set(id, e);
      }
      return Array.from(m.values()).sort((a, b) => JSON.stringify(a.k).localeCompare(JSON.stringify(b.k)));
    };
    const addTable = (title: string, head: string[], data: Array<Array<string | number>>) => {
      aoa.push([title]);
      aoa.push(head);
      for (const d of data.slice(0, 5000)) aoa.push(d);
      aoa.push([]);
    };
    addTable('Exam-wise', ['Exam', 'Tier', 'Questions', 'With exam date', 'Without date'], count((r) => [r.exam, r.tier]).map((e) => [...(e.k as string[]), e.n, e.d, e.n - e.d]));
    addTable('Subject-wise', ['Exam', 'Subject', 'Questions', 'With exam date', 'Without date'], count((r) => [r.exam, r.subject]).map((e) => [...(e.k as string[]), e.n, e.d, e.n - e.d]));
    addTable('Chapter-wise', ['Exam', 'Subject', 'Chapter', 'Questions', 'With exam date', 'Without date'], count((r) => [r.exam, r.subject, r.chapter]).map((e) => [...(e.k as string[]), e.n, e.d, e.n - e.d]));
    addTable('Date-wise (each paper / shift)', ['Exam', 'Tier', 'Year', 'Exam Date', 'Shift', 'Questions'], count((r) => [r.exam, r.tier, r.year ?? '', r.examDate || 'not mapped', r.shift]).map((e) => [...(e.k as Array<string | number>), e.n]));

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 34 }, { wch: 28 }, { wch: 30 }, { wch: 18 }, { wch: 14 }, { wch: 14 }];
    return ws;
  }

  async exportPyq(f: PyqExportFilters, groupBy: PyqGroupBy, layout: PyqLayout): Promise<{ buffer: Buffer; contentType: string; filename: string; rows: number }> {
    const { rows, total, truncated } = await this.load(f);
    if (rows.length === 0) throw new BadRequestException('In filters ke saath koi PYQ question nahi mila.');
    const stamp = new Date().toISOString().slice(0, 10);
    const label = groupBy === 'none' ? 'all' : groupBy;

    const groups = new Map<string, { parts: string[]; rows: Flat[] }>();
    for (const r of rows) {
      const parts = this.keyParts(r, groupBy);
      const id = JSON.stringify(parts);
      const g = groups.get(id) ?? { parts, rows: [] };
      g.rows.push(r);
      groups.set(id, g);
    }
    const list = Array.from(groups.values());

    if (layout === 'zip') {
      const files: Array<{ name: string; data: Buffer }> = [];
      const wbSum = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wbSum, this.summarySheet(rows, f, { total, truncated, groupBy }), 'Summary');
      files.push({ name: '00_Summary.xlsx', data: XLSX.write(wbSum, { type: 'buffer', bookType: 'xlsx' }) as Buffer });
      const usedPaths = new Set<string>();
      for (const g of list) {
        const parts = g.parts.map((p) => safeName(p));
        let path = `${parts.slice(0, -1).join('/')}${parts.length > 1 ? '/' : ''}${parts[parts.length - 1]}`;
        let n = 2;
        while (usedPaths.has(path.toLowerCase())) path = `${parts.slice(0, -1).join('/')}${parts.length > 1 ? '/' : ''}${parts[parts.length - 1]} (${n++})`;
        usedPaths.add(path.toLowerCase());
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, this.sheetOf(g.rows), 'PYQ');
        files.push({ name: `${path}.xlsx`, data: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer });
      }
      return { buffer: buildZip(files), contentType: 'application/zip', filename: `pyq_export_${label}_${stamp}.zip`, rows: rows.length };
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, this.summarySheet(rows, f, { total, truncated, groupBy }), 'Summary');
    const used = new Set<string>(['summary']);
    if (groupBy === 'none' || list.length === 1) {
      XLSX.utils.book_append_sheet(wb, this.sheetOf(rows), sheetName([list.length === 1 ? list[0].parts.join(' - ') : 'All PYQ'], used));
    } else {
      const shown = list.slice(0, MAX_SHEETS - 2);
      for (const g of shown) XLSX.utils.book_append_sheet(wb, this.sheetOf(g.rows), sheetName(g.parts, used));
      const rest = list.slice(shown.length).flatMap((g) => g.rows);
      if (rest.length) XLSX.utils.book_append_sheet(wb, this.sheetOf(rest), sheetName(['Others'], used));
    }
    return {
      buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `pyq_export_${label}_${stamp}.xlsx`,
      rows: rows.length,
    };
  }

  /** Date-mapping log: every question the worker looked at, with the 5 passes, as Excel. */
  async exportDateMapping(f: { status?: string; examId?: string }): Promise<{ buffer: Buffer; filename: string }> {
    const where: Prisma.PyqDateMapWhereInput = {
      ...(f.status ? { status: f.status } : {}),
      ...(f.examId ? { question: { examId: f.examId } } : {}),
    };
    const out: Row[] = [];
    let cursor: string | undefined;
    while (out.length < ROW_CAP) {
      const page = await this.prisma.pyqDateMap.findMany({
        where,
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          question: {
            select: {
              questionNo: true, questionText: true, year: true, shift: true, paperCode: true, examDate: true, examTier: true,
              exam: { select: { name: true } }, subject: { select: { name: true } }, chapter: { select: { name: true } },
            },
          },
        },
      });
      if (page.length === 0) break;
      for (const m of page) {
        const passes = (Array.isArray(m.passesJson) ? m.passesJson : []) as Array<{ verdict?: string; examDate?: string | null; model?: string | null; keyName?: string | null }>;
        const sources = (Array.isArray(m.sourcesJson) ? m.sourcesJson : []) as Array<{ url?: string }>;
        const row: Row = {
          'Q No': m.question.questionNo,
          Exam: m.question.exam?.name ?? '',
          Subject: m.question.subject?.name ?? '',
          Chapter: m.question.chapter?.name ?? '',
          Year: m.question.year ?? '',
          Shift: m.question.shift ?? '',
          'Paper Code': m.question.paperCode ?? '',
          Question: cell(cleanQuestionText(m.question.questionText).slice(0, 300)),
          Status: m.status,
          'Proposed Date': m.proposedDate ?? '',
          'Date In Question': m.question.examDate ?? '',
          Tier: m.examTier === 'TIER_1' ? 'Tier 1' : m.examTier === 'TIER_2' ? 'Tier 2' : '',
          'Agree / Passes': `${m.agreeCount}/${m.passesDone}`,
          Confidence: m.confidence ?? '',
          Note: m.note ?? '',
          Sources: sources.map((s) => s.url).filter(Boolean).join('\n'),
          Attempts: m.attempts,
          'Last Error': m.lastError ?? '',
          'Applied At': m.appliedAt ? m.appliedAt.toISOString().replace('T', ' ').slice(0, 19) : '',
          'Updated At': m.updatedAt.toISOString().replace('T', ' ').slice(0, 19),
        };
        for (let i = 0; i < 5; i++) {
          const p = passes[i];
          row[`Pass ${i + 1}`] = p ? `${p.verdict ?? ''}${p.examDate ? ` ${p.examDate}` : ''}${p.model ? ` [${p.model}]` : ''}${p.keyName ? ` (${p.keyName})` : ''}` : '';
        }
        out.push(row);
      }
      cursor = page[page.length - 1].id;
      if (page.length < PAGE) break;
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(out);
    ws['!cols'] = [8, 16, 22, 26, 7, 14, 20, 60, 14, 12, 12, 8, 9, 10, 50, 50, 8, 30, 18, 18, 32, 32, 32, 32, 32].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, 'Date Mapping');
    return { buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, filename: `pyq_date_mapping_${new Date().toISOString().slice(0, 10)}.xlsx` };
  }
}
