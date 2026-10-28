import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { retitlePyqMocks } from './pyq-mock-titles';

/** appSetting key: set once the old dated mock names have been rewritten. */
export const MOCK_TITLES_DONE_KEY = 'pyq.mockTitles.studentSafe.v1';

/**
 * One-time clean-up after the 29 Oct 2026 update: every existing real-paper mock is renamed from
 * "SSC CGL Tier 1 — 12 Sep 2025 · Shift 2" to "SSC CGL 2025 · Tier 1 · Shift 2 · Set 1", so the exam date is
 * visible to the admin only. Runs ~45 s after start, writes a flag, and never runs again. New / rebuilt mocks are
 * named correctly by the upload code itself. Switch off with PYQ_RETITLE=off.
 */
@Injectable()
export class PyqMockTitleService implements OnModuleInit {
  private readonly logger = new Logger(PyqMockTitleService.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.PYQ_RETITLE === 'off') return;
    setTimeout(() => void this.runOnce(), 45_000).unref?.();
  }

  async runOnce(): Promise<number> {
    try {
      const done = await this.prisma.appSetting.findUnique({ where: { key: MOCK_TITLES_DONE_KEY } });
      if (done) return 0;
      const changed = await retitlePyqMocks(this.prisma as any);
      await this.prisma.appSetting.upsert({
        where: { key: MOCK_TITLES_DONE_KEY },
        create: { key: MOCK_TITLES_DONE_KEY, valueJson: { changed, at: new Date().toISOString() } as any },
        update: { valueJson: { changed, at: new Date().toISOString() } as any },
      });
      if (changed > 0) this.logger.log(`student-safe mock names: ${changed} mock(s) renamed`);
      return changed;
    } catch (e) {
      this.logger.warn(`mock rename skipped: ${(e as Error).message}`);
      return 0;
    }
  }
}
