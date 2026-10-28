/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TestsService } from './tests.service';

/**
 * Abandoned timed attempts (session 29, roadmap 4.2).
 *
 * A student who starts a timed test and never presses Submit left an IN_PROGRESS attempt behind for ever: no result, no rank, no review.
 * This job scores such an attempt from the answers that were AUTOSAVED and stores it as AUTO_SUBMITTED (it counts for rank, like a normal
 * attempt: Sachin's decision, 28 Oct 2026). Rules:
 *  - only attempts whose deadline passed more than GRACE ago. The grace is longer than the 6 hours an OFFLINE student may still replay a
 *    queued submit (tests.service.ts, OFFLINE_REPLAY_WINDOW_MS), so the sweeper can never take that result away from them;
 *  - only attempts with at least one autosaved answer (the query asks for it, so empty attempts are not even looked at);
 *  - at most MAX_PER_RUN attempts per run, oldest deadline first; running twice, or in two containers, is safe because each attempt is
 *    claimed with a conditional UPDATE (... WHERE status = 'IN_PROGRESS'), exactly like a student's own submit;
 *  - kill-switch: env ATTEMPT_SWEEPER=off.
 */
export const SWEEP_EVERY_MS = 10 * 60_000;
export const SWEEP_MAX_PER_RUN = 50;
/** 6 h offline replay window + 10 min */
export const SWEEP_GRACE_MS = 6 * 60 * 60_000 + 10 * 60_000;

export function sweepGraceMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.ATTEMPT_SWEEP_GRACE_MIN);
  // never shorter than the offline replay window: a shorter value would make the sweeper steal a legitimate late submit
  return Number.isFinite(raw) && raw * 60_000 >= SWEEP_GRACE_MS ? Math.floor(raw * 60_000) : SWEEP_GRACE_MS;
}

export type SweepSummary = { looked: number; submitted: number; skipped: number; failed: number };

@Injectable()
export class AttemptSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttemptSweeperService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tests: TestsService,
  ) {}

  onModuleInit() {
    if (process.env.ATTEMPT_SWEEPER === 'off') return;
    setTimeout(() => void this.tick(), 3 * 60_000).unref?.();
    this.timer = setInterval(() => void this.tick(), SWEEP_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      const s = await this.run();
      if (s.looked > 0) this.logger.log(`attempt sweeper: looked ${s.looked}, auto-submitted ${s.submitted}, skipped ${s.skipped}, failed ${s.failed}`);
    } catch (e) {
      this.logger.warn(`attempt sweeper run failed: ${(e as Error).message}`);
    }
  }

  /** One pass. Safe to call any number of times (also from two containers at once). */
  async run(now = new Date(), max = SWEEP_MAX_PER_RUN): Promise<SweepSummary> {
    const out: SweepSummary = { looked: 0, submitted: 0, skipped: 0, failed: 0 };
    if (this.running) return out;
    this.running = true;
    try {
      const grace = sweepGraceMs();
      const due: { id: string }[] = await this.prisma.testAttempt.findMany({
        where: {
          status: 'IN_PROGRESS',
          expiresAt: { lt: new Date(now.getTime() - grace) },
          // nothing to score without an answer: such attempts are not candidates (and so never crowd out real ones)
          answers: { some: { selectedOption: { not: null } } },
        },
        orderBy: { expiresAt: 'asc' },
        take: max,
        select: { id: true },
      });
      for (const a of due) {
        out.looked++;
        try {
          const r = await this.tests.autoSubmitAttempt(a.id, grace);
          if (r.skipped) out.skipped++;
          else if (!r.alreadyDone) out.submitted++;
        } catch (e) {
          out.failed++;
          this.logger.warn(`attempt sweeper: ${a.id} failed: ${(e as Error).message}`);
        }
      }
      return out;
    } finally {
      this.running = false;
    }
  }
}
