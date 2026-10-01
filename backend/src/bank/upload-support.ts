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
