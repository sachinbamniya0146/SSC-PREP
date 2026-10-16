import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import { AdminApiKeyService } from '../admin-api-keys/admin-api-keys.service';
import { PyqDateService } from '../pyq-dates/pyq-date.service';
import { isHindiExemptSubjectSlug } from '../common/question-visibility';
import { pacedConcurrency, redact } from '../ai-provider/ai-provider.util';
import { JOB_FEATURE, JOB_LABEL, JOB_TYPES, JobType, bootSummaryLine, estimateCalls, etaSeconds, isEmptyText, isJobType, isStuck, minAgreeFor } from './ai-job.logic';
import { ProviderBusyError, QuestionCtx, RunResult, TaxonomyChapter, runItem } from './ai-job.runner';

// ============================================================================================================
// Central AI Job Engine (NEW Oct 15 2026)
//   one DB-backed queue (ai_jobs / ai_job_items) + ONE worker loop for every AI task.
//   Restart-safe: RUNNING jobs/items go back to PENDING on boot (the queue lives in PostgreSQL, so nothing is lost).
//   Every value the AI writes is logged in ai_changes (old + new) -> Undo. Admin-entered values are never overwritten.
// ============================================================================================================

const TICK_MS = 5000;
const CLAIM_MAX = 4; // items worked on in parallel (also limited by the number of ready keys)
const BUSY_REST_MS = 45_000;
const UNDO_CHUNK = 1500;
const STUCK_ITEM_MS = 12 * 60_000; // an item RUNNING this long has no live worker behind it
const WATCHDOG_EVERY_MS = 60_000;
const BUSY_WEDGE_MS = 40 * 60_000; // a tick that never returns for this long is considered wedged

export interface JobScopeDto {
  examId?: string;
  subjectId?: string;
  chapterId?: string;
  year?: number;
  batchId?: string;
  ids?: string[];
  recheckAll?: boolean;
  verifyExisting?: boolean;
  limit?: number;
}

/** fields an AI job may write and Undo may restore (anything else is refused) */
const UNDOABLE: Record<string, 'string' | 'json' | 'date'> = {
  explanation: 'string',
  explanationHindi: 'string',
  explanationSource: 'string',
  explanationModel: 'string',
  explanationGeneratedAt: 'date',
  questionTextHindi: 'string',
  optionsJson: 'json',
  translationStatus: 'string',
  correctAnswer: 'string',
  chapterId: 'string',
  topicId: 'string',
  subTopicId: 'string',
  verificationEvidence: 'string',
  examDate: 'string',
  examTier: 'string',
};

function canon(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (x instanceof Date) return x.toISOString();
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, val]) => [k, norm(val)]));
    return x === undefined ? null : x;
  };
  return JSON.stringify(norm(v));
}

function toDb(field: string, v: unknown): unknown {
  if (UNDOABLE[field] === 'date') return v ? new Date(String(v)) : null;
  return v === undefined ? null : v;
}

interface CurrentItem {
  jobId: string;
  itemId: string;
  questionNo: number | null;
  stage: string;
  pass: number;
  passes: number;
  startedAt: number;
}

@Injectable()
export class AiJobService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiJobService.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private busySince = 0;
  private lastWatchdogAt = 0;
  private watchdogFixed = 0;
  private bootReport: { at: string; line: string; requeuedItems: number; requeuedJobs: number; resumable: number; keysActive: number; keysRevived: number } | null = null;
  private wakeAgain = false;
  private pausedUntil = 0;
  private lastTickAt = 0;
  private lastMessage: string | null = null;
  private readonly current = new Map<string, CurrentItem>();
  private readonly cancelled = new Set<string>();
  private readonly callCounter = new Map<string, number>();
  private readonly taxonomyCache = new Map<string, { at: number; chapters: TaxonomyChapter[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiProviderService,
    private readonly keys: AdminApiKeyService,
    private readonly pyq: PyqDateService,
  ) {}

  // ------------------------------------------------------------------ lifecycle

  workerEnabled(): boolean {
    return (process.env.AI_JOB_WORKER || '').toLowerCase() !== 'off';
  }

  async onModuleInit() {
    if (!this.workerEnabled()) {
      this.logger.warn('AI job worker is OFF (AI_JOB_WORKER=off).');
      return;
    }
    try {
      // a restart killed work half-way: those items / jobs go back in the queue (no duplicate writes: apply is idempotent)
      const items = await this.prisma.aiJobItem.updateMany({ where: { status: 'RUNNING', job: { type: { not: 'PYQ_DATE_SHIFT' } } }, data: { status: 'PENDING' } });
      const jobs = await this.prisma.aiJob.updateMany({ where: { status: 'RUNNING', type: { not: 'PYQ_DATE_SHIFT' } }, data: { status: 'PENDING' } });
      if (items.count || jobs.count) this.logger.log(`Re-queued ${jobs.count} AI job(s) / ${items.count} item(s) interrupted by the restart.`);
      const resumable = await this.prisma.aiJob.count({ where: { status: { in: ['PENDING', 'RUNNING'] } } });
      let keysActive = 0;
      try {
        keysActive = (await this.keys.getRotationPool('openrouter')).length;
      } catch {
        /* DB hiccup: report 0 */
      }
      const r = { requeuedItems: items.count, requeuedJobs: jobs.count, resumable, keysActive, keysRevived: 0 };
      this.bootReport = { at: new Date().toISOString(), line: bootSummaryLine(r), ...r };
      this.logger.log(`AI BOOT REPORT: ${this.bootReport.line}`);
      // 25 s after boot the provider has had its first key-revive run: record how many keys it healed
      const later = setTimeout(() => {
        void (async () => {
          try {
            const now = (await this.keys.getRotationPool('openrouter')).length;
            if (this.bootReport && now > this.bootReport.keysActive) {
              this.bootReport.keysRevived = now - this.bootReport.keysActive;
              this.bootReport.keysActive = now;
              this.bootReport.line = bootSummaryLine(this.bootReport);
              this.logger.log(`AI BOOT REPORT (updated): ${this.bootReport.line}`);
            }
          } catch {
            /* ignore */
          }
        })();
      }, 30_000);
      later.unref?.();
    } catch (e) {
      this.logger.warn(`AI job start-up check failed (is the migration applied?): ${redact((e as Error).message)}`);
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    // after every push / restart: unfinished jobs continue by themselves (no button, no admin action)
    const boot = setTimeout(() => void this.wake(), 15_000);
    boot.unref?.();
    // key added / switched on / passed a live test -> waiting jobs resume at once
    this.keys.onKeysReady(() => void this.wake());
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async wake(): Promise<void> {
    if (!this.workerEnabled()) return;
    this.pausedUntil = 0;
    if (this.busy) {
      this.wakeAgain = true;
      return;
    }
    void this.tick();
  }

  // ------------------------------------------------------------------ worker loop

  async tick(): Promise<void> {
    if (!this.workerEnabled()) return;
    if (this.busy && this.busySince && Date.now() - this.busySince > BUSY_WEDGE_MS) {
      this.logger.warn('AI worker tick was stuck for 40 min — released by the watchdog.');
      this.busy = false;
    }
    if (this.busy) return;
    if (Date.now() < this.pausedUntil) return;
    this.busy = true;
    this.busySince = Date.now();
    this.lastTickAt = Date.now();
    try {
      await this.watchdog();
      await this.syncDelegated();
      for (let guard = 0; guard < 500; guard++) {
        const job = await this.prisma.aiJob.findFirst({ where: { status: { in: ['PENDING', 'RUNNING'] }, type: { not: 'PYQ_DATE_SHIFT' } }, orderBy: { createdAt: 'asc' } });
        if (!job) break;
        const r = await this.runJob(job.id);
        if (r === 'rest') break;
      }
    } catch (e) {
      this.lastMessage = `worker error: ${redact((e as Error).message).slice(0, 200)}`;
      this.logger.warn(this.lastMessage);
    } finally {
      this.busy = false;
      this.busySince = 0;
      if (this.wakeAgain) {
        this.wakeAgain = false;
        setTimeout(() => void this.tick(), 50);
      }
    }
  }

  /**
   * Watchdog (A2): every ~60 s. Items RUNNING for > 12 min (lost promise / crashed call) go back to PENDING (or FAILED after 3 attempts);
   * a RUNNING job with no unfinished items is finalised. Never touches PYQ_DATE_SHIFT (its own worker owns those).
   */
  async watchdog(force = false): Promise<{ requeued: number; failed: number; finalized: number }> {
    const out = { requeued: 0, failed: 0, finalized: 0 };
    const now = Date.now();
    if (!force && now - this.lastWatchdogAt < WATCHDOG_EVERY_MS) return out;
    this.lastWatchdogAt = now;
    try {
      const live = new Set(Array.from(this.current.values()).map((c) => c.itemId));
      const old = await this.prisma.aiJobItem.findMany({ where: { status: 'RUNNING', startedAt: { lt: new Date(now - STUCK_ITEM_MS) }, job: { type: { not: 'PYQ_DATE_SHIFT' } } }, select: { id: true, jobId: true, status: true, startedAt: true, attempts: true }, take: 200 });
      for (const it of old) {
        if (live.has(it.id) || !isStuck({ status: it.status, startedAtMs: it.startedAt?.getTime() ?? null, nowMs: now, maxMs: STUCK_ITEM_MS })) continue;
        const retry = it.attempts < 3;
        const r = await this.prisma.aiJobItem.updateMany({ where: { id: it.id, status: 'RUNNING' }, data: retry ? { status: 'PENDING', lastError: 'watchdog: item atak gaya tha, dobara line me' } : { status: 'FAILED', finishedAt: new Date(), lastError: 'watchdog: baar baar atak gaya', note: 'baar baar atak gaya' } });
        if (r.count) {
          if (retry) out.requeued++;
          else out.failed++;
        }
      }
      const jobs = await this.prisma.aiJob.findMany({ where: { status: 'RUNNING', type: { not: 'PYQ_DATE_SHIFT' } }, select: { id: true }, take: 50 });
      for (const j of jobs) {
        const open = await this.prisma.aiJobItem.count({ where: { jobId: j.id, status: { in: ['PENDING', 'RUNNING'] } } });
        if (open === 0) {
          await this.finalizeJob(j.id);
          out.finalized++;
        }
      }
      this.watchdogFixed += out.requeued + out.failed + out.finalized;
      if (out.requeued || out.failed || out.finalized) this.logger.warn(`AI watchdog: ${out.requeued} item requeued, ${out.failed} failed, ${out.finalized} job finalised`);
    } catch (e) {
      this.logger.warn(`AI watchdog failed: ${redact((e as Error).message)}`);
    }
    return out;
  }

  /** works on ONE job until it is finished, paused, cancelled or the keys are busy */
  private async runJob(jobId: string): Promise<'done' | 'rest'> {
    let job = await this.prisma.aiJob.findUnique({ where: { id: jobId } });
    if (!job || !['PENDING', 'RUNNING'].includes(job.status)) return 'done';
    if (job.status === 'PENDING') job = await this.prisma.aiJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: job.startedAt ?? new Date() } });
    const type = job.type as JobType;

    for (let round = 0; round < 100000; round++) {
      const fresh = await this.prisma.aiJob.findUnique({ where: { id: jobId }, select: { status: true } });
      if (!fresh || fresh.status !== 'RUNNING') return 'done'; // paused / cancelled while we were working

      const avail = await this.ai.keyAvailability();
      const gw = !!this.ai.gatewayConfig();
      if (avail.active === 0 && !gw) {
        await this.rest(jobId, 'Koi AI key active nahi — Admin → API Keys me key daalein / ON karein (key aate hi job turant chalu ho jayega).', 60_000);
        return 'rest';
      }
      if (avail.ready === 0 && !gw) {
        await this.rest(jobId, `Sabhi keys rate-limit par rest kar rahi hain (~${avail.minRestSec}s) — job khud dobara chalega.`, Math.min(60, Math.max(10, avail.minRestSec)) * 1000);
        return 'rest';
      }

      const concurrency = pacedConcurrency(CLAIM_MAX, avail.ready, gw);
      const candidates = await this.prisma.aiJobItem.findMany({ where: { jobId, status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: concurrency, select: { id: true } });
      const claimed: string[] = [];
      for (const c of candidates) {
        // atomic claim: two workers / a double kick can never take the same item
        const r = await this.prisma.aiJobItem.updateMany({ where: { id: c.id, status: 'PENDING' }, data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } } });
        if (r.count === 1) claimed.push(c.id);
      }
      if (claimed.length === 0) {
        const running = await this.prisma.aiJobItem.count({ where: { jobId, status: 'RUNNING' } });
        if (running === 0) {
          await this.finalizeJob(jobId);
          return 'done';
        }
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      const results = await Promise.all(claimed.map((id) => this.processItem(job!.id, type, id, job!.passes, job!.minAgree)));
      await this.recount(jobId);
      if (results.includes('busy')) {
        await this.rest(jobId, 'AI keys busy hain — thodi der rest ke baad job khud dobara chalega.', BUSY_REST_MS);
        return 'rest';
      }
      await this.prisma.aiJob.update({ where: { id: jobId }, data: { lastError: null } }).catch(() => undefined);
    }
    return 'done';
  }

  private async rest(jobId: string, message: string, ms: number) {
    this.pausedUntil = Date.now() + ms;
    this.lastMessage = message;
    await this.prisma.aiJob.update({ where: { id: jobId }, data: { lastError: message } }).catch(() => undefined);
  }

  // ------------------------------------------------------------------ one item

  private async chaptersOf(subjectId: string): Promise<TaxonomyChapter[]> {
    const hit = this.taxonomyCache.get(subjectId);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.chapters;
    const rows = await this.prisma.chapter.findMany({ where: { subjectId }, orderBy: { name: 'asc' }, select: { id: true, name: true, topics: { orderBy: { name: 'asc' }, select: { id: true, name: true } } } });
    this.taxonomyCache.set(subjectId, { at: Date.now(), chapters: rows });
    return rows;
  }

  private parseOptions(raw: unknown): QuestionCtx['options'] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
      .map((o, i) => ({ key: String(o.key ?? ['A', 'B', 'C', 'D'][i] ?? i + 1), text: String(o.text ?? ''), textHi: typeof o.textHi === 'string' ? o.textHi : undefined }));
  }

  private async processItem(jobId: string, type: JobType, itemId: string, passes: number, minAgree: number): Promise<'ok' | 'busy'> {
    const item = await this.prisma.aiJobItem.findUnique({ where: { id: itemId } });
    if (!item) return 'ok';
    const models: string[] = [];
    try {
      const q = await this.prisma.question.findUnique({
        where: { id: item.questionId },
        select: {
          id: true, questionNo: true, questionText: true, questionTextHindi: true, optionsJson: true, correctAnswer: true, explanation: true, explanationHindi: true,
          subjectId: true, chapterId: true, topicId: true, subject: { select: { name: true, slug: true } }, chapter: { select: { name: true } },
        },
      });
      if (!q) {
        await this.finishItem(itemId, 'SKIPPED', 'question ab maujood nahi', null, [], 0);
        return 'ok';
      }
      const ctx: QuestionCtx = {
        id: q.id,
        questionNo: q.questionNo,
        questionText: q.questionText,
        questionTextHindi: q.questionTextHindi,
        options: this.parseOptions(q.optionsJson),
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        explanationHindi: q.explanationHindi,
        subjectName: q.subject?.name ?? 'SSC',
        chapterId: q.chapterId,
        chapterName: q.chapter?.name ?? null,
        topicId: q.topicId,
        hindiExempt: isHindiExemptSubjectSlug(q.subject?.slug),
        chapters: type === 'CHAPTER_TOPIC_CLASSIFY' ? await this.chaptersOf(q.subjectId) : undefined,
      };
      const key = `${itemId}`;
      const setStage = (stage: string, pass: number, total: number) => this.current.set(key, { jobId, itemId, questionNo: q.questionNo, stage, pass, passes: total, startedAt: this.current.get(key)?.startedAt ?? Date.now() });
      setStage('start', 0, passes);

      const result = await runItem(
        type,
        ctx,
        async (prompt, o) => {
          try {
            const r = await this.ai.generate(prompt, { jsonResponse: true, maxTokens: o.maxTokens, feature: JOB_FEATURE[type], modelOffset: o.passIndex + item.attempts, note: `Q#${q.questionNo} · ${o.stage} ${o.passIndex + 1}/${passes}` });
            models.push(r.model);
            this.callCounter.set(jobId, (this.callCounter.get(jobId) ?? 0) + 1);
            return r.content;
          } catch (e) {
            this.callCounter.set(jobId, (this.callCounter.get(jobId) ?? 0) + 1);
            if (e instanceof ServiceUnavailableException) throw new ProviderBusyError(e.message);
            throw e;
          }
        },
        { passes, minAgree, onStage: setStage, isCancelled: () => this.cancelled.has(jobId) },
      );
      this.current.delete(key);
      if (this.cancelled.has(jobId)) {
        await this.prisma.aiJobItem.updateMany({ where: { id: itemId, status: 'RUNNING' }, data: { status: 'SKIPPED', note: 'job cancel hua' } });
        return 'ok';
      }
      await this.settle(jobId, type, itemId, ctx.id, result, models[0] ?? null);
      return 'ok';
    } catch (e) {
      this.current.delete(itemId);
      if (e instanceof ProviderBusyError) {
        await this.prisma.aiJobItem.updateMany({ where: { id: itemId, status: 'RUNNING' }, data: { status: 'PENDING', attempts: { decrement: 1 } } });
        return 'busy';
      }
      const msg = redact((e as Error)?.message || 'error').slice(0, 300);
      const retry = item.attempts < 3;
      await this.prisma.aiJobItem.updateMany({ where: { id: itemId, status: 'RUNNING' }, data: retry ? { status: 'PENDING', lastError: msg } : { status: 'FAILED', lastError: msg, finishedAt: new Date(), note: 'baar baar error aaya' } });
      this.logger.warn(`AI job item ${itemId} failed: ${msg}`);
      return 'ok';
    }
  }

  private async finishItem(itemId: string, status: string, note: string, proposal: Record<string, unknown> | null, passes: unknown[], agree: number, appliedAt?: Date) {
    await this.prisma.aiJobItem.updateMany({
      where: { id: itemId, status: 'RUNNING' },
      data: {
        status,
        note,
        proposalJson: (proposal ?? Prisma.DbNull) as Prisma.InputJsonValue,
        passesJson: passes as unknown as Prisma.InputJsonValue,
        passesDone: passes.length,
        agreeCount: agree,
        finishedAt: new Date(),
        lastError: null,
        ...(appliedAt ? { appliedAt } : {}),
      },
    });
  }

  /** the result of the passes becomes either a DB write (with undo log), a review entry, or a final status */
  private async settle(jobId: string, type: JobType, itemId: string, questionId: string, r0: RunResult, model: string | null) {
    const r: RunResult = r0.confidence !== undefined ? { ...r0, note: `${r0.note} · confidence ${Math.round(r0.confidence * 100)}%` } : r0;
    if (r.status !== 'DONE' || !r.proposal) {
      await this.finishItem(itemId, r.status, r.note, r.proposal, r.passes, r.agree);
      return;
    }
    const job = await this.prisma.aiJob.findUnique({ where: { id: jobId }, select: { createdBy: true } });
    const ap = await this.applyProposal({ jobId, itemId, questionId, model, appliedBy: job?.createdBy ?? null }, type, r.proposal);
    if (ap.kind === 'conflict') await this.finishItem(itemId, 'NEEDS_REVIEW', `${ap.reason} — AI value review ke liye rakhi hai`, r.proposal, r.passes, r.agree);
    else if (ap.kind === 'nothing') await this.finishItem(itemId, 'SKIPPED', ap.reason, r.proposal, r.passes, r.agree);
    else await this.finishItem(itemId, 'DONE', `${r.note} · ${ap.fields.join(', ')} likha (Undo possible)`, r.proposal, r.passes, r.agree, new Date());
  }

  // ------------------------------------------------------------------ writing to Question (+ undo log)

  /** builds the field changes of a proposal against the CURRENT question; admin-entered values are never overwritten */
  private planWrite(type: JobType, proposal: Record<string, unknown>, cur: Record<string, unknown>, model: string | null): { next: Record<string, unknown> } | { conflict: string } | { nothing: string } {
    const next: Record<string, unknown> = {};
    const kind = String(proposal.kind ?? '');
    if (kind === 'ANSWER_CHANGE' || kind === 'ANSWER_CONFLICT') {
      const from = String(proposal.from ?? proposal.storedAnswer ?? '');
      const to = String(proposal.to ?? proposal.aiAnswer ?? '');
      if (!/^[A-D]$/.test(to)) return { nothing: 'proposal me valid answer nahi' };
      if (String(cur.correctAnswer) !== from) return { conflict: `answer key beech me badal gayi (ab ${cur.correctAnswer})` };
      next.correctAnswer = to;
      return { next };
    }
    if (kind === 'CLASSIFY_CHANGE') {
      next.chapterId = proposal.chapterId;
      next.topicId = (proposal.topicId as string | null) ?? null; // an old topic belongs to the OLD chapter
      next.subTopicId = null;
      return { next };
    }
    if (type === 'SOLUTION_GENERATE') {
      if (!isEmptyText(cur.explanation)) return { conflict: 'admin ne beech me solution daal diya' };
      next.explanation = proposal.explanation;
      next.explanationSource = 'AI_GENERATED';
      next.explanationModel = model;
      next.explanationGeneratedAt = new Date().toISOString();
      if (!isEmptyText(proposal.explanationHindi) && isEmptyText(cur.explanationHindi)) next.explanationHindi = proposal.explanationHindi;
      return { next };
    }
    if (type === 'HINDI_TRANSLATE') {
      if (!isEmptyText(proposal.questionTextHindi) && isEmptyText(cur.questionTextHindi)) next.questionTextHindi = proposal.questionTextHindi;
      const opts = Array.isArray(cur.optionsJson) ? (cur.optionsJson as Array<Record<string, unknown>>) : [];
      const hi = Array.isArray(proposal.optionsHi) ? (proposal.optionsHi as string[]) : null;
      if (hi && hi.length === opts.length) {
        let changed = false;
        const merged = opts.map((o, i) => {
          if (isEmptyText(o.textHi) && !isEmptyText(hi[i])) {
            changed = true;
            return { ...o, textHi: hi[i] };
          }
          return o;
        });
        if (changed) next.optionsJson = merged;
      }
      if (!isEmptyText(proposal.explanationHindi) && isEmptyText(cur.explanationHindi)) next.explanationHindi = proposal.explanationHindi;
      if (Object.keys(next).length === 0) return { nothing: 'Hindi pehle se bhar di gayi thi (admin ki value safe)' };
      next.translationStatus = 'AUTO_UNVERIFIED';
      return { next };
    }
    if (type === 'ANSWER_KEY_VERIFY') {
      if (!isEmptyText(cur.verificationEvidence)) return { nothing: 'answer key sahi; pehle se evidence note maujood hai (badla nahi)' };
      next.verificationEvidence = `AI answer-key check: ${proposal.agree}/${proposal.of} independent pass ne ${proposal.answer} diya (${new Date().toISOString().slice(0, 10)})`;
      return { next };
    }
    return { nothing: 'is proposal me DB me likhne layak kuch nahi' };
  }

  private async applyProposal(
    ctx: { jobId: string | null; itemId: string | null; questionId: string; model: string | null; appliedBy: string | null },
    type: JobType,
    proposal: Record<string, unknown>,
  ): Promise<{ kind: 'written'; fields: string[] } | { kind: 'conflict'; reason: string } | { kind: 'nothing'; reason: string }> {
    return this.prisma.$transaction(async (tx) => {
      const cur = (await tx.question.findUnique({
        where: { id: ctx.questionId },
        select: { correctAnswer: true, explanation: true, explanationHindi: true, questionTextHindi: true, optionsJson: true, verificationEvidence: true, chapterId: true, subject: { select: { id: true } } },
      })) as Record<string, unknown> | null;
      if (!cur) return { kind: 'nothing' as const, reason: 'question ab maujood nahi' };
      if (proposal.kind === 'CLASSIFY_CHANGE') {
        const ch = await tx.chapter.findUnique({ where: { id: String(proposal.chapterId) }, select: { subjectId: true } });
        if (!ch || ch.subjectId !== (cur.subject as { id: string }).id) return { kind: 'conflict' as const, reason: 'suggested chapter is subject ka nahi' };
      }
      const plan = this.planWrite(type, proposal, cur, ctx.model);
      if ('conflict' in plan) return { kind: 'conflict' as const, reason: plan.conflict };
      if ('nothing' in plan) return { kind: 'nothing' as const, reason: plan.nothing };
      const old = await tx.question.findUnique({ where: { id: ctx.questionId }, select: Object.fromEntries(Object.keys(plan.next).map((k) => [k, true])) as Prisma.QuestionSelect });
      const oldRec = (old ?? {}) as Record<string, unknown>;
      const rows: Prisma.AiChangeCreateManyInput[] = [];
      const data: Record<string, unknown> = {};
      for (const [field, val] of Object.entries(plan.next)) {
        if (!UNDOABLE[field]) throw new BadRequestException(`field ${field} AI se nahi badla ja sakta`);
        if (canon(oldRec[field]) === canon(val)) continue;
        rows.push({ jobId: ctx.jobId, itemId: ctx.itemId, questionId: ctx.questionId, field, oldValue: { v: (oldRec[field] instanceof Date ? (oldRec[field] as Date).toISOString() : oldRec[field] ?? null) } as Prisma.InputJsonValue, newValue: { v: val ?? null } as Prisma.InputJsonValue, source: 'AI_JOB', model: ctx.model, appliedBy: ctx.appliedBy });
        data[field] = toDb(field, val);
      }
      if (rows.length === 0) return { kind: 'nothing' as const, reason: 'value pehle se wahi thi' };
      await tx.aiChange.createMany({ data: rows });
      await tx.question.update({ where: { id: ctx.questionId }, data: data as Prisma.QuestionUncheckedUpdateInput });
      return { kind: 'written' as const, fields: rows.map((r) => r.field) };
    });
  }

  // ------------------------------------------------------------------ counters / finish

  async recount(jobId: string): Promise<Record<string, number>> {
    const g = await this.prisma.aiJobItem.groupBy({ by: ['status'], where: { jobId }, _count: { _all: true } });
    const c: Record<string, number> = {};
    for (const r of g) c[r.status] = r._count._all;
    const calls = this.callCounter.get(jobId) ?? 0;
    this.callCounter.delete(jobId);
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    await this.prisma.aiJob.update({
      where: { id: jobId },
      data: {
        totalCount: total,
        doneCount: (c.DONE ?? 0) + (c.ACCEPTED ?? 0) + (c.REJECTED ?? 0) + (c.SKIPPED ?? 0),
        failedCount: c.FAILED ?? 0,
        reviewCount: c.NEEDS_REVIEW ?? 0,
        ...(calls ? { callsMade: { increment: calls } } : {}),
      },
    });
    const out: Record<string, number> = { ...c, total, pending: (c.PENDING ?? 0) + (c.RUNNING ?? 0) };
    return out;
  }

  private async finalizeJob(jobId: string) {
    const c = await this.recount(jobId);
    const allFailed = c.total > 0 && (c.FAILED ?? 0) === c.total;
    await this.prisma.aiJob.update({ where: { id: jobId }, data: { status: allFailed ? 'FAILED' : 'DONE', finishedAt: new Date(), lastError: allFailed ? 'sabhi items fail hue — System Check chalayein' : null } });
    this.lastMessage = `Job ${jobId.slice(0, 8)} khatam: ${c.DONE ?? 0} done, ${c.NEEDS_REVIEW ?? 0} review, ${c.FAILED ?? 0} failed`;
  }

  // ------------------------------------------------------------------ PYQ_DATE_SHIFT: tracked here, worked by the existing PyqDateService
  // (its behaviour is untouched; the job only mirrors the status of its PyqDateMap rows)

  private async syncDelegated() {
    const jobs = await this.prisma.aiJob.findMany({ where: { type: 'PYQ_DATE_SHIFT', status: { in: ['PENDING', 'RUNNING'] } }, select: { id: true } });
    for (const j of jobs) await this.syncOne(j.id);
  }

  private async syncOne(jobId: string) {
    const items = await this.prisma.aiJobItem.findMany({ where: { jobId, status: { in: ['PENDING', 'RUNNING'] } }, select: { id: true, questionId: true }, take: 3000 });
    if (items.length) {
      const maps = await this.prisma.pyqDateMap.findMany({ where: { questionId: { in: items.map((i) => i.questionId) } }, select: { questionId: true, status: true, proposedDate: true, agreeCount: true, passesDone: true, note: true, passesJson: true } });
      const byQ = new Map(maps.map((m) => [m.questionId, m]));
      for (const it of items) {
        const m = byQ.get(it.questionId);
        if (!m) continue;
        const map: Record<string, string> = { MAPPED: 'DONE', MANUAL: 'DONE', NEEDS_REVIEW: 'NEEDS_REVIEW', NOT_FOUND: 'FAILED', FAILED: 'FAILED', RUNNING: 'RUNNING', PENDING: 'PENDING' };
        const status = map[m.status] ?? 'PENDING';
        await this.prisma.aiJobItem.updateMany({
          where: { id: it.id, status: { in: ['PENDING', 'RUNNING'] } },
          data: { status, note: m.note ?? null, agreeCount: m.agreeCount, passesDone: m.passesDone, proposalJson: m.proposedDate ? ({ kind: 'PYQ_DATE', proposedDate: m.proposedDate } as Prisma.InputJsonValue) : Prisma.DbNull, passesJson: (m.passesJson ?? Prisma.DbNull) as Prisma.InputJsonValue, ...(status === 'DONE' || status === 'FAILED' || status === 'NEEDS_REVIEW' ? { finishedAt: new Date() } : {}) },
        });
      }
    }
    const c = await this.recount(jobId);
    if (c.pending === 0) await this.finalizeJob(jobId);
    else if ((c.RUNNING ?? 0) > 0 || c.pending < c.total) await this.prisma.aiJob.updateMany({ where: { id: jobId, status: 'PENDING' }, data: { status: 'RUNNING', startedAt: new Date() } });
  }

  // ------------------------------------------------------------------ scope / estimate / create

  private buildWhere(type: JobType, s: JobScopeDto): Prisma.QuestionWhereInput {
    const and: Prisma.QuestionWhereInput[] = [];
    if (s.examId) and.push({ examId: s.examId });
    if (s.subjectId) and.push({ subjectId: s.subjectId });
    if (s.chapterId) and.push({ chapterId: s.chapterId });
    if (typeof s.year === 'number' && Number.isFinite(s.year)) and.push({ year: s.year });
    if (s.batchId) and.push({ uploadBatchId: s.batchId });
    if (s.ids?.length) and.push({ id: { in: s.ids.filter((x) => typeof x === 'string').slice(0, 5000) } });
    const empty = (f: 'explanation' | 'explanationHindi' | 'questionTextHindi'): Prisma.QuestionWhereInput => ({ OR: [{ [f]: null }, { [f]: '' }] } as Prisma.QuestionWhereInput);
    switch (type) {
      case 'SOLUTION_GENERATE':
        and.push(empty('explanation'));
        break;
      case 'HINDI_TRANSLATE':
        and.push({ subject: { NOT: { OR: [{ slug: 'english' }, { slug: 'sub-english' }, { slug: { startsWith: 'english-' } }, { slug: { startsWith: 'english_' } }] } } });
        and.push({ OR: [empty('questionTextHindi'), { AND: [{ NOT: { OR: [{ explanation: null }, { explanation: '' }] } }, empty('explanationHindi')] }] });
        break;
      case 'CHAPTER_TOPIC_CLASSIFY':
        if (!s.recheckAll) and.push({ OR: [{ chapterId: null }, { topicId: null }] });
        break;
      case 'ANSWER_KEY_VERIFY':
        if (!s.recheckAll) and.push({ answerVerificationStatus: { notIn: ['VERIFIED_OFFICIAL', 'VERIFIED_MULTI_SOURCE', 'VERIFIED_COMPUTED'] } });
        break;
      case 'PYQ_DATE_SHIFT':
        and.push({ year: { not: null } });
        if (!s.verifyExisting) and.push({ OR: [{ examDate: null }, { examDate: '' }] });
        break;
    }
    return and.length ? { AND: and } : {};
  }

  async estimate(dto: { type: string; scope?: JobScopeDto; passes?: number }) {
    if (!isJobType(dto.type)) throw new BadRequestException(`type ye me se ek ho: ${JOB_TYPES.join(', ')}`);
    const type = dto.type;
    const scope = dto.scope ?? {};
    const questions = await this.prisma.question.count({ where: this.buildWhere(type, scope) });
    const cap = Math.min(Math.max(1, scope.limit ?? 20000), 50000);
    const n = Math.min(questions, cap);
    const passes = this.passesFor(dto.passes);
    const av = await this.ai.keyAvailability();
    const concurrency = Math.max(1, Math.min(CLAIM_MAX, av.ready || (this.ai.gatewayConfig() ? CLAIM_MAX : 1)));
    const recent = await this.prisma.aiUsageLog.aggregate({ where: { feature: JOB_FEATURE[type], success: true, latencyMs: { not: null }, createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } }, _avg: { latencyMs: true }, _count: { _all: true } });
    const avgSecPerCall = recent._avg.latencyMs && recent._count._all >= 5 ? Math.round(recent._avg.latencyMs / 100) / 10 : 8;
    let calls = estimateCalls(n, passes, type);
    let etaSec: number | null;
    let note = 'Worst case (sab passes chalein). 3 pass agree hote hi baaki passes ruk jate hain, isliye asli calls ~20-40% kam hongi.';
    if (type === 'PYQ_DATE_SHIFT') {
      const cfg = await this.pyq.getConfig();
      calls = n * cfg.passes;
      etaSec = Math.ceil(n * 45);
      note = `Is job ko purana PYQ date worker chalata hai (har question: ${cfg.passes} web-search + AI pass, ~45 s/question; settings alag hain).`;
    } else {
      etaSec = etaSeconds(n, passes * avgSecPerCall * 0.7, concurrency);
    }
    return { type, label: JOB_LABEL[type], questions, willProcess: n, passes, minAgree: minAgreeFor(passes), calls, avgSecPerCall, concurrency, etaSec, keys: av, gateway: !!this.ai.gatewayConfig(), note };
  }

  private passesFor(p?: number): number {
    const n = Math.round(Number(p ?? 5));
    return Number.isFinite(n) ? Math.min(5, Math.max(3, n)) : 5;
  }

  async createJob(dto: { type: string; scope?: JobScopeDto; passes?: number; title?: string }, userId: string | null) {
    if (!isJobType(dto.type)) throw new BadRequestException(`type ye me se ek ho: ${JOB_TYPES.join(', ')}`);
    const type = dto.type;
    const scope: JobScopeDto = { ...(dto.scope ?? {}) };
    const hasScope = !!(scope.examId || scope.subjectId || scope.chapterId || scope.year || scope.batchId || scope.ids?.length);
    if (!hasScope) throw new BadRequestException('Scope chunein (exam / subject / chapter / year / batch / selected questions) — poori bank ek saath nahi.');
    const passes = this.passesFor(dto.passes);

    // double click / two admins at once: the same job (same type + scope) created in the last 30 s is returned, not duplicated
    const dupe = await this.prisma.aiJob.findFirst({ where: { type, status: { in: ['PENDING', 'RUNNING'] }, createdAt: { gte: new Date(Date.now() - 30_000) } }, orderBy: { createdAt: 'desc' } });
    if (dupe && canon(dupe.scopeJson) === canon(scope)) return { job: dupe, duplicate: true };

    const cap = Math.min(Math.max(1, scope.limit ?? 20000), 50000);
    const rows = await this.prisma.question.findMany({ where: this.buildWhere(type, scope), select: { id: true, questionNo: true }, orderBy: { questionNo: 'asc' }, take: cap });
    if (!rows.length) throw new BadRequestException('Is scope me is kaam ke layak koi question nahi mila.');
    const cfgPasses = type === 'PYQ_DATE_SHIFT' ? (await this.pyq.getConfig()).passes : passes;
    const job = await this.prisma.aiJob.create({
      data: {
        type,
        title: (dto.title || `${JOB_LABEL[type]} · ${rows.length} questions`).slice(0, 120),
        scopeJson: scope as unknown as Prisma.InputJsonValue,
        status: 'PENDING',
        passes: cfgPasses,
        minAgree: minAgreeFor(cfgPasses),
        totalCount: rows.length,
        createdBy: userId,
      },
    });
    for (let i = 0; i < rows.length; i += 2000) {
      await this.prisma.aiJobItem.createMany({ data: rows.slice(i, i + 2000).map((r) => ({ jobId: job.id, questionId: r.id, questionNo: r.questionNo })), skipDuplicates: true });
    }
    if (type === 'PYQ_DATE_SHIFT') {
      for (let i = 0; i < rows.length; i += 2000) await this.pyq.enqueue({ scope: 'ids', ids: rows.slice(i, i + 2000).map((r) => r.id), verifyExisting: !!scope.verifyExisting });
      await this.pyq.wake();
      await this.syncOne(job.id);
    } else {
      void this.wake();
    }
    return { job: await this.prisma.aiJob.findUnique({ where: { id: job.id } }), duplicate: false };
  }

  // ------------------------------------------------------------------ pause / resume / cancel / retry

  private async mustJob(id: string) {
    const j = await this.prisma.aiJob.findUnique({ where: { id } });
    if (!j) throw new NotFoundException('Job nahi mila.');
    return j;
  }

  async pause(id: string) {
    const j = await this.mustJob(id);
    if (j.type === 'PYQ_DATE_SHIFT') throw new BadRequestException('PYQ date job ko pause karne ke liye Admin → PYQ Date Mapping me "auto run" band karein.');
    if (!['PENDING', 'RUNNING'].includes(j.status)) throw new BadRequestException(`Job ${j.status} hai, pause nahi ho sakta.`);
    await this.prisma.aiJob.update({ where: { id }, data: { status: 'PAUSED' } });
    return { ok: true };
  }

  async resume(id: string) {
    const j = await this.mustJob(id);
    if (j.status !== 'PAUSED') throw new BadRequestException('Sirf PAUSED job resume hota hai.');
    this.cancelled.delete(id);
    await this.prisma.aiJob.update({ where: { id }, data: { status: 'PENDING', lastError: null } });
    void this.wake();
    return { ok: true };
  }

  async cancel(id: string) {
    const j = await this.mustJob(id);
    if (['DONE', 'FAILED', 'CANCELLED'].includes(j.status)) throw new BadRequestException(`Job pehle se ${j.status} hai.`);
    this.cancelled.add(id);
    await this.prisma.aiJob.update({ where: { id }, data: { status: 'CANCELLED', finishedAt: new Date() } });
    await this.prisma.aiJobItem.updateMany({ where: { jobId: id, status: 'PENDING' }, data: { status: 'SKIPPED', note: 'job cancel hua' } });
    await this.recount(id);
    return { ok: true, note: j.type === 'PYQ_DATE_SHIFT' ? 'PYQ worker ki apni queue alag hai: jo questions wahan pehle se line me hain woh chalte rahenge.' : undefined };
  }

  async retryFailed(id: string) {
    const j = await this.mustJob(id);
    if (j.type === 'PYQ_DATE_SHIFT') {
      const items = await this.prisma.aiJobItem.findMany({ where: { jobId: id, status: 'FAILED' }, select: { questionId: true }, take: 2000 });
      if (items.length) await this.pyq.enqueue({ scope: 'ids', ids: items.map((x) => x.questionId) });
    }
    const r = await this.prisma.aiJobItem.updateMany({ where: { jobId: id, status: 'FAILED' }, data: { status: 'PENDING', attempts: 0, lastError: null, note: null } });
    if (r.count) {
      await this.prisma.aiJob.update({ where: { id }, data: { status: 'PENDING', finishedAt: null, lastError: null } });
      this.cancelled.delete(id);
      void this.wake();
    }
    await this.recount(id);
    return { requeued: r.count };
  }

  // ------------------------------------------------------------------ review (accept / reject)

  async acceptItem(itemId: string, adminId: string): Promise<{ ok: boolean; message?: string }> {
    const item = await this.prisma.aiJobItem.findUnique({ where: { id: itemId }, include: { job: { select: { id: true, type: true } } } });
    if (!item) throw new NotFoundException('Item nahi mila.');
    const type = item.job.type as JobType;
    const proposal = (item.proposalJson ?? null) as Record<string, unknown> | null;
    if (type === 'PYQ_DATE_SHIFT') {
      const claim = await this.prisma.aiJobItem.updateMany({ where: { id: itemId, status: 'NEEDS_REVIEW' }, data: { status: 'ACCEPTED', appliedAt: new Date() } });
      if (claim.count !== 1) return { ok: false, message: 'Ye item pehle hi handle ho chuka hai.' };
      try {
        await this.pyq.acceptProposed(item.questionId);
      } catch (e) {
        await this.prisma.aiJobItem.updateMany({ where: { id: itemId, status: 'ACCEPTED' }, data: { status: 'NEEDS_REVIEW', appliedAt: null } });
        throw e;
      }
      await this.recount(item.jobId);
      return { ok: true };
    }
    if (!proposal || proposal.kind === 'PASSES_DISAGREE') return { ok: false, message: 'Is item me apply karne layak AI value nahi hai (passes agree nahi hue) — question manually dekhein ya Reject karein.' };
    // atomic claim: a double click / two admins apply ONCE
    const claim = await this.prisma.aiJobItem.updateMany({ where: { id: itemId, status: 'NEEDS_REVIEW' }, data: { status: 'ACCEPTED', appliedAt: new Date() } });
    if (claim.count !== 1) return { ok: false, message: 'Ye item pehle hi handle ho chuka hai.' };
    const ap = await this.applyProposal({ jobId: item.jobId, itemId, questionId: item.questionId, model: null, appliedBy: adminId }, type, proposal);
    if (ap.kind !== 'written') {
      await this.prisma.aiJobItem.updateMany({ where: { id: itemId, status: 'ACCEPTED' }, data: { status: 'NEEDS_REVIEW', appliedAt: null } });
      return { ok: false, message: ap.reason };
    }
    await this.recount(item.jobId);
    return { ok: true };
  }

  async rejectItem(itemId: string): Promise<{ ok: boolean; message?: string }> {
    const item = await this.prisma.aiJobItem.findUnique({ where: { id: itemId }, include: { job: { select: { type: true } } } });
    if (!item) throw new NotFoundException('Item nahi mila.');
    const r = await this.prisma.aiJobItem.updateMany({ where: { id: itemId, status: 'NEEDS_REVIEW' }, data: { status: 'REJECTED', note: 'admin ne reject kiya' } });
    if (r.count !== 1) return { ok: false, message: 'Ye item pehle hi handle ho chuka hai.' };
    if (item.job.type === 'PYQ_DATE_SHIFT') await this.pyq.reject(item.questionId).catch(() => undefined);
    await this.recount(item.jobId);
    return { ok: true };
  }

  /** "select all across pages": every NEEDS_REVIEW item of the job (optionally only these item ids) */
  async bulkReview(jobId: string, action: 'accept' | 'reject', adminId: string, itemIds?: string[]) {
    await this.mustJob(jobId);
    const items = await this.prisma.aiJobItem.findMany({
      where: { jobId, status: 'NEEDS_REVIEW', ...(itemIds?.length ? { id: { in: itemIds.slice(0, 5000) } } : {}) },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 600, // one call never runs longer than a request can; the screen simply repeats while `remaining` > 0
    });
    let ok = 0;
    const problems: string[] = [];
    for (const it of items) {
      try {
        const r = action === 'accept' ? await this.acceptItem(it.id, adminId) : await this.rejectItem(it.id);
        if (r.ok) ok++;
        else if (r.message && problems.length < 5) problems.push(r.message);
      } catch (e) {
        if (problems.length < 5) problems.push((e as Error).message);
      }
    }
    const remaining = await this.prisma.aiJobItem.count({ where: { jobId, status: 'NEEDS_REVIEW' } });
    return { processed: items.length, ok, failed: items.length - ok, remaining, problems };
  }

  // ------------------------------------------------------------------ UNDO

  async undo(dto: { changeIds?: string[]; itemIds?: string[]; jobId?: string }, adminId: string) {
    const or: Prisma.AiChangeWhereInput[] = [];
    if (dto.changeIds?.length) or.push({ id: { in: dto.changeIds.slice(0, 5000) } });
    if (dto.itemIds?.length) or.push({ itemId: { in: dto.itemIds.slice(0, 5000) } });
    if (dto.jobId) or.push({ jobId: dto.jobId });
    if (!or.length) throw new BadRequestException('changeIds, itemIds ya jobId do.');
    const where: Prisma.AiChangeWhereInput = { undoneAt: null, OR: or };
    const rows = await this.prisma.aiChange.findMany({ where, orderBy: { createdAt: 'desc' }, take: UNDO_CHUNK });
    let undone = 0;
    const skipped: Array<{ questionId: string; field: string; reason: string }> = [];
    const touchedItems = new Set<string>();
    const touchedJobs = new Set<string>();
    for (const ch of rows) {
      const kind = UNDOABLE[ch.field];
      if (!kind) {
        skipped.push({ questionId: ch.questionId, field: ch.field, reason: 'field undo-able nahi' });
        continue;
      }
      try {
        const res = await this.prisma.$transaction(async (tx) => {
          const q = (await tx.question.findUnique({ where: { id: ch.questionId }, select: { [ch.field]: true } as Prisma.QuestionSelect })) as Record<string, unknown> | null;
          if (!q) return 'question nahi mila';
          const want = (ch.newValue as { v?: unknown } | null)?.v ?? null;
          if (canon(q[ch.field]) !== canon(want)) return 'value baad me badal chuki hai (kisi ne edit kiya) — undo nahi kiya';
          const old = (ch.oldValue as { v?: unknown } | null)?.v ?? null;
          await tx.question.update({ where: { id: ch.questionId }, data: { [ch.field]: toDb(ch.field, old) } as Prisma.QuestionUncheckedUpdateInput });
          const mark = await tx.aiChange.updateMany({ where: { id: ch.id, undoneAt: null }, data: { undoneAt: new Date(), undoneBy: adminId } });
          if (mark.count !== 1) throw new Error('already undone'); // concurrent undo: roll this row back, count nothing
          if (ch.source === 'PYQ_DATE' && ch.field === 'examDate') await tx.pyqDateMap.updateMany({ where: { questionId: ch.questionId, status: 'MAPPED' }, data: { status: 'NEEDS_REVIEW', appliedAt: null, note: 'Admin ne AI date Undo ki.' } });
          return null;
        });
        if (res) skipped.push({ questionId: ch.questionId, field: ch.field, reason: res });
        else {
          undone++;
          if (ch.itemId) touchedItems.add(ch.itemId);
          if (ch.jobId) touchedJobs.add(ch.jobId);
        }
      } catch (e) {
        skipped.push({ questionId: ch.questionId, field: ch.field, reason: redact((e as Error).message).slice(0, 120) });
      }
    }
    if (touchedItems.size) {
      await this.prisma.aiJobItem.updateMany({ where: { id: { in: Array.from(touchedItems) }, status: { in: ['DONE', 'ACCEPTED'] } }, data: { status: 'REJECTED', note: 'AI change Undo kiya gaya' } });
      for (const j of touchedJobs) await this.recount(j);
    }
    // more rows than one chunk: the screen calls again while `undone` > 0 and `remaining` > 0 (skipped rows stay, so they are not counted)
    const total = rows.length === UNDO_CHUNK ? await this.prisma.aiChange.count({ where }) : 0;
    return { undone, skipped: skipped.length, skippedDetails: skipped.slice(0, 10), remaining: Math.max(0, total - skipped.length) };
  }

  // ------------------------------------------------------------------ read side (admin screen)

  async scopeMeta() {
    const [exams, subjects, chapters] = await Promise.all([
      this.prisma.exam.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.subject.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.chapter.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, subjectId: true } }),
    ]);
    return { exams, subjects, chapters };
  }

  private health(live: Awaited<ReturnType<AiProviderService['getLiveStatus']>>, pyqMsg: string | null) {
    const activeKeys = live.keys.filter((k) => k.isActive);
    const gw = live.gateway.configured;
    if (activeKeys.length === 0 && !gw) return { level: 'red', icon: '🔴', text: 'Koi AI key active nahi — API Keys me key daalein' };
    const recent = live.recent.slice(0, 10);
    const failRate = recent.length >= 5 ? recent.filter((e) => !e.success).length / recent.length : 0;
    if (pyqMsg && /block|captcha|search.*fail/i.test(pyqMsg)) return { level: 'yellow', icon: '🟡', text: 'Web search block ho rahi hai (PYQ date kaam rukega)' };
    if (activeKeys.length > 0 && activeKeys.every((k) => k.state === 'resting') && !gw) return { level: 'yellow', icon: '🟡', text: 'Sabhi keys rest par (rate limit) — thodi der me chalegi' };
    if (failRate >= 0.7) return { level: 'yellow', icon: '🟡', text: 'Pichhli calls me zyada fail — System Check chalayein' };
    return { level: 'green', icon: '🟢', text: live.working > 0 ? 'AI chal raha hai' : 'AI ready hai' };
  }

  /** tiny, secret-free snapshot for GET /health */
  async healthSnapshot(): Promise<{ worker: 'on' | 'off' | 'stalled'; lastTickSecAgo: number | null; keysActive: number; pendingJobs: number; boot: string | null }> {
    let keysActive = 0;
    let pendingJobs = 0;
    try {
      keysActive = (await this.keys.getRotationPool('openrouter')).length;
      pendingJobs = await this.prisma.aiJob.count({ where: { status: { in: ['PENDING', 'RUNNING'] } } });
    } catch {
      /* DB problem is reported by the DB check itself */
    }
    const ago = this.lastTickAt ? Math.round((Date.now() - this.lastTickAt) / 1000) : null;
    // the tick runs every 5 s; > 3 min of silence without a long-running tick means the loop is dead
    const worker = !this.workerEnabled() ? 'off' : this.busy ? 'on' : ago !== null && ago > 180 ? 'stalled' : 'on';
    return { worker, lastTickSecAgo: ago, keysActive, pendingJobs, boot: this.bootReport?.line ?? null };
  }

  async overview() {
    const [live, jobs, cfg] = await Promise.all([
      this.ai.getLiveStatus(),
      this.prisma.aiJob.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      this.pyq.getConfig().catch(() => null),
    ]);
    const now = Date.now();
    const cur = Array.from(this.current.values());
    const rows = jobs.map((j) => {
      const processed = j.doneCount + j.failedCount + j.reviewCount;
      const remaining = Math.max(0, j.totalCount - processed);
      const elapsed = j.startedAt ? (now - j.startedAt.getTime()) / 1000 : 0;
      const eta = j.status === 'RUNNING' && processed >= 3 && elapsed > 0 ? etaSeconds(remaining, elapsed / processed, 1) : null;
      const doingNow = cur.filter((c) => c.jobId === j.id).map((c) => ({ questionNo: c.questionNo, stage: c.stage, pass: c.pass, passes: c.passes, runningSec: Math.round((now - c.startedAt) / 1000) }));
      return {
        id: j.id, type: j.type, label: JOB_LABEL[j.type as JobType] ?? j.type, title: j.title, status: j.status, passes: j.passes, minAgree: j.minAgree,
        total: j.totalCount, done: j.doneCount, failed: j.failedCount, review: j.reviewCount, calls: j.callsMade, startedAt: j.startedAt, finishedAt: j.finishedAt,
        lastError: j.lastError, createdAt: j.createdAt, etaSec: eta, avgSecPerItem: processed >= 3 && elapsed > 0 ? Math.round((elapsed / processed) * 10) / 10 : null, current: doingNow,
      };
    });
    return {
      now,
      health: this.health(live, cfg?.lastMessage ?? null),
      boot: this.bootReport,
      worker: { enabled: this.workerEnabled(), busy: this.busy, watchdogFixed: this.watchdogFixed, lastTickAt: this.lastTickAt || null, lastMessage: this.lastMessage, restSec: Math.max(0, Math.ceil((this.pausedUntil - now) / 1000)) },
      jobs: rows,
      live,
    };
  }

  async getJob(id: string) {
    const j = await this.mustJob(id);
    const g = await this.prisma.aiJobItem.groupBy({ by: ['status'], where: { jobId: id }, _count: { _all: true } });
    const undoable = await this.prisma.aiChange.count({ where: { jobId: id, undoneAt: null } });
    return { job: j, statusCounts: Object.fromEntries(g.map((x) => [x.status, x._count._all])), undoable };
  }

  async listItems(jobId: string, f: { status?: string; skip?: number; take?: number }) {
    await this.mustJob(jobId);
    const where: Prisma.AiJobItemWhereInput = { jobId, ...(f.status ? { status: f.status } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.aiJobItem.count({ where }),
      this.prisma.aiJobItem.findMany({ where, orderBy: [{ questionNo: 'asc' }], skip: Math.max(0, f.skip ?? 0), take: Math.min(100, Math.max(1, f.take ?? 25)) }),
    ]);
    const qs = await this.prisma.question.findMany({ where: { id: { in: rows.map((r) => r.questionId) } }, select: { id: true, questionText: true } });
    const qMap = new Map(qs.map((q) => [q.id, q.questionText]));
    return { total, rows: rows.map((r) => ({ id: r.id, questionId: r.questionId, questionNo: r.questionNo, status: r.status, note: r.note, lastError: r.lastError, agree: r.agreeCount, passesDone: r.passesDone, proposal: r.proposalJson, passes: r.passesJson, question: (qMap.get(r.questionId) ?? '').slice(0, 160), appliedAt: r.appliedAt })) };
  }
}
