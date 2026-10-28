// v1 §9 / Phase 6 — Gamification: streaks, XP, leaderboard.
// Streak logic is server-authoritative on IST midnight: a practice on consecutive
// calendar days extends the streak; a gap resets it to 1. XP is awarded on test
// submissions (10/correct) and daily quiz (8/correct), with streak multipliers.
import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

    // FIX (double-XP bug, single-request case): when `last === today` the
    // streak was correctly left unchanged, but execution still fell through
    // to the `xp: { increment: bonusXp } ` update below — so every
    // additional call on the same IST day (re-tapping "check in", or
    // submitting a 2nd/3rd mock test that day, since awardTestXp() also
    // calls checkIn()) granted another full daily bonus. Returning early
    // here handles that for one request at a time.
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

    // FIX (double-XP bug, RACE-CONDITION case — the check above alone
    // doesn't close this window): two requests for the same user landing
    // close together (double-tap on "check in", or two mock-test
    // submissions firing awardTestXp() -> checkIn() almost simultaneously)
    // can both run the `findUnique` above BEFORE either has written
    // lastPracticeDate. Both then see `last !== today`, both compute a
    // fresh bonusXp, and both call `update()` — granting the daily bonus
    // twice. The single-request early-return above cannot catch this,
    // because by the time either request reaches this line, the other one
    // may not have committed yet.
    //
    // Fix: the actual DB write is now a CONDITIONAL updateMany — it only
    // succeeds if lastPracticeDate in the database still matches what this
    // request read (or is null, for a first-ever check-in). Postgres
    // executes that WHERE-guarded UPDATE atomically, so only ONE of two
    // racing requests can ever have its condition still hold true at write
    // time; the other's `count` comes back 0 and it must re-read the
    // now-updated row instead of granting a second bonus.
    const claim = await this.prisma.user.updateMany({
      where: {
        id: userId,
        // Matches Prisma's null-or-exact-date semantics: if we read no
        // lastPracticeDate, only claim if it's still null in the DB; if we
        // read a date, only claim if it hasn't changed since.
        lastPracticeDate: user.lastPracticeDate ?? null,
      },
      data: {
        currentStreak,
        longestStreak,
        lastPracticeDate: new Date(),
        xp: { increment: bonusXp },
      },
    });

    if (claim.count === 0) {
      // Someone else (a racing request for this same user) already claimed
      // today's check-in between our read and our write. Re-fetch the
      // now-current state instead of granting a second bonus.
      const fresh = await this.prisma.user.findUnique({ where: { id: userId } });
      return {
        currentStreak: fresh?.currentStreak ?? currentStreak,
        longestStreak: fresh?.longestStreak ?? longestStreak,
        bonusXp: 0,
        checkedInToday: true,
      };
    }

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

    const better = await this.prisma.user.count({ where: { xp: { gt: user.xp }, isSuspended: false } });
    const total = await this.prisma.user.count({ where: { isSuspended: false } });
    const today = istDateKey(new Date());
    // Daily-goal progress: questions answered since 00:00 IST today (tests,
    // practice sets and sectionals all write AttemptAnswer rows). Best effort —
    // a failure here must never break the dashboard.
    let todayAnswered = 0;
    try {
      const dayStart = new Date(`${today}T00:00:00+05:30`);
      todayAnswered = await this.prisma.attemptAnswer.count({
        where: { testAttempt: { userId, startedAt: { gte: dayStart } }, selectedOption: { not: null } },
      });
    } catch {
      todayAnswered = 0;
    }
    return { ...user, rank: better + 1, totalUsers: total, today, todayAnswered };
  }

  /**
   * Leaderboard: top N by XP (weekly or all-time), plus the caller's row. Rows cached 30s; myRank computed fresh per user.
   * scope "state" = only students of the caller's own state (State leaderboard). Suspended students never appear.
   * Names of other students are shortened ("Rahul S.") - this page is visible to every student.
   */
  async leaderboard(userId: string, period: 'all' | 'weekly' = 'all', take = 50, scope: 'india' | 'state' = 'india') {
    const meRow = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, xp: true, currentStreak: true, longestStreak: true, coins: true, state: true },
    });
    const stateName = scope === 'state' ? meRow?.state ?? null : null;
    if (scope === 'state' && !stateName) {
      // the student has not chosen a state yet: the page shows a "choose your state" prompt instead of an empty list
      return { period, scope, state: null, needState: true, rows: [], myRank: null, me: null };
    }

    // BUGFIX: this cache key has no userId in it (by design - the top-N list itself is identical for every viewer, so it's
    // shared across users for 30s to cut DB load). The bug was baking `isMe` into the CACHED rows: whichever user's request
    // happened to be the one that missed the cache and recomputed it had their id burned into every row's `isMe` flag for
    // the next 30s. Fix: cache only the anonymous ranking (no isMe), and stamp isMe fresh per-request after reading from cache.
    type BaseRow = { id: string; fullName: string; xp: number; currentStreak: number; longestStreak: number; coins: number; state: string | null; rank: number };
    const cacheKey = `gamification:lb2:${period}:${take}:${stateName ?? 'india'}`;
    const cachedRows = cacheGet<BaseRow[]>(cacheKey);
    let baseRows: BaseRow[];
    if (cachedRows) {
      baseRows = cachedRows;
    } else {
      const since = period === 'weekly' ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) : undefined;
      const where: Prisma.UserWhereInput = { xp: { gt: 0 }, isSuspended: false };
      if (since) where.updatedAt = { gte: since };
      if (stateName) where.state = stateName;
      const top = await this.prisma.user.findMany({
        where,
        orderBy: { xp: 'desc' },
        take,
        select: { id: true, fullName: true, xp: true, currentStreak: true, longestStreak: true, coins: true, state: true },
      });
      baseRows = top.map((r, i) => ({ ...r, fullName: shortLeaderName(r.fullName), rank: i + 1 }));
      cacheSet(cacheKey, baseRows, 30_000);
    }
    const rows = baseRows.map((r) => ({ ...r, isMe: r.id === userId }));
    const rankWhere: Prisma.UserWhereInput = { isSuspended: false };
    if (stateName) rankWhere.state = stateName;
    const myRank = meRow ? (await this.prisma.user.count({ where: { ...rankWhere, xp: { gt: meRow.xp } } })) + 1 : null;
    return {
      period,
      scope,
      state: stateName,
      needState: false,
      rows,
      myRank,
      me: meRow ? { ...meRow, fullName: meRow.fullName, rank: myRank, isMe: true } : null,
    };
  }
}

/** "Rahul Sharma" -> "Rahul S."  (the leaderboard is visible to every student). */
export function shortLeaderName(full: string): string {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Student';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
