// Bulk-upload support helpers (Oct 1 2026 — "1 lakh questions ek saath import
// ho jaye, Internal Error nahi aana chahiye").
//
// Plain TypeScript with NO Nest / Prisma imports on purpose, so it can be unit
// tested in isolation. Contents:
//   * chunk() / yieldToEventLoop()   — keep DB queries under Postgres' 32 767
//                                       bind-variable limit and keep the API
//                                       responsive while a huge file is processed
//   * parseExcelOffThread()          — XLSX.read() is fully synchronous; on a
//                                       100k-row sheet it freezes the whole
//                                       server for tens of seconds. It runs in a
//                                       worker thread instead.
//   * UploadJobStore                 — in-memory progress tracking for the
//                                       background import (poll-able by the UI).
import { Worker } from 'worker_threads';

export const MAX_REPORTED_ERRORS = 1000; // errors kept WITH row data (UI list + CSV report)
export const MAX_REPORTED_WARNINGS = 500;
export const DB_IN_CHUNK = 5000; // values per `IN (...)` query (limit is 32 767 binds)
export const INSERT_CHUNK = 400; // rows per createMany (~35 columns => ~14k binds)
export const MAX_CONCURRENT_UPLOAD_JOBS = 2;

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Lets timers / HTTP requests / health-checks run between slices of heavy synchronous work. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const EXCEL_WORKER_SRC = `
const { parentPort, workerData } = require('worker_threads');
try {
  const XLSX = require(workerData.xlsxPath);
  const wb = XLSX.read(Buffer.from(workerData.buf), { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
  parentPort.postMessage({ ok: true, data });
} catch (e) {
  parentPort.postMessage({ ok: false, error: String((e && e.message) || e) });
}
`;

/**
 * Parses the FIRST sheet of an .xlsx/.xls buffer into an array-of-arrays
 * (header row first) inside a worker thread. `xlsxPath` is injectable for tests.
 */
export function parseExcelOffThread(buffer: Buffer, xlsxPath?: string): Promise<any[][]> {
  return new Promise((resolve, reject) => {
    let resolved = '';
    try {
      resolved = xlsxPath || require.resolve('xlsx');
    } catch (e) {
      return reject(new Error('xlsx module not found'));
    }
    // Own copy of the bytes: the multer buffer may share a pooled ArrayBuffer.
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    let settled = false;
    // resourceLimits: if a monster sheet exhausts memory, only THIS worker dies
    // (clean error to the admin) — the API process and its other users survive.
    const worker = new Worker(EXCEL_WORKER_SRC, {
      eval: true,
      workerData: { buf: ab, xlsxPath: resolved },
      transferList: [ab],
      resourceLimits: { maxOldGenerationSizeMb: 1536 },
    });
    worker.once('message', (m: { ok: boolean; data?: any[][]; error?: string }) => {
      settled = true;
      if (m.ok) resolve(m.data || []);
      else reject(new Error(m.error || 'Excel parse failed'));
      void worker.terminate();
    });
    worker.once('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    worker.once('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Excel parser stopped unexpectedly (exit code ${code}) — the file is probably too large for the server memory; split it into smaller files.`));
      }
    });
  });
}

// ---------------------------------------------------------------- job tracking
export type UploadJobStatus = 'RUNNING' | 'DONE' | 'FAILED';
export interface UploadJob {
  id: string; // == QuestionUploadBatch id
  adminId: string;
  kind: string;
  filename?: string;
  status: UploadJobStatus;
  phase: string;
  processed: number;
  total: number;
  created: number;
  failed: number;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  result?: any;
  error?: string;
}

export class UploadJobStore {
  private jobs = new Map<string, UploadJob>();
  constructor(private readonly ttlMs = 6 * 3600 * 1000, private readonly maxJobs = 100) {}

  create(init: { id: string; adminId: string; kind: string; filename?: string }): UploadJob {
    this.prune();
    const now = Date.now();
    const job: UploadJob = { ...init, status: 'RUNNING', phase: 'QUEUED', processed: 0, total: 0, created: 0, failed: 0, startedAt: now, updatedAt: now };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): UploadJob | undefined {
    return this.jobs.get(id);
  }

  patch(id: string, p: Partial<UploadJob>): void {
    const j = this.jobs.get(id);
    if (!j) return;
    Object.assign(j, p, { updatedAt: Date.now() });
  }

  runningCount(): number {
    let n = 0;
    for (const j of this.jobs.values()) if (j.status === 'RUNNING') n++;
    return n;
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, j] of this.jobs) {
      if (j.status !== 'RUNNING' && now - (j.finishedAt ?? j.updatedAt) > this.ttlMs) this.jobs.delete(id);
    }
    if (this.jobs.size >= this.maxJobs) {
      const oldestFinished = [...this.jobs.values()].filter((j) => j.status !== 'RUNNING').sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (oldestFinished) this.jobs.delete(oldestFinished.id);
    }
  }
}

// ------------------------------------------------------------------- CSV
/**
 * Decodes a CSV buffer: UTF-8 (with/without BOM), and the UTF-16 files Excel
 * produces for "Unicode Text" — otherwise Hindi columns arrive as garbage.
 */
export function decodeCsvBuffer(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  const text = buf.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Picks the delimiter (comma / semicolon / tab) used by the header line. */
export function detectCsvDelimiter(text: string): string {
  const end = text.search(/\r|\n/);
  const head = end === -1 ? text : text.slice(0, end);
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (c === '"') inQ = !inQ;
    else if (!inQ && c in counts) counts[c]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
}

/**
 * RFC-4180 CSV parser: quoted cells may contain commas, escaped quotes ("")
 * AND line breaks (a question with a multi-line explanation used to be torn
 * into several broken rows by the old split-on-newline reader). Handles CRLF,
 * skips blank lines, trims cells. Single pass, ~1 s per 100 000 rows.
 */
export function parseCsvText(text: string, delimiter?: string): string[][] {
  const delim = delimiter ?? detectCsvDelimiter(text);
  const dc = delim.charCodeAt(0);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let cellStart = 0; // start of the current un-copied run
  const n = text.length;
  const flushCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const flushRow = () => {
    flushCell();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (inQuotes) {
      if (c === 34) {
        if (text.charCodeAt(i + 1) === 34) {
          cell += text.slice(cellStart, i + 1);
          i++;
          cellStart = i + 1;
        } else {
          cell += text.slice(cellStart, i);
          inQuotes = false;
          cellStart = i + 1;
        }
      }
    } else if (c === 34 && cell === '' && text.slice(cellStart, i).trim() === '') {
      inQuotes = true;
      cellStart = i + 1;
    } else if (c === dc) {
      cell += text.slice(cellStart, i);
      flushCell();
      cellStart = i + 1;
    } else if (c === 10 || c === 13) {
      cell += text.slice(cellStart, i);
      flushRow();
      if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
      cellStart = i + 1;
    }
  }
  if (cellStart < n || cell !== '' || row.length > 0) {
    cell += text.slice(cellStart, n);
    flushRow();
  }
  return rows;
}
