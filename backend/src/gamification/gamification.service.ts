// v1 §9 / Phase 6 — Gamification: streaks, XP, leaderboard.
// Streak logic is server-authoritative on IST midnight: a practice on consecutive
// calendar days extends the streak; a gap resets it to 1. XP is awarded on test
// submissions (10/correct) and daily quiz (8/correct), with streak multipliers.
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { cacheGet, cacheSet } from '../common/cache';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30

export function istDateKey(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

@Injectable()
export class GamificationService {
  constructor(private prisma: PrismaService) {}

  /** Server-authoritative streak update. Returns the new streak state. */
  async checkIn(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    const today = istDateKey(new Date());
    const last = user.lastPracticeDate ? istDateKey(user.lastPracticeDate) : null;

    // FIX (double-XP bug): previously, when `last === today` the streak was
    // correctly left unchanged, but execution still fell through to the
    // `xp: { increment: bonusXp } ` update below — so every additional call
    // on the same IST day (re-tapping "check in", or submitting a 2nd/3rd
    // mock test that day, since awardTestXp() also calls checkIn()) granted
    // another full daily bonus. A student submitting N tests in one day
    // could farm N× the intended once-per-day XP with no cap.
    // Fix: return early once already checked in today — no streak change,
    // no XP, no lastPracticeDate write. Callers (awardTestXp) already treat
    // this as best-effort via .catch(), so a no-op return is safe for them.
    if (last === today) {
      return {
        currentStreak: user.currentStreak,
        longestStreak: user.longestStreak,
        bonusXp: 0,
        checkedInToday: true,
      };
    }

    const yesterday = istDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const currentStreak = last === yesterday ? user.currentStreak + 1 : 1;

    const longestStreak = Math.max(user.longestStreak, currentStreak);
    // Daily check-in bonus: 5 XP + streak bonus (streak * 2, capped at 20)
    const bonusXp = 5 + Math.min(currentStreak * 2, 20);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        currentStreak,
        longestStreak,
        lastPracticeDate: new Date(),
        xp: { increment: bonusXp },
      },
    });

    return { currentStreak, longestStreak, bonusXp, checkedInToday: false };
  }

  /** Award XP for a submitted attempt (10/correct + streak multiplier on first daily). */
  async awardTestXp(userId: string, totalCorrect: number, source: 'mock' | 'daily' | 'sectional') {
    const base = source === 'daily' ? 8 : 10;
    const xpGain = totalCorrect * base;
    await this.prisma.user.update({
      where: { id: userId },
      data: { xp: { increment: xpGain } },
    });
    // Practice also counts as a daily check-in (extends streak)
    await this.checkIn(userId).catch(() => undefined);
    return xpGain;
  }

  /** My gamification state + global rank. */
  async myState(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, currentStreak: true, longestStreak: true, xp: true, coins: true, hintQuota: true, lastPracticeDate: true },
    });
    if (!user) throw new BadRequestException('User not found');

    const better = await this.prisma.user.count({ where: { xp: { gt: user.xp } } });
    const total = await this.prisma.user.count();
    return { ...user, rank: better + 1, totalUsers: total, today: istDateKey(new Date()) };
  }

  /** Leaderboard: top N by XP (weekly or all-time), plus the caller's row. Rows cached 30s; myRank computed fresh per user. */
  async leaderboard(userId: string, period: 'all' | 'weekly' = 'all', take = 50) {
    const cacheKey = `gamification:lb:${period}:${take}`;
    const cachedRows = cacheGet<{ id: string; fullName: string; xp: number; currentStreak: number; longestStreak: number; coins: number; rank: number; isMe: boolean }[]>(cacheKey);
    let rows: { id: string; fullName: string; xp: number; currentStreak: number; longestStreak: number; coins: number; rank: number; isMe: boolean }[];
    if (cachedRows) {
      rows = cachedRows;
    } else {
      const since = period === 'weekly' ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) : undefined;
      const where = since ? { xp: { gt: 0 }, updatedAt: { gte: since } } : { xp: { gt: 0 } };
      const top = await this.prisma.user.findMany({
        where,
        orderBy: { xp: 'desc' },
        take,
        select: { id: true, fullName: true, xp: true, currentStreak: true, longestStreak: true, coins: true },
      });
      rows = top.map((r, i) => ({ ...r, rank: i + 1, isMe: r.id === userId }));
      cacheSet(cacheKey, rows, 30_000);
    }
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, xp: true, currentStreak: true, longestStreak: true, coins: true },
    });
    const myRank = me ? (await this.prisma.user.count({ where: { xp: { gt: me.xp } } })) + 1 : null;
    return {
      period,
      rows,
      myRank,
      me: me ? { ...me, rank: myRank, isMe: true } : null,
    };
  }
}
