/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { REBALANCE_TEST_RESERVE_SQL } from './test-reserve.sql';

const EVERY_MS = 10 * 60_000;

/**
 * Keeps half of every topic's practice questions for tests (custom test, smart mock). See schema.prisma Question.testReserved.
 * Runs once shortly after start, every 10 minutes, and after every upload job. Idempotent and safe with two containers (the statement only ADDS
 * reserved rows; two runs at once reserve the same rows). Switch off with TEST_RESERVE_DISABLED=1.
 */
@Injectable()
export class TestReserveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TestReserveService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.TEST_RESERVE_DISABLED === '1') return;
    setTimeout(() => void this.rebalance('start'), 20_000).unref?.();
    this.timer = setInterval(() => void this.rebalance('timer'), EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Returns how many questions were newly reserved (0 when nothing needed to change). Never throws. */
  async rebalance(why = 'manual'): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const n = Number(await (this.prisma as any).$executeRawUnsafe(REBALANCE_TEST_RESERVE_SQL));
      if (n > 0) this.logger.log(`test reserve (${why}): ${n} question(s) moved to the test half`);
      return n;
    } catch (e: any) {
      this.logger.warn(`test reserve (${why}) failed: ${e?.message ?? e}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** Admin view: how the practice questions are split per subject. */
  async stats() {
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(`
      SELECT s."name" AS subject,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE q."testReserved")::int AS reserved,
             COUNT(*) FILTER (WHERE NOT q."testReserved")::int AS visible
      FROM "questions" q JOIN "subjects" s ON s."id" = q."subjectId"
      WHERE q."year" IS NULL AND q."isActive" = true AND q."isApproved" = true AND q."autoSuspended" = false
      GROUP BY s."name" ORDER BY s."name"`);
    const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
    return { subjects: rows, total: sum('total'), reserved: sum('reserved'), visible: sum('visible') };
  }
}
