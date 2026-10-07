/* eslint-disable @typescript-eslint/no-explicit-any */
// Background bulk-upload jobs (Oct 2026) — Excel / CSV / JSON.
//
// WHY: the old handlers did the whole import inside ONE HTTP request. A 300+ row
// sheet, or a JSON full of images, on a slow mobile connection hit Cloudflare /
// nginx timeouts or a dropped fetch -> "Internal Server Error" / "fetch failed",
// even though the server kept working. Now the request only validates the file,
// starts a job and returns a jobId immediately; the browser polls
// GET .../job/:id for live progress. Rows go through the existing
// BankUploadService pipeline in chunks of 100 (same validation, taxonomy
// auto-create, image upload, PYQ-mock auto-detect).
//
// QUALITY GATE (new): rows with a missing/invalid answer key, a missing solution,
// an empty option or a duplicate (file or database, picture-aware) are NOT
// uploaded and are listed in the report; a dry-run mode only reports.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { BankUploadService } from './bank-upload.service';
import { parseJsonQuestions, shortDigest, mediaKey } from './question-media.util';

export type JobErrorCategory =
  | 'MISSING_FIELD' | 'INVALID_REFERENCE' | 'DUPLICATE' | 'FORMAT' | 'OTHER'
  | 'MISSING_ANSWER' | 'MISSING_SOLUTION';

export interface JobError { row: number; error: string; category: JobErrorCategory | string; questionPreview?: string }

export interface UploadJob {
  id: string;
  adminId: string;
  filename: string;
  kind: 'SHEET' | 'JSON';
  dryRun: boolean;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  phase: string;
  total: number;
  processed: number;
  created: number;
  failed: number;
  // Oct 6 2026: same-question rows waiting in the admin's Duplicate Review queue (not failures)
  queuedForReview: number;
  queuedExact: number;
  errors: JobError[];
  warnings: { row: number; message: string; questionPreview?: string }[];
  uploadBatchId?: string;
  fatalError?: string;
  headers: string[];
  rejectedRows: { row: number; reason: string; data: any }[];
  startedAt: number;
  finishedAt?: number;
}

/** Everything the quality gate needs, extracted the same way for a sheet row or a JSON object. */
interface Item {
  rowNum: number;
  data: any; // original row array (sheet) or object (JSON)
  text: string;
  answer: string;
  options: string[];
  emptyOptions: string[];
  hasStem: boolean;
  hasSolution: boolean;
  media: string;
}

const CHUNK = 100;
const JOB_TTL_MS = 60 * 60 * 1000;

const norm = (s: unknown): string =>
  String(s ?? '').toLowerCase().replace(/[\s\u00a0]+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();

@Injectable()
export class BankUploadJobService {
  private readonly log = new Logger(BankUploadJobService.name);
  private readonly jobs = new Map<string, UploadJob>();

  constructor(private readonly prisma: PrismaService, private readonly upload: BankUploadService) {}

  get(id: string): UploadJob | undefined { return this.jobs.get(id); }

  private gc() {
    const now = Date.now();
    for (const [id, j] of this.jobs) if (j.finishedAt && now - j.finishedAt > JOB_TTL_MS) this.jobs.delete(id);
  }

  // ------------------------------------------------------------------ parsing
  private parseSheet(buffer: Buffer): { headers: string[]; rows: any[][] } {
    let data: any[][];
    try {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false }) as any[][];
    } catch (e: any) {
      throw new BadRequestException(`File padhi nahi ja saki (${e?.message ?? e}) — sahi .xlsx/.csv file upload karein.`);
    }
    if (!data || data.length < 2) throw new BadRequestException('File me header row ke baad kam se kam 1 question row honi chahiye.');
    const headers = (data[0] as any[]).map((h) => String(h ?? '').trim());
    const rows = data.slice(1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
    if (rows.length === 0) throw new BadRequestException('File me koi question row nahi mili.');
    for (const req of ['examId', 'subjectId', 'chapterId', 'questionText', 'correctAnswer', 'optionA', 'optionB', 'optionC', 'optionD']) {
      if (!headers.some((h) => h.replace(/\*\s*$/, '') === req)) {
        throw new BadRequestException(`Required column missing: ${req} — header row check karein (template se copy karein).`);
      }
    }
    return { headers, rows };
  }

  private sheetItems(headers: string[], rows: any[][]): Item[] {
    const idx: Record<string, number> = {};
    headers.forEach((h, i) => { idx[h.replace(/\*\s*$/, '')] = i; });
    const get = (r: any[], k: string) => (idx[k] === undefined ? '' : String(r[idx[k]] ?? '').trim());
    return rows.map((r, i) => {
      const letters = ['A', 'B', 'C', 'D'];
      const options = letters.map((k) => get(r, `option${k}`));
      const diag = get(r, 'optionDiagramTypes').split('|');
      const imgs = get(r, 'optionImageUrls').split('|');
      const emptyOptions = letters.filter((k, n) => !options[n] && !(diag[n] || '').trim() && !(imgs[n] || '').trim());
      const stemMedia = [get(r, 'questionDiagramType'), get(r, 'questionDiagramLabels'), mediaKey(get(r, 'questionImageUrl')), get(r, 'questionSvg') ? shortDigest(get(r, 'questionSvg')) : ''].join('~');
      const optMedia = [get(r, 'optionDiagramTypes'), get(r, 'optionDiagramLabels'), get(r, 'optionImageUrls').split('|').map(mediaKey).join('|')].join('~');
      return {
        rowNum: i + 2,
        data: r,
        text: get(r, 'questionText'),
        answer: get(r, 'correctAnswer').toUpperCase(),
        options,
        emptyOptions,
        hasStem: !!(get(r, 'questionText') || get(r, 'questionDiagramType') || get(r, 'questionImageUrl') || get(r, 'questionSvg')),
        hasSolution: !!(get(r, 'explanation') || get(r, 'explanationHindi') || get(r, 'explanationImageUrl') || get(r, 'explanationSvg')),
        media: `${stemMedia}#${optMedia}`,
      };
    });
  }

  private jsonItems(list: any[]): Item[] {
    return list.map((q: any, i: number) => {
      const o: any[] = Array.isArray(q?.options) ? q.options : [];
      const byKey = (k: string) => o.find((x) => String(x?.key).toUpperCase() === k) ?? {};
      const letters = ['A', 'B', 'C', 'D'];
      const options = letters.map((k) => String(byKey(k).text ?? '').trim());
      const emptyOptions = letters.filter((k, n) => {
        const x = byKey(k);
        return !options[n] && !x.diagramType && !x.imageUrl && !x.imageBase64 && !x.svg;
      });
      const stemMedia = [q?.questionDiagramType, (q?.questionDiagramLabels ?? []).join?.(','), mediaKey(q?.questionImageUrl), q?.questionSvg ? shortDigest(q.questionSvg) : '', q?.questionImageBase64 ? shortDigest(q.questionImageBase64) : ''].join('~');
      const optMedia = letters.map((k) => { const x = byKey(k); return [x.diagramType, (x.diagramLabels ?? []).join?.(','), mediaKey(x.imageUrl), x.svg ? shortDigest(x.svg) : '', x.imageBase64 ? shortDigest(x.imageBase64) : ''].join('.'); }).join('|');
      return {
        rowNum: i + 1,
        data: q,
        text: String(q?.questionText ?? '').trim(),
        answer: String(q?.correctAnswer ?? '').trim().toUpperCase(),
        options,
        emptyOptions,
        hasStem: !!(String(q?.questionText ?? '').trim() || q?.questionDiagramType || q?.questionImageUrl || q?.questionSvg || q?.questionImageBase64),
        hasSolution: !!(String(q?.explanation ?? '').trim() || String(q?.explanationHindi ?? '').trim() || q?.explanationImageUrl || q?.explanationImageBase64 || q?.explanationSvg),
        media: `${stemMedia}#${optMedia}`,
      };
    });
  }

  // -------------------------------------------------------------------- start
  start(opts: {
    buffer: Buffer; filename: string; adminId: string; isPracticeOnly: boolean; requireSolution: boolean; dryRun: boolean;
  }): UploadJob {
    this.gc();
    const looksJson = /\.json$/i.test(opts.filename) || /^\s*[\[{]/.test(opts.buffer.subarray(0, 64).toString('utf8').replace(/^\uFEFF/, ''));
    let kind: 'SHEET' | 'JSON' = 'SHEET';
    let headers: string[] = [];
    let items: Item[];
    if (looksJson) {
      kind = 'JSON';
      const list = parseJsonQuestions(opts.buffer.toString('utf8'));
      if (!list || list.length === 0) {
        throw new BadRequestException('JSON sahi nahi hai ya khali hai. Ye ho sakta hai: [ {...}, {...} ] ya { "questions": [ ... ] } ya har line me ek question. Admin → Help se JSON template download karein.');
      }
      items = this.jsonItems(list);
    } else {
      const parsed = this.parseSheet(opts.buffer);
      headers = parsed.headers;
      items = this.sheetItems(parsed.headers, parsed.rows);
    }
    const job: UploadJob = {
      id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      adminId: opts.adminId, filename: opts.filename, kind, dryRun: opts.dryRun,
      status: 'RUNNING', phase: 'Checking rows…', total: items.length, processed: 0, created: 0, failed: 0, queuedForReview: 0, queuedExact: 0,
      errors: [], warnings: [], headers, rejectedRows: [], startedAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    void this.run(job, items, opts).catch((e) => {
      this.log.error(`upload job ${job.id} crashed: ${e?.stack ?? e}`);
      job.status = 'FAILED';
      if (job.uploadBatchId) void this.upload.failUploadBatch(job.uploadBatchId, e?.message ?? String(e));
      job.fatalError = e?.message ?? String(e);
      job.phase = 'Failed';
      job.finishedAt = Date.now();
    });
    return job;
  }

  private reject(job: UploadJob, it: Item, category: JobErrorCategory | string, reason: string) {
    job.failed++;
    const preview = it.text.replace(/\s+/g, ' ').slice(0, 90);
    job.errors.push({ row: it.rowNum, error: reason, category, questionPreview: preview });
    job.rejectedRows.push({ row: it.rowNum, reason, data: it.data });
  }

  private dupKey(it: Item): string {
    return `${norm(it.text)}|${it.options.map(norm).join('|')}|${it.answer}|${it.media}`;
  }

  private async run(job: UploadJob, items: Item[], opts: { adminId: string; filename: string; isPracticeOnly: boolean; requireSolution: boolean; dryRun: boolean }) {
    // ---------- Phase 1: quality gate (no DB) ----------
    const ok: Item[] = [];
    const seen = new Map<string, number>();
    for (const it of items) {
      if (!it.hasStem) { this.reject(job, it, 'MISSING_FIELD', 'Question text khali hai'); continue; }
      if (!['A', 'B', 'C', 'D'].includes(it.answer)) {
        this.reject(job, it, 'MISSING_ANSWER', it.answer ? `Answer key galat hai ("${it.answer}") — A/B/C/D chahiye` : 'Answer key (correctAnswer) missing hai');
        continue;
      }
      if (it.emptyOptions.length) { this.reject(job, it, 'MISSING_FIELD', `Option ${it.emptyOptions.join(', ')} khali hai`); continue; }
      if (opts.requireSolution && !it.hasSolution) {
        this.reject(job, it, 'MISSING_SOLUTION', 'Solution/explanation missing hai — question upload nahi hua');
        continue;
      }
      const key = this.dupKey(it);
      const first = seen.get(key);
      if (first !== undefined) {
        // Check-only run: just report it. Real run: let the row through — the importer finds it is the
        // same question as an earlier row and sends it to the admin's Duplicate Review queue
        // (exact copy or same question in another shift/solution), instead of silently dropping it.
        if (opts.dryRun) { this.reject(job, it, 'DUPLICATE', `Duplicate — file ki row ${first} me ye question pehle se hai (asli upload me ye Duplicate Review me jayega)`); continue; }
      } else {
        seen.set(key, it.rowNum);
      }
      ok.push(it);
    }
    job.processed = items.length - ok.length;

    // ---------- Dry run: DB duplicate check only, write nothing ----------
    if (opts.dryRun) {
      job.phase = 'Database duplicates check…';
      const texts = Array.from(new Set(ok.map((o) => o.text).filter(Boolean)));
      const existing = new Set<string>();
      for (let i = 0; i < texts.length; i += 400) {
        const found = await this.prisma.question.findMany({
          where: { questionText: { in: texts.slice(i, i + 400) }, isActive: true },
          select: { questionText: true, optionsJson: true, correctAnswer: true, questionImageUrl: true },
        });
        for (const f of found) {
          const o = (Array.isArray(f.optionsJson) ? (f.optionsJson as any[]) : []).slice().sort((a, b) => String(a.key).localeCompare(String(b.key)));
          const hasPic = !!f.questionImageUrl || o.some((x) => x.imageUrl || x.diagramType);
          if (hasPic) continue; // picture questions can't be judged by text — real upload checks them by hash
          existing.add(`${norm(f.questionText)}|${o.map((x) => norm(x.text)).join('|')}|${f.correctAnswer}`);
        }
      }
      let wouldCreate = 0;
      for (const it of ok) {
        const k = `${norm(it.text)}|${it.options.map(norm).join('|')}|${it.answer}`;
        if (existing.has(k) && it.media.replace(/[~#.|]/g, '') === '') this.reject(job, it, 'DUPLICATE', 'Duplicate — ye question database me pehle se maujood hai (asli upload me ye Duplicate Review me jayega)');
        else wouldCreate++;
      }
      job.created = wouldCreate;
      job.processed = job.total;
      job.phase = 'Check complete (kuch save nahi hua)';
      job.status = 'DONE';
      job.finishedAt = Date.now();
      return;
    }

    // ---------- Phase 2: real import in chunks ----------
    if (ok.length === 0) {
      job.phase = 'Koi valid row nahi mili';
      job.status = 'DONE';
      job.processed = job.total;
      job.finishedAt = Date.now();
      return;
    }
    job.phase = 'Uploading…';
    const batchId = await this.upload.beginBatch(opts.adminId, opts.filename);
    job.uploadBatchId = batchId;
    await this.upload.updateBatchProgress(batchId, { totalRows: job.total, failedCount: job.failed });
    const total: any = { success: false, total: items.length, created: 0, failed: job.failed, errors: [], warnings: [] };
    const sizeOf = job.kind === 'JSON' ? 25 : CHUNK; // JSON may carry images -> smaller chunks

    for (let off = 0; off < ok.length; off += sizeOf) {
      const slice = ok.slice(off, off + sizeOf);
      try {
        const res = job.kind === 'JSON'
          ? await this.upload.processStructuredChunk(slice.map((s) => s.data), opts.adminId, batchId, opts.isPracticeOnly)
          : await this.upload.processRowsChunk(job.headers, slice.map((s) => s.data), opts.adminId, batchId, opts.isPracticeOnly);
        const base = job.kind === 'JSON' ? 1 : 2; // chunk-local row numbers: JSON 1-based, sheet header+1
        job.created += res.created;
        job.queuedForReview += res.queuedForReview ?? 0;
        job.queuedExact += res.queuedExact ?? 0;
        for (const e of res.errors) {
          const src = slice[e.row - base];
          job.failed++;
          job.errors.push({ row: src?.rowNum ?? e.row, error: e.error, category: e.category, questionPreview: e.questionPreview });
          job.rejectedRows.push({ row: src?.rowNum ?? e.row, reason: e.error, data: src?.data ?? e.data ?? [] });
        }
        for (const w of res.warnings) job.warnings.push({ ...w, row: slice[w.row - base]?.rowNum ?? w.row });
      } catch (e: any) {
        const msg = e?.response?.message ?? e?.message ?? String(e);
        for (const s of slice) this.reject(job, s, 'OTHER', `Server error: ${msg}`);
      }
      job.processed = Math.min(job.total, job.total - ok.length + off + slice.length);
      await this.upload.updateBatchProgress(batchId, { createdCount: job.created, failedCount: job.failed, queuedCount: job.queuedForReview });
      job.phase = `Uploading… ${Math.min(off + sizeOf, ok.length)}/${ok.length}`;
    }

    total.created = job.created;
    total.queuedForReview = job.queuedForReview;
    total.queuedExact = job.queuedExact;
    total.failed = job.failed;
    total.errors = job.errors;
    total.warnings = job.warnings;
    try { await this.upload.endBatch(batchId, total); } catch (e: any) { this.log.warn(`finalize batch failed: ${e?.message ?? e}`); }
    if (opts.isPracticeOnly === false) {
      try { await this.upload.warnYearlessInPyqUpload({ ...total, uploadBatchId: batchId }); } catch { /* best effort */ }
    }
    job.errors.sort((a, b) => a.row - b.row);
    job.processed = job.total;
    job.phase = 'Complete';
    job.status = 'DONE';
    job.finishedAt = Date.now();
  }

  /** Only the rejected rows, in the SAME format as the upload (Excel for sheets, JSON for JSON) + the reason — fix and re-upload. */
  buildRejected(job: UploadJob): { buffer: Buffer; contentType: string; ext: string } {
    const rows = [...job.rejectedRows].sort((a, b) => a.row - b.row);
    if (job.kind === 'JSON') {
      const arr = rows.map((r) => ({ ...(r.data && typeof r.data === 'object' ? r.data : {}), _rejectReason: r.reason, _originalItem: r.row }));
      return { buffer: Buffer.from(JSON.stringify(arr, null, 2), 'utf8'), contentType: 'application/json', ext: 'json' };
    }
    const wb = XLSX.utils.book_new();
    const aoa: any[][] = [[...job.headers, 'rejectReason', 'originalRow']];
    for (const r of rows) aoa.push([...job.headers.map((_, i) => (r.data as any[])?.[i] ?? ''), r.reason, r.row]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Rejected');
    return { buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
  }
}
