/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DuplicateAction, DuplicateReviewService } from './duplicate-review.service';
import {
  AUTO_PUBLISH_KEY,
  AutoDecision,
  AutoPublishConfig,
  AutoRunSummary,
  SideInfo,
  decideAuto,
  mergeAutoPublish,
  pushRun,
  validateAutoPublish,
} from './auto-publish.util';

const LOG_KEY = 'autopublish.log';
const RUN_EVERY_MS = 15 * 60_000;
const MAX_PER_RUN = 300;
const PREVIEW_MAX = 3000;
const CONFIG_CACHE_MS = 20_000;

type DueReview = {
  id: string;
  matchType: string;
  differences: unknown;
  existingQuestionId: string | null;
  candidateQuestionId: string | null;
  candidateJson: unknown;
};

/**
 * Auto-publish: a duplicate review nobody answered for `afterHours` hours is decided by the rules in auto-publish.util.ts
 * (same question in another paper -> keep both, identical copy -> keep the existing one ...). Anything the rules cannot
 * decide safely stays in the queue for a person. Every automatic decision is marked and can be undone.
 */
@Injectable()
export class AutoPublishService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoPublishService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private cache: { at: number; value: AutoPublishConfig } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reviews: DuplicateReviewService,
  ) {}

  onModuleInit() {
    if (process.env.AUTOPUBLISH_JOB === 'off') return;
    setTimeout(() => void this.tick(), 120_000).unref?.();
    this.timer = setInterval(() => void this.tick(), RUN_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      await this.run('auto');
    } catch (e) {
      this.logger.warn(`auto-publish run failed: ${(e as Error).message}`);
    }
  }

  // ---- settings + log ----
  async config(): Promise<AutoPublishConfig> {
    if (this.cache && Date.now() - this.cache.at < CONFIG_CACHE_MS) return this.cache.value;
    let value = mergeAutoPublish(null);
    try {
      const row = await this.prisma.appSetting.findUnique({ where: { key: AUTO_PUBLISH_KEY } });
      value = mergeAutoPublish(row?.valueJson);
    } catch {
      // not migrated yet: defaults
    }
    this.cache = { at: Date.now(), value };
    return value;
  }

  async saveConfig(input: unknown, adminId: string) {
    const before = await this.config();
    const checked = validateAutoPublish(before, input);
    if (!checked.ok) throw new BadRequestException(checked.error);
    await this.prisma.appSetting.upsert({
      where: { key: AUTO_PUBLISH_KEY },
      create: { key: AUTO_PUBLISH_KEY, valueJson: checked.config as any, updatedBy: adminId },
      update: { valueJson: checked.config as any, updatedBy: adminId },
    });
    this.cache = { at: Date.now(), value: checked.config };
    return { config: checked.config, before };
  }

  async log(): Promise<AutoRunSummary[]> {
    try {
      const row = await this.prisma.appSetting.findUnique({ where: { key: LOG_KEY } });
      return Array.isArray(row?.valueJson) ? (row!.valueJson as unknown as AutoRunSummary[]) : [];
    } catch {
      return [];
    }
  }

  private async writeLog(run: AutoRunSummary) {
    try {
      const next = pushRun(await this.log(), run);
      await this.prisma.appSetting.upsert({
        where: { key: LOG_KEY },
        create: { key: LOG_KEY, valueJson: next as any },
        update: { valueJson: next as any },
      });
    } catch {
      // the log is a convenience only
    }
  }

  /** The admin the automatic decisions are attributed to (whoever last saved the settings, else the oldest admin). */
  private async actor(): Promise<string | null> {
    try {
      const row = await this.prisma.appSetting.findUnique({ where: { key: AUTO_PUBLISH_KEY }, select: { updatedBy: true } });
      if (row?.updatedBy) {
        const u = await this.prisma.user.findUnique({ where: { id: row.updatedBy }, select: { id: true, role: true } });
        if (u && u.role === 'ADMIN') return u.id;
      }
      const a = await this.prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      return a?.id ?? null;
    } catch {
      return null;
    }
  }

  // ---- deciding ----
  private async decideBatch(due: DueReview[], cfg: AutoPublishConfig): Promise<Map<string, AutoDecision | null>> {
    const ids = new Set<string>();
    for (const r of due) {
      if (r.existingQuestionId) ids.add(r.existingQuestionId);
      if (r.candidateQuestionId) ids.add(r.candidateQuestionId);
    }
    const rows = ids.size
      ? await this.prisma.question.findMany({
          where: { id: { in: [...ids] } },
          select: { id: true, year: true, examDate: true, isActive: true, isApproved: true, autoSuspended: true, createdAt: true },
        })
      : [];
    const side = new Map<string, SideInfo>(
      rows.map((q) => [q.id, { year: q.year ?? null, examDate: q.examDate ?? null, live: q.isActive && q.isApproved && !q.autoSuspended, createdAt: q.createdAt }]),
    );

    const out = new Map<string, AutoDecision | null>();
    for (const r of due) {
      const uploadMode = !!r.candidateJson && !r.candidateQuestionId;
      const existing = r.existingQuestionId ? side.get(r.existingQuestionId) ?? null : null;
      let candidate: SideInfo | null;
      if (uploadMode) {
        const c = r.candidateJson as any;
        candidate = { year: typeof c?.year === 'number' ? c.year : null, examDate: typeof c?.examDate === 'string' ? c.examDate : null, live: false };
      } else {
        candidate = r.candidateQuestionId ? side.get(r.candidateQuestionId) ?? null : null;
      }
      if (!candidate) {
        out.set(r.id, null); // the second question is gone: let a person look
        continue;
      }
      out.set(
        r.id,
        decideAuto({
          matchType: r.matchType,
          differences: Array.isArray(r.differences) ? (r.differences as string[]) : [],
          existing,
          candidate,
          includeSimilar: cfg.includeSimilar,
        }),
      );
    }
    return out;
  }

  private dueWhere(cfg: AutoPublishConfig) {
    return { status: 'PENDING', createdAt: { lte: new Date(Date.now() - cfg.afterHours * 3_600_000) } };
  }

  /** What would happen if the job ran now: counts per decision, so the admin can see it before trusting it. */
  async preview() {
    const cfg = await this.config();
    const [pending, dueRows] = await Promise.all([
      this.prisma.duplicateReview.count({ where: { status: 'PENDING' } }),
      this.prisma.duplicateReview.findMany({
        where: this.dueWhere(cfg),
        orderBy: { createdAt: 'asc' },
        take: PREVIEW_MAX,
        select: { id: true, matchType: true, differences: true, existingQuestionId: true, candidateQuestionId: true, candidateJson: true },
      }),
    ]);
    const decisions = await this.decideBatch(dueRows, cfg);
    let keepBoth = 0;
    let keepExisting = 0;
    let keepNew = 0;
    let needsHuman = 0;
    for (const d of decisions.values()) {
      if (!d) needsHuman++;
      else if (d.action === 'KEEP_BOTH') keepBoth++;
      else if (d.action === 'KEEP_EXISTING') keepExisting++;
      else keepNew++;
    }
    return {
      pending,
      due: dueRows.length,
      notDueYet: Math.max(pending - dueRows.length, 0),
      keepBoth,
      keepExisting,
      keepNew,
      needsHuman,
      cappedAt: dueRows.length >= PREVIEW_MAX ? PREVIEW_MAX : null,
    };
  }

  /** One pass. `manual` ignores the on/off switch (the admin pressed "Run now"). Returns null when nothing ran. */
  async run(trigger: 'auto' | 'manual'): Promise<AutoRunSummary | null> {
    const cfg = await this.config();
    if (trigger === 'auto' && !cfg.enabled) return null;
    if (this.running) {
      if (trigger === 'manual') throw new BadRequestException('A run is already in progress - try again in a minute.');
      return null;
    }
    this.running = true;
    try {
      const due = await this.prisma.duplicateReview.findMany({
        where: this.dueWhere(cfg),
        orderBy: { createdAt: 'asc' },
        take: MAX_PER_RUN,
        select: { id: true, matchType: true, differences: true, existingQuestionId: true, candidateQuestionId: true, candidateJson: true },
      });
      if (due.length === 0) return null;
      const actor = await this.actor();
      if (!actor) return null;

      const decisions = await this.decideBatch(due, cfg);
      const items: { id: string; action: DuplicateAction }[] = [];
      const reasonOf = new Map<string, string>();
      let needsHuman = 0;
      for (const r of due) {
        const d = decisions.get(r.id);
        if (!d) {
          needsHuman++;
          continue;
        }
        items.push({ id: r.id, action: d.action });
        reasonOf.set(r.id, d.reason);
      }

      const { doneIds, failedIds } = items.length ? await this.reviews.resolveDecided(items, actor, { publish: false }) : { doneIds: [] as string[], failedIds: [] as string[] };

      // mark them (grouped by reason: one update per distinct reason)
      const byReason = new Map<string, string[]>();
      for (const id of doneIds) {
        const reason = reasonOf.get(id) ?? 'auto';
        byReason.set(reason, [...(byReason.get(reason) ?? []), id]);
      }
      for (const [reason, ids] of byReason) {
        await this.prisma.duplicateReview.updateMany({ where: { id: { in: ids } }, data: { autoResolved: true, autoReason: reason } }).catch(() => undefined);
      }

      const actionOf = new Map(items.map((i) => [i.id, i.action]));
      const count = (a: DuplicateAction) => doneIds.filter((id) => actionOf.get(id) === a).length;
      const summary: AutoRunSummary = {
        at: new Date().toISOString(),
        trigger,
        keptNew: count('KEEP_NEW'),
        keptExisting: count('KEEP_EXISTING'),
        keptBoth: count('KEEP_BOTH'),
        needsHuman,
        failed: failedIds.length,
      };
      if (doneIds.length || failedIds.length || trigger === 'manual') await this.writeLog(summary);
      if (doneIds.length) this.logger.log(`auto-publish: ${doneIds.length} duplicate(s) decided (${summary.keptNew} new, ${summary.keptExisting} existing, ${summary.keptBoth} both), ${needsHuman} left for a person`);
      return summary;
    } finally {
      this.running = false;
    }
  }
}
