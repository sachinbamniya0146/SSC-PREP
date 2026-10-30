/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { DEFAULT_PREFS, NudgePrefs, cleanHour } from './nudge-rules';

export interface AudienceInput {
  type: 'ALL' | 'TARGET_EXAM' | 'INACTIVE' | 'HAS_WEAK';
  examId?: string;
  days?: number;
}

const AUDIENCE_CAP = 50_000;
const SAFE_URL = /^\/[A-Za-z0-9\-_/?=&.%#]*$/;

/** Only in-app paths are allowed as a link target (no external URL, no javascript:). */
export function cleanUrl(u: unknown): string {
  const s = typeof u === 'string' ? u.trim() : '';
  return s && SAFE_URL.test(s) && !s.startsWith('//') ? s.slice(0, 200) : '/dashboard';
}

/** Prisma `where` for a set of students. Pure, so the admin preview count and the real send always agree. */
export function audienceWhere(a: AudienceInput, now = new Date()): Record<string, any> {
  const where: Record<string, any> = { role: 'STUDENT', isSuspended: false };
  if (a.type === 'TARGET_EXAM') {
    if (!a.examId) throw new BadRequestException('Choose an exam for this audience');
    where.targetExamId = a.examId;
  } else if (a.type === 'INACTIVE') {
    const days = Math.max(1, Math.min(365, Number(a.days) || 3));
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    where.OR = [{ lastPracticeDate: null }, { lastPracticeDate: { lt: cutoff } }];
  } else if (a.type === 'HAS_WEAK') {
    where.weakTopicEntries = { some: { status: 'WEAK' } };
  }
  return where;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  // ---------------------------------------------------------------- inbox (student)
  async list(userId: string, limit = 40) {
    const take = Math.max(1, Math.min(100, Math.floor(Number(limit)) || 40));
    const [items, unread] = await Promise.all([
      this.db.userNotification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take }),
      this.db.userNotification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unread };
  }

  async unreadCount(userId: string) {
    return { unread: await this.db.userNotification.count({ where: { userId, readAt: null } }) };
  }

  async markRead(userId: string, ids: string[]) {
    const r = await this.db.userNotification.updateMany({ where: { userId, id: { in: ids }, readAt: null }, data: { readAt: new Date() } });
    return { updated: r.count };
  }

  async markAllRead(userId: string) {
    const r = await this.db.userNotification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { updated: r.count };
  }

  // ---------------------------------------------------------------- reminder switches
  async getPrefs(userId: string) {
    const row = await this.db.notificationPref.findUnique({ where: { userId } });
    return this.shapePrefs(row);
  }

  shapePrefs(row: any) {
    const p: NudgePrefs & { news: boolean } = {
      ...DEFAULT_PREFS,
      news: true,
      ...(row
        ? {
            weakTopic: row.weakTopic !== false,
            streak: row.streak !== false,
            tests: row.tests !== false,
            news: row.news !== false,
            remindHourIst: cleanHour(row.remindHourIst),
            pausedUntil: row.pausedUntil ? new Date(row.pausedUntil) : null,
          }
        : {}),
    };
    const pausedNow = !!p.pausedUntil && p.pausedUntil.getTime() > Date.now();
    return { ...p, pausedUntil: pausedNow ? p.pausedUntil : null, pushAvailable: this.push.pushEnabled };
  }

  async updatePrefs(userId: string, d: { weakTopic?: boolean; streak?: boolean; tests?: boolean; news?: boolean; remindHourIst?: number; pauseDays?: number }) {
    const data: Record<string, any> = {};
    for (const k of ['weakTopic', 'streak', 'tests', 'news'] as const) if (typeof d[k] === 'boolean') data[k] = d[k];
    if (d.remindHourIst !== undefined) data.remindHourIst = cleanHour(d.remindHourIst);
    if (d.pauseDays !== undefined) data.pausedUntil = d.pauseDays > 0 ? new Date(Date.now() + d.pauseDays * 86_400_000) : null;
    const row = await this.db.notificationPref.upsert({ where: { userId }, update: data, create: { userId, ...data } });
    return this.shapePrefs(row);
  }

  // ---------------------------------------------------------------- delivery
  /**
   * Put one message in a student's inbox (once per dedupeKey) and, when `push` is true, on their phone.
   * Returns true when a NEW message was stored. Never throws.
   */
  async deliverOne(userId: string, m: { kind: string; title: string; body: string; url?: string; dedupeKey: string; push: boolean }): Promise<boolean> {
    try {
      const r = await this.db.userNotification.createMany({
        data: [{ userId, kind: m.kind, title: m.title, body: m.body, url: cleanUrl(m.url), dedupeKey: m.dedupeKey }],
        skipDuplicates: true,
      });
      if (!r.count) return false;
      if (m.push) await this.push.sendToUsers([userId], { title: m.title, body: m.body, url: cleanUrl(m.url), tag: m.kind.toLowerCase() });
      return true;
    } catch (e: any) {
      this.logger.warn(`deliverOne failed for ${userId}: ${e?.message ?? e}`);
      return false;
    }
  }

  // ---------------------------------------------------------------- admin: call students
  async audienceCount(a: AudienceInput) {
    const where = audienceWhere(a);
    const [students, devices] = await Promise.all([
      this.db.user.count({ where }),
      this.db.pushSubscription.count({ where: { user: where } }),
    ]);
    return { students, devices, pushAvailable: this.push.pushEnabled };
  }

  async adminSend(d: { title: string; body: string; url?: string; audience: AudienceInput }) {
    const title = String(d.title || '').trim();
    const body = String(d.body || '').trim();
    if (!title || !body) throw new BadRequestException('Title and message are required');
    const where = audienceWhere(d.audience);
    const url = cleanUrl(d.url);
    const batch = randomUUID();
    let reached = 0;
    let pushed = 0;
    let failed = 0;
    let cursor: string | undefined;
    let seen = 0;
    for (;;) {
      const users: Array<{ id: string }> = await this.db.user.findMany({
        where,
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (!users.length) break;
      cursor = users[users.length - 1].id;
      seen += users.length;
      const ids = users.map((u) => u.id);
      // students who switched "news" off still get nothing from admin sends
      const off: Array<{ userId: string }> = await this.db.notificationPref.findMany({ where: { userId: { in: ids }, news: false }, select: { userId: true } });
      const offSet = new Set(off.map((o) => o.userId));
      const targets = ids.filter((id) => !offSet.has(id));
      if (targets.length) {
        const r = await this.db.userNotification.createMany({
          data: targets.map((userId) => ({ userId, kind: 'ADMIN', title, body, url, dedupeKey: `admin:${batch}` })),
          skipDuplicates: true,
        });
        reached += r.count;
        const p = await this.push.sendToUsers(targets, { title, body, url, tag: 'admin' });
        pushed += p.sent;
        failed += p.failed;
      }
      if (users.length < 500 || seen >= AUDIENCE_CAP) break;
    }
    return { students: reached, pushed, failed, pushAvailable: this.push.pushEnabled, batch };
  }
}
