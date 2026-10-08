import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import { AdminApiKeyService } from '../admin-api-keys/admin-api-keys.service';
import { BankUploadService } from '../bank/bank-upload.service';
import { PyqDateSearchService, Evidence } from './pyq-date-search.service';
import {
  PassRecord,
  PassVerdict,
  Tier,
  buildQueries,
  cleanQuestionText,
  dateAppearsInText,
  decideFromPasses,
  detectTier,
  isValidIsoDate,
  minAgreeFor,
  normalizeTier,
  parsePassAnswer,
  stripHtml,
  toIsoDate,
  words,
} from './pyq-date.util';

/**
 * PYQ date mapping (NEW Oct 7 2026).
 *
 * Every PYQ question (a question with a `year`) that has no exam date is looked up on the internet:
 *   1. it waits `minAgeMinutes` (5) after upload,
 *   2. for each of `passes` (5) verification passes: a DIFFERENT web search -> evidence text ->
 *      a FREE OpenRouter model reads ONLY that evidence and answers with the exam date,
 *   3. a pass counts only if the date is really written in the evidence AND its year matches the question's year,
 *   4. >= 3 of 5 passes on the same date -> the date is written to Question.examDate (and Tier 1/2 to examTier),
 *      anything weaker goes to "needs review" for the admin. Nothing is guessed.
 */

export const PYQ_FEATURE = 'PYQ_DATE_MAPPING';
const TICK_MS = 45_000;
const STUCK_MS = 15 * 60 * 1000;
const STATUSES = ['PENDING', 'RUNNING', 'MAPPED', 'NEEDS_REVIEW', 'NOT_FOUND', 'FAILED', 'MANUAL'] as const;
export type MapStatus = (typeof STATUSES)[number];

interface QuestionForRun {
  id: string;
  questionNo: number;
  questionText: string;
  questionTextHindi: string | null;
  optionsJson: unknown;
  year: number | null;
  shift: string | null;
  paperCode: string | null;
  examDate: string | null;
  examTier: string | null;
  examId: string | null;
  exam: { name: string; slug: string; code: string } | null;
}

interface PaperKey {
  examId: string;
  year: number;
  shift: string;
  paperCode: string | null;
}

class AbortRun extends Error {
  constructor(message: string, readonly noKeys = false) {
    super(message);
  }
}

@Injectable()
export class PyqDateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PyqDateService.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private current: { questionNo: number; questionId: string; pass: number; passes: number; startedAt: number } | null = null;
  private lastPruneAt = 0;
  private readonly touchedPapers = new Map<string, PaperKey>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiProviderService,
    private readonly keys: AdminApiKeyService,
    private readonly bankUpload: BankUploadService,
    private readonly search: PyqDateSearchService,
  ) {}

  // ------------------------------------------------------------------ lifecycle

  async onModuleInit() {
    if ((process.env.PYQ_DATE_WORKER || '').toLowerCase() === 'off') {
      this.logger.warn('PYQ date worker is OFF (PYQ_DATE_WORKER=off).');
      return;
    }
    try {
      // a restart kills a run half-way: put those rows back in the queue
      const r = await this.prisma.pyqDateMap.updateMany({
        where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 3 * 60 * 1000) } },
        data: { status: 'PENDING' },
      });
      if (r.count) this.logger.log(`Re-queued ${r.count} interrupted PYQ date jobs.`);
    } catch (e) {
      this.logger.warn(`PYQ date worker start-up check failed (is the migration applied?): ${(e as Error).message}`);
    }
    this.timer = setInterval(() => void this.tick(false), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ config

  async getConfig() {
    return this.prisma.pyqDateConfig.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} });
  }

  async updateConfig(dto: { autoRun?: boolean; minAgeMinutes?: number; batchSize?: number; passes?: number }) {
    const data: Prisma.PyqDateConfigUpdateInput = {};
    if (typeof dto.autoRun === 'boolean') data.autoRun = dto.autoRun;
    const num = (v: unknown, min: number, max: number, label: string) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max) throw new BadRequestException(`${label}: ${min} se ${max} ke beech hona chahiye.`);
      return Math.floor(n);
    };
    if (dto.minAgeMinutes !== undefined) data.minAgeMinutes = num(dto.minAgeMinutes, 0, 1440, 'minAgeMinutes');
    if (dto.batchSize !== undefined) data.batchSize = num(dto.batchSize, 1, 5, 'batchSize');
    if (dto.passes !== undefined) data.passes = num(dto.passes, 3, 5, 'passes');
    await this.getConfig();
    return this.prisma.pyqDateConfig.update({ where: { id: 'default' }, data });
  }

  // ------------------------------------------------------------------ worker

  /** Starts a run right now (also when auto-run is off). Returns immediately; the run continues in the background. */
  kick(limit?: number): { started: boolean; reason?: string } {
    if (this.busy) return { started: false, reason: 'Worker abhi chal raha hai — status page par progress dekhein.' };
    setImmediate(() => void this.tick(true, limit));
    return { started: true };
  }

  async tick(force: boolean, limitOverride?: number): Promise<void> {
    if (this.busy) return;
    let cfg;
    try {
      cfg = await this.getConfig();
    } catch {
      return; // DB / migration not ready yet
    }
    if (!force && !cfg.autoRun) return;
    this.busy = true;
    let message = '';
    try {
      // stuck-run recovery (a crash while RUNNING)
      await this.prisma.pyqDateMap.updateMany({ where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - STUCK_MS) } }, data: { status: 'PENDING' } });

      let discovered = 0;
      if (cfg.autoRun) discovered = await this.discover(cfg.minAgeMinutes);
      const res = await this.processBatch(limitOverride ?? cfg.batchSize);
      message = res.message || (discovered ? `${discovered} naye PYQ queue me aaye.` : '');
      if (res.processed > 0) message = `${res.processed} question process hue (${res.mapped} mapped, ${res.review} review, ${res.notFound} not found).`;
      await this.flushPapers();

      if (Date.now() - this.lastPruneAt > 24 * 3600 * 1000) {
        this.lastPruneAt = Date.now();
        await this.keys.pruneUsageLog(90);
      }
    } catch (e) {
      message = `Worker error: ${(e as Error).message}`.slice(0, 300);
      this.logger.error(message);
    } finally {
      this.busy = false;
      this.current = null;
      try {
        await this.prisma.pyqDateConfig.update({ where: { id: 'default' }, data: { lastTickAt: new Date(), lastMessage: message || 'Koi kaam pending nahi.' } });
      } catch {
        /* ignore */
      }
    }
  }

  /** New PYQ questions (year set, no date) older than minAge that are not in the queue yet -> PENDING. */
  private async discover(minAgeMinutes: number): Promise<number> {
    const cutoff = new Date(Date.now() - minAgeMinutes * 60_000);
    const rows = await this.prisma.question.findMany({
      where: this.unmappedWhere({ createdAtLte: cutoff }),
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    if (rows.length === 0) return 0;
    const r = await this.prisma.pyqDateMap.createMany({ data: rows.map((x) => ({ questionId: x.id })), skipDuplicates: true });
    return r.count;
  }

  private unmappedWhere(f: { createdAtLte?: Date; examId?: string; subjectId?: string; chapterId?: string; year?: number } = {}): Prisma.QuestionWhereInput {
    return {
      year: f.year ?? { not: null },
      isActive: true,
      examId: f.examId ?? { not: null },
      ...(f.subjectId ? { subjectId: f.subjectId } : {}),
      ...(f.chapterId ? { chapterId: f.chapterId } : {}),
      OR: [{ examDate: null }, { examDate: '' }],
      pyqDateMap: { is: null },
      ...(f.createdAtLte ? { createdAt: { lte: f.createdAtLte } } : {}),
    };
  }

  private async processBatch(limit: number): Promise<{ processed: number; mapped: number; review: number; notFound: number; message?: string }> {
    const out = { processed: 0, mapped: 0, review: 0, notFound: 0, message: undefined as string | undefined };
    const pool = await this.keys.getRotationPool('openrouter');
    const pending = await this.prisma.pyqDateMap.count({ where: { status: 'PENDING', nextRunAt: { lte: new Date() } } });
    if (pending === 0) return out;
    if (pool.length === 0) {
      out.message = 'Koi active OpenRouter key nahi hai — Admin → API Keys me key daalein, tab PYQ date mapping chalegi.';
      return out;
    }
    const due = await this.prisma.pyqDateMap.findMany({
      where: { status: 'PENDING', nextRunAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: Math.max(1, limit),
      select: { id: true },
    });
    for (const d of due) {
      const claimed = await this.prisma.pyqDateMap.updateMany({
        where: { id: d.id, status: 'PENDING' },
        data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
      if (claimed.count !== 1) continue;
      const r = await this.processOne(d.id);
      if (r.abort) {
        out.message = r.message;
        break;
      }
      out.processed++;
      if (r.status === 'MAPPED') out.mapped++;
      else if (r.status === 'NEEDS_REVIEW') out.review++;
      else if (r.status === 'NOT_FOUND') out.notFound++;
    }
    return out;
  }

  // ------------------------------------------------------------------ one question

  private buildPrompt(q: QuestionForRun, evidenceText: string): string {
    const opts = (Array.isArray(q.optionsJson) ? (q.optionsJson as Array<{ key?: string; text?: string }>) : [])
      .map((o) => `${o.key ?? '?'}) ${stripHtml(String(o.text ?? '')).slice(0, 120)}`)
      .join('   ');
    return [
      'You verify the EXAM DATE of an Indian SSC previous-year question using ONLY the web evidence below.',
      'Never guess and never use your own memory: if the evidence does not show the date, say found=false.',
      '',
      `QUESTION (stored as: exam="${q.exam?.name ?? 'SSC'}", year=${q.year ?? 'unknown'}, shift="${q.shift ?? 'unknown'}"):`,
      cleanQuestionText(q.questionText).slice(0, 600),
      opts ? `OPTIONS: ${opts}` : '',
      '',
      'WEB EVIDENCE (search results and text taken from the pages):',
      evidenceText,
      '',
      'TASK: find the calendar date on which the SSC exam paper / shift that contained this question was held.',
      'RULES:',
      '- Use ONLY a date that is written in the evidence above, exactly as shown there.',
      '- It must be the exam date of that shift — NOT the article publish date, notification date, admit-card date or result date.',
      '- Prefer sources marked "QUESTION_FOUND_ON_THIS_PAGE: YES" and the line "NEAREST_DATE_ABOVE_QUESTION".',
      '- "tier" is "TIER_1" or "TIER_2" only when the evidence says so, otherwise null.',
      '',
      'Reply with ONE JSON object only (no markdown, no explanation):',
      '{"found": true|false, "examDate": "YYYY-MM-DD" or null, "year": <number or null>, "tier": "TIER_1"|"TIER_2"|null, "shift": "Shift 1" or null, "sourceIndex": <the [n] number of the source you used or null>, "quote": "<exact words copied from the evidence that show the date, max 160 chars>", "confidence": <0 to 1>}',
    ]
      .filter((l) => l !== '')
      .join('\n');
  }

  private async processOne(mapId: string): Promise<{ abort: boolean; status?: MapStatus; message?: string }> {
    const map = await this.prisma.pyqDateMap.findUnique({
      where: { id: mapId },
      include: {
        question: {
          select: {
            id: true, questionNo: true, questionText: true, questionTextHindi: true, optionsJson: true, year: true, shift: true,
            paperCode: true, examDate: true, examTier: true, examId: true,
            exam: { select: { name: true, slug: true, code: true } },
          },
        },
      },
    });
    if (!map || !map.question) return { abort: false };
    const q = map.question as QuestionForRun;
    const cfg = await this.getConfig();
    const passesN = Math.max(3, Math.min(5, cfg.passes));
    const minAgree = minAgreeFor(passesN);
    const verifyExisting = !!q.examDate;

    if (!q.year) {
      await this.finish(mapId, 'NOT_FOUND', { note: 'Is question me year nahi hai — ye PYQ nahi hai, isliye date map nahi hogi.' });
      return { abort: false, status: 'NOT_FOUND' };
    }

    const priorTier: Tier | null = detectTier(q.paperCode, q.exam?.name, q.exam?.slug, q.exam?.code) ?? normalizeTier(q.examTier);
    const options = (Array.isArray(q.optionsJson) ? q.optionsJson : []) as Array<{ key?: string; text?: string }>;
    const queries = buildQueries(
      { questionText: q.questionText, questionTextHindi: q.questionTextHindi, options, examName: q.exam?.name ?? 'SSC', examCode: q.exam?.code ?? null, year: q.year, shift: q.shift, tier: priorTier },
      passesN,
    );
    const questionKey = words(cleanQuestionText(q.questionText), 0, 14);

    const passes: PassRecord[] = [];
    let abort: AbortRun | null = null;
    const runStartedAt = Date.now();

    for (let i = 0; i < passesN; i++) {
      this.current = { questionNo: q.questionNo, questionId: q.id, pass: i + 1, passes: passesN, startedAt: runStartedAt };
      const query = queries[i % queries.length];
      const t0 = Date.now();
      const rec: PassRecord = {
        index: i + 1, query, verdict: 'no_results', examDate: null, year: null, tier: null, shift: null, quote: null, sourceUrl: null,
        confidence: null, strong: false, hits: 0, evidenceChars: 0, sources: [], ms: 0,
      };
      let ev: Evidence;
      try {
        ev = await this.search.gather(query, questionKey);
      } catch (e) {
        rec.verdict = 'search_failed';
        rec.reason = (e as Error).message?.slice(0, 200) || 'search error';
        rec.ms = Date.now() - t0;
        passes.push(rec);
        continue;
      }
      rec.hits = ev.hits;
      rec.evidenceChars = ev.text.length;
      rec.strong = ev.strong;
      rec.sources = ev.sources.slice(0, 6);
      if (ev.hits === 0) {
        rec.verdict = ev.failed ? 'search_failed' : 'no_results';
        rec.reason = ev.error;
        rec.ms = Date.now() - t0;
        passes.push(rec);
        continue;
      }

      try {
        const res = await this.ai.generate(this.buildPrompt(q, ev.text), { jsonResponse: true, maxTokens: 700, feature: PYQ_FEATURE, modelOffset: i });
        rec.model = res.model;
        rec.keyName = res.adminKeyName ?? null;
        const parsed = parsePassAnswer(res.content);
        let verdict: PassVerdict;
        if (!parsed) {
          verdict = 'error';
          rec.reason = 'AI ka jawab samajh nahi aaya';
        } else {
          rec.examDate = parsed.examDate;
          rec.year = parsed.year;
          rec.tier = parsed.tier;
          rec.shift = parsed.shift;
          rec.quote = parsed.quote;
          rec.confidence = parsed.confidence;
          rec.sourceUrl = parsed.sourceIndex ? ev.sources[parsed.sourceIndex - 1]?.url ?? null : null;
          if (!parsed.found || !parsed.examDate) verdict = 'no_date';
          else if (!dateAppearsInText(parsed.examDate, ev.text)) {
            verdict = 'unsupported';
            rec.reason = 'AI ne jo date batayi wo evidence text me likhi nahi thi — reject';
          } else if (!this.yearMatches(q.year, +parsed.examDate.slice(0, 4), priorTier ?? parsed.tier)) {
            verdict = 'year_mismatch';
            rec.reason = `Date ka year ${parsed.examDate.slice(0, 4)} hai, question ka year ${q.year}`;
          } else verdict = 'accepted';
        }
        rec.verdict = verdict;
      } catch (e) {
        if (e instanceof ServiceUnavailableException) {
          const msg = String((e.getResponse() as { message?: string })?.message ?? e.message);
          abort = new AbortRun(msg, /add nahi hai/i.test(msg));
          rec.verdict = 'error';
          rec.reason = msg.slice(0, 200);
          rec.ms = Date.now() - t0;
          passes.push(rec);
          break;
        }
        rec.verdict = 'error';
        rec.reason = (e as Error).message?.slice(0, 200) || 'AI error';
      }
      rec.ms = Date.now() - t0;
      passes.push(rec);
    }

    // ---- every AI key busy / none: put the question back, do NOT count it as a failure
    if (abort) {
      await this.prisma.pyqDateMap.update({
        where: { id: mapId },
        data: {
          status: 'PENDING',
          nextRunAt: new Date(Date.now() + (abort.noKeys ? 30 : 8) * 60_000),
          attempts: { decrement: 1 },
          lastError: abort.message.slice(0, 400),
          passesJson: passes as unknown as Prisma.InputJsonValue,
          passesDone: passes.length,
        },
      });
      return { abort: true, message: `AI keys abhi busy/band hain — ${abort.noKeys ? '30' : '8'} minute baad dobara try hoga.` };
    }

    // ---- search engines blocked for every pass: retry later (3 tries), then FAILED
    if (passes.length > 0 && passes.every((p) => p.verdict === 'search_failed')) {
      const failedFinally = map.attempts >= 3;
      await this.prisma.pyqDateMap.update({
        where: { id: mapId },
        data: {
          status: failedFinally ? 'FAILED' : 'PENDING',
          nextRunAt: new Date(Date.now() + 20 * 60_000),
          lastError: 'Internet search sabhi passes me fail/blocked raha',
          note: failedFinally ? 'Search engines 3 baar block/fail — server ka internet ya search block check karein.' : 'Search block/fail — 20 minute baad dobara try hoga.',
          passesJson: passes as unknown as Prisma.InputJsonValue,
          passesDone: passes.length,
          finishedAt: new Date(),
        },
      });
      return { abort: false, status: failedFinally ? 'FAILED' : 'PENDING' };
    }

    const vote = decideFromPasses(passes, minAgree, q.year, priorTier);
    const sources = Array.from(new Map(passes.filter((p) => p.verdict === 'accepted' && p.sourceUrl).map((p) => [p.sourceUrl!, { url: p.sourceUrl!, date: p.examDate }])).values()).slice(0, 6);
    const common = {
      examTier: vote.tier,
      proposedDate: vote.date,
      proposedYear: vote.year,
      agreeCount: vote.agree,
      passesDone: passes.length,
      confidence: vote.confidence,
      passesJson: passes as unknown as Prisma.InputJsonValue,
      sourcesJson: sources as unknown as Prisma.InputJsonValue,
      verifyExisting,
    };

    // keep a reliably known tier (exam / paper code) even when no date could be proven
    const tierToStore = vote.tier && !q.examTier ? vote.tier : null;

    if (vote.decision === 'MAPPED' && vote.date) {
      if (verifyExisting) {
        if (q.examDate === vote.date) {
          await this.finish(mapId, 'MAPPED', { ...common, note: `Pehle se lagi date ${vote.date} internet se verify ho gayi. ${vote.note}` });
          if (tierToStore) await this.prisma.question.update({ where: { id: q.id }, data: { examTier: tierToStore } });
          return { abort: false, status: 'MAPPED' };
        }
        await this.finish(mapId, 'NEEDS_REVIEW', { ...common, note: `Question me date ${q.examDate} lagi hai par internet par ${vote.date} mili (${vote.note}) — admin check kare, auto-change nahi kiya.` });
        return { abort: false, status: 'NEEDS_REVIEW' };
      }
      const conflict = await this.paperConflict(q, vote.date);
      if (conflict) {
        await this.finish(mapId, 'NEEDS_REVIEW', {
          ...common,
          note: `Is paper (exam+year+shift) ke ${conflict.total} questions me zyada tar date ${conflict.date} hai, par is question ke liye ${vote.date} mili — ek paper ek hi date par hona chahiye, admin check kare.`,
        });
        return { abort: false, status: 'NEEDS_REVIEW' };
      }
      await this.applyDate(q, vote.date, vote.tier, mapId, { ...common, note: vote.note });
      return { abort: false, status: 'MAPPED' };
    }

    if (tierToStore && priorTier) await this.prisma.question.update({ where: { id: q.id }, data: { examTier: tierToStore } });
    await this.finish(mapId, vote.decision, { ...common, note: vote.note });
    return { abort: false, status: vote.decision };
  }

  /** the exam year may differ from the calendar year of a Tier 2 paper (e.g. CGL 2024 Tier 2 was held in Jan 2025) */
  private yearMatches(questionYear: number, dateYear: number, tier: Tier | null): boolean {
    if (dateYear === questionYear) return true;
    return tier === 'TIER_2' && dateYear === questionYear + 1;
  }

  private async finish(mapId: string, status: MapStatus, data: Partial<Prisma.PyqDateMapUncheckedUpdateInput> & { note?: string }) {
    await this.prisma.pyqDateMap.update({
      where: { id: mapId },
      data: { ...data, status, finishedAt: new Date(), lastError: null } as Prisma.PyqDateMapUncheckedUpdateInput,
    });
  }

  /** Same paper (exam + year + shift + paperCode) must have ONE date: compare with the date most of its questions already carry. */
  private async paperConflict(q: QuestionForRun, date: string): Promise<{ date: string; count: number; total: number } | null> {
    if (!q.examId || !q.year || !q.shift) return null;
    const rows = await this.prisma.question.groupBy({
      by: ['examDate'],
      where: { examId: q.examId, year: q.year, shift: q.shift, paperCode: q.paperCode ?? null, examDate: { not: null }, id: { not: q.id } },
      _count: { _all: true },
    });
    const valid = rows.filter((r) => r.examDate && r.examDate !== '');
    const total = valid.reduce((s, r) => s + r._count._all, 0);
    if (total < 3) return null;
    const top = valid.sort((a, b) => b._count._all - a._count._all)[0];
    if (top.examDate !== date && top._count._all / total >= 0.6) return { date: top.examDate!, count: top._count._all, total };
    return null;
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

  /** After a batch: make the shift-wise mock test of every touched paper show the (majority) real date. */
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

  /**
   * Put questions in the queue now (ignores the 5-minute wait).
   *  scope "unmapped": all PYQ questions without a date (+ optional exam/subject/chapter/year filter)
   *  scope "ids"     : exactly these question ids (re-runs them; with verifyExisting a dated question is only checked)
   *  scope "retry"   : every row currently in `statuses` (default FAILED + NOT_FOUND)
   */
  async enqueue(dto: { scope?: string; ids?: string[]; examId?: string; subjectId?: string; chapterId?: string; year?: number; statuses?: string[]; verifyExisting?: boolean }) {
    const scope = dto.scope || 'unmapped';
    const LIMIT = 20000;
    if (scope === 'ids') {
      const ids = Array.from(new Set((dto.ids ?? []).filter((x) => typeof x === 'string'))).slice(0, 2000);
      if (!ids.length) throw new BadRequestException('Koi question id nahi mili.');
      const found = await this.prisma.question.findMany({ where: { id: { in: ids }, year: { not: null } }, select: { id: true, examDate: true } });
      let queued = 0;
      for (const f of found) {
        const verify = !!dto.verifyExisting || !!f.examDate;
        await this.prisma.pyqDateMap.upsert({
          where: { questionId: f.id },
          create: { questionId: f.id, verifyExisting: verify },
          update: { status: 'PENDING', nextRunAt: new Date(), attempts: 0, note: null, lastError: null, verifyExisting: verify },
        });
        queued++;
      }
      return { queued, skipped: ids.length - found.length };
    }
    if (scope === 'retry') {
      const st = (dto.statuses?.length ? dto.statuses : ['FAILED', 'NOT_FOUND']).filter((s) => (STATUSES as readonly string[]).includes(s) && s !== 'RUNNING');
      const r = await this.prisma.pyqDateMap.updateMany({ where: { status: { in: st } }, data: { status: 'PENDING', nextRunAt: new Date(), attempts: 0, note: null, lastError: null } });
      return { queued: r.count, skipped: 0 };
    }
    // unmapped
    const rows = await this.prisma.question.findMany({
      where: this.unmappedWhere({ examId: dto.examId, subjectId: dto.subjectId, chapterId: dto.chapterId, year: dto.year }),
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: LIMIT,
    });
    if (rows.length) await this.prisma.pyqDateMap.createMany({ data: rows.map((x) => ({ questionId: x.id })), skipDuplicates: true });
    return { queued: rows.length, skipped: 0 };
  }

  async acceptProposed(questionId: string) {
    const map = await this.prisma.pyqDateMap.findUnique({ where: { questionId }, include: { question: { select: { id: true, examId: true, year: true, shift: true, paperCode: true, examTier: true, examDate: true, questionNo: true, questionText: true, questionTextHindi: true, optionsJson: true, exam: { select: { name: true, slug: true, code: true } } } } } });
    if (!map) throw new NotFoundException('Is question ki date-mapping entry nahi mili.');
    if (!map.proposedDate || !isValidIsoDate(map.proposedDate)) throw new BadRequestException('Koi proposed date nahi hai.');
    const q = map.question as QuestionForRun;
    await this.applyDate(q, map.proposedDate, normalizeTier(map.examTier), map.id, { note: `Admin ne accept ki (${map.agreeCount}/${map.passesDone} passes).` });
    await this.flushPapers();
    return { ok: true, examDate: map.proposedDate };
  }

  async setManual(questionId: string, dto: { examDate?: string; examTier?: string | null }) {
    const iso = toIsoDate(dto.examDate);
    if (!iso) throw new BadRequestException('Date galat hai — YYYY-MM-DD ya DD-MM-YYYY likhein.');
    const tier = dto.examTier === null || dto.examTier === '' || dto.examTier === undefined ? null : normalizeTier(dto.examTier);
    if (dto.examTier && !tier) throw new BadRequestException('Tier sirf Tier 1 ya Tier 2 ho sakta hai.');
    const q = await this.prisma.question.findUnique({ where: { id: questionId }, select: { id: true, year: true, examId: true, shift: true, paperCode: true } });
    if (!q) throw new NotFoundException('Question nahi mila.');
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
    if (r.count === 0) throw new NotFoundException('Entry nahi mili.');
    return { ok: true };
  }

  // ------------------------------------------------------------------ read APIs for the admin screen

  async overview() {
    const cfg = await this.getConfig();
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const [byStatus, pyqTotal, pyqWithDate, notQueued, tierGroups, byExamRows, usage, pool, recentDone, lastUse, pendingNow] = await Promise.all([
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
      this.prisma.aiUsageLog.groupBy({ by: ['success'], where: { feature: PYQ_FEATURE, createdAt: { gte: dayAgo } }, _count: { _all: true } }),
      this.keys.getPoolHealth(),
      this.prisma.pyqDateMap.findMany({ where: { startedAt: { not: null }, finishedAt: { not: null }, status: { in: ['MAPPED', 'NEEDS_REVIEW', 'NOT_FOUND'] } }, orderBy: { finishedAt: 'desc' }, take: 30, select: { startedAt: true, finishedAt: true } }),
      this.prisma.aiUsageLog.findFirst({ where: { feature: PYQ_FEATURE }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, keyName: true, model: true, success: true } }),
      this.prisma.pyqDateMap.count({ where: { status: 'PENDING' } }),
    ]);

    const counts: Record<string, number> = {};
    for (const s of STATUSES) counts[s] = 0;
    for (const g of byStatus) counts[g.status] = g._count._all;

    const durations = recentDone.map((r) => (r.finishedAt!.getTime() - r.startedAt!.getTime()) / 1000).filter((d) => d > 0 && d < 3600);
    const avgSec = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
    // one question takes avgSec of work + its share of the 45 s pause between worker rounds
    const perQuestionSec = avgSec ? avgSec + TICK_MS / 1000 / Math.max(1, cfg.batchSize) : null;
    const etaMinutes = perQuestionSec ? Math.round(((pendingNow + notQueued) * perQuestionSec) / 60) : null;

    const examMap = new Map<string, Record<string, number>>();
    for (const r of byExamRows) {
      const k = r.exam ?? '(no exam)';
      const e = examMap.get(k) ?? {};
      e[r.status] = r.n;
      examMap.set(k, e);
    }
    const or = pool.find((p) => p.provider === 'openrouter');
    const okToday = usage.find((u) => u.success)?._count._all ?? 0;
    const failToday = usage.find((u) => !u.success)?._count._all ?? 0;

    return {
      config: cfg,
      worker: {
        enabled: (process.env.PYQ_DATE_WORKER || '').toLowerCase() !== 'off',
        busy: this.busy,
        current: this.current ? { ...this.current, elapsedSec: Math.round((Date.now() - this.current.startedAt) / 1000) } : null,
        lastTickAt: cfg.lastTickAt,
        lastMessage: cfg.lastMessage,
        avgSecondsPerQuestion: avgSec ? Math.round(avgSec) : null,
        etaMinutes,
      },
      totals: { pyqTotal, pyqWithDate, pyqWithoutDate: pyqTotal - pyqWithDate, notQueued, queuePending: pendingNow },
      counts,
      tiers: tierGroups.map((t) => ({ tier: t.examTier ?? 'UNKNOWN', count: t._count._all })),
      byExam: Array.from(examMap.entries()).map(([exam, c]) => ({ exam, counts: c })),
      ai: {
        keys: { active: or?.active ?? 0, total: or?.total ?? 0 },
        callsLast24h: okToday + failToday,
        successLast24h: okToday,
        failedLast24h: failToday,
        lastUsedAt: lastUse?.createdAt ?? null,
        lastKeyName: lastUse?.keyName ?? null,
        lastModel: lastUse?.model ?? null,
        lastSuccess: lastUse?.success ?? null,
      },
    };
  }

  async listItems(f: { status?: string; examId?: string; subjectId?: string; chapterId?: string; year?: number; tier?: string; q?: string; skip?: number; take?: number }) {
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
    if (!m) throw new NotFoundException('Is question ki date-mapping entry nahi mili.');
    return m;
  }

  testSearch(q: string) {
    const query = String(q || '').trim();
    if (query.length < 3) throw new BadRequestException('Search text likhein.');
    return this.search.diagnose(query.slice(0, 240));
  }
}
