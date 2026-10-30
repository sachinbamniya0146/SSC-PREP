/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { istDateKey } from '../gamification/gamification.service';
import { NotificationsService } from './notifications.service';
import { NudgeFacts, decideNudges } from './nudge-rules';

const EVERY_MS = 30 * 60_000;
const PAGE = 300;
const MAX_PER_RUN = 20_000;

/**
 * The smart-reminder ticker. Every 30 minutes it looks at students who have used the app, asks nudge-rules.ts what each one should
 * be told right now, and delivers it (inbox + phone push). Safe with two containers: every message has a dedupeKey, so a second run
 * inserts nothing. Switch off with NUDGES_DISABLED=1.
 */
@Injectable()
export class NudgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NudgeService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notes: NotificationsService,
  ) {}

  onModuleInit() {
    if (process.env.NUDGES_DISABLED === '1') return;
    setTimeout(() => void this.tick(), 90_000).unref?.();
    this.timer = setInterval(() => void this.tick(), EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over the students. Returns how many new messages were created. Never throws. */
  async tick(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let created = 0;
    try {
      const db = this.prisma as any;
      const istDay = istDateKey(now);
      const istHour = Number(new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(11, 13));
      let cursor: string | undefined;
      let seen = 0;
      for (;;) {
        const users: any[] = await db.user.findMany({
          where: { role: 'STUDENT', isSuspended: false, OR: [{ testAttempts: { some: {} } }, { weakTopicEntries: { some: {} } }, { lastPracticeDate: { not: null } }] },
          select: {
            id: true,
            currentStreak: true,
            lastPracticeDate: true,
            targetExamId: true,
            notificationPref: true,
            testAttempts: { where: { status: 'IN_PROGRESS' }, orderBy: { startedAt: 'desc' }, take: 1, select: { id: true, startedAt: true, expiresAt: true } },
          },
          orderBy: { id: 'asc' },
          take: PAGE,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (!users.length) break;
        cursor = users[users.length - 1].id;
        seen += users.length;

        const ids = users.map((u) => u.id);
        const weak: Array<{ userId: string; _count: { _all: number } }> = await db.userWeakTopic.groupBy({ by: ['userId'], where: { userId: { in: ids }, status: 'WEAK' }, _count: { _all: true } });
        const weakBy = new Map(weak.map((w) => [w.userId, w._count._all]));

        for (const u of users) {
          const prefs = this.notes.shapePrefs(u.notificationPref);
          const weakCount = weakBy.get(u.id) ?? 0;
          let weakExample: string | null = null;
          if (weakCount > 0 && istHour === prefs.remindHourIst) {
            const row = await db.userWeakTopic.findFirst({ where: { userId: u.id, status: 'WEAK' }, orderBy: { wrongCount: 'desc' }, select: { chapterId: true } });
            if (row?.chapterId) weakExample = (await db.chapter.findUnique({ where: { id: row.chapterId }, select: { name: true } }))?.name ?? null;
          }
          const open = u.testAttempts?.[0] ?? null;
          const facts: NudgeFacts = {
            now,
            istDay,
            istHour,
            prefs,
            openAttempt: open ? { id: open.id, startedAt: new Date(open.startedAt), expiresAt: open.expiresAt ? new Date(open.expiresAt) : null } : null,
            weakCount,
            weakExample,
            currentStreak: Number(u.currentStreak) || 0,
            lastPracticeDay: u.lastPracticeDate ? istDateKey(new Date(u.lastPracticeDate)) : null,
            targetExamName: null,
          };
          for (const n of decideNudges(facts)) {
            if (await this.notes.deliverOne(u.id, n)) created += 1;
          }
        }
        if (users.length < PAGE || seen >= MAX_PER_RUN) break;
      }
      if (created > 0) this.logger.log(`nudges: ${created} new message(s) for ${seen} student(s)`);
    } catch (e: any) {
      this.logger.warn(`nudge tick failed: ${e?.message ?? e}`); if (process.env.NOTIFY_DEBUG) console.error(e);
    } finally {
      this.running = false;
    }
    return created;
  }
}
