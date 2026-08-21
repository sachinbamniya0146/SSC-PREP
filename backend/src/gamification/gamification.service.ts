// v1 §9 / Phase 6 — Gamification: streaks, XP, leaderboard.
// Streak logic is server-authoritative on IST midnight: a practice on consecutive
// calendar days extends the streak; a gap resets it to 1. XP is awarded on test
// submissions (10/correct) and daily quiz (8/correct), with streak multipliers.
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { cacheGet, cacheSet } from '../common/cache';
import { FriendRequestStatus } from '@prisma/client';

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

    let currentStreak = user.currentStreak;
    if (last === today) {
      // already checked in today — streak unchanged
    } else {
      const yesterday = istDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
      currentStreak = last === yesterday ? currentStreak + 1 : 1;
    }

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

    return { currentStreak, longestStreak, bonusXp, checkedInToday: last === today };
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
  async leaderboard(userId: string, period: 'all' | 'weekly' = 'all', take = 50, includeFriends = false) {
    if (includeFriends) {
      return this.friendLeaderboard(userId, period, take);
    }

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

  /** Leaderboard filtered to user + friends only */
  private async friendLeaderboard(userId: string, period: 'all' | 'weekly', take: number) {
    const friends = await this.prisma.friend.findMany({
      where: { userId },
      select: { friendId: true },
    });

    const friendIds = friends.map((f) => f.friendId);
    const relevantIds = [userId, ...friendIds];

    const since = period === 'weekly' ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) : undefined;
    const where = since
      ? { id: { in: relevantIds }, xp: { gt: 0 }, updatedAt: { gte: since } }
      : { id: { in: relevantIds }, xp: { gt: 0 } };

    const top = await this.prisma.user.findMany({
      where,
      orderBy: { xp: 'desc' },
      take,
      select: { id: true, fullName: true, xp: true, currentStreak: true, longestStreak: true, coins: true },
    });

    const myXp = top.find((u) => u.id === userId)?.xp || 0;
    const myRank = top.findIndex((u) => u.id === userId) + 1;

    return {
      period,
      rows: top.map((r, i) => ({ ...r, rank: i + 1, isMe: r.id === userId })),
      myRank: myRank > 0 ? myRank : null,
      me: top.find((r) => r.id === userId) || null,
      friendIds,
    };
  }

  /** Compare rank with friends */
  async compareWithFriends(userId: string) {
    const friends = await this.prisma.friend.findMany({
      where: { userId },
      select: { friendId: true },
    });

    const friendIds = friends.map((f) => f.friendId);
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, xp: true, currentStreak: true, longestStreak: true },
    });

    if (!me) throw new BadRequestException('User not found');

    const allRanks = await this.prisma.user.findMany({
      where: { id: { in: [userId, ...friendIds] } },
      select: { id: true, fullName: true, xp: true, currentStreak: true, longestStreak: true },
      orderBy: { xp: 'desc' },
    });

    const myRank = allRanks.findIndex((u) => u.id === userId) + 1;
    const friendRows = allRanks.map((u, i) => ({
      ...u,
      rank: i + 1,
      xpGap: u.id === userId ? 0 : (u.xp - me.xp),
      isMe: u.id === userId,
    }));

    return {
      me: { ...me, rank: myRank },
      friends: friendRows,
      friendCount: friends.length,
    };
  }

  /** Get friends list */
  async getFriends(userId: string) {
    const friends = await this.prisma.friend.findMany({
      where: { userId },
      select: { friendId: true },
    });

    const friendIds = friends.map((f) => f.friendId);

    const friendUsers = await this.prisma.user.findMany({
      where: { id: { in: friendIds } },
      select: { id: true, fullName: true, xp: true, currentStreak: true },
    });

    const friendRequests = await this.prisma.friendRequest.findMany({
      where: { receiverId: userId, status: FriendRequestStatus.PENDING },
      include: { sender: { select: { id: true, fullName: true, xp: true, currentStreak: true } } },
    });

    const myXp = (await this.prisma.user.findUnique({
      where: { id: userId },
      select: { xp: true },
    }))?.xp || 0;

    const myRank = (await this.prisma.user.count({
      where: { xp: { gt: myXp } },
    })) + 1;

    return {
      friends: friendUsers,
      pendingRequests: friendRequests.map((fr) => fr.sender),
      myRank,
    };
  }

  /** Send a friend request */
  async sendFriendRequest(userId: string, receiverId: string, message?: string) {
    if (userId === receiverId) throw new BadRequestException("Can't send request to yourself");

    const existing = await this.prisma.friendRequest.findUnique({
      where: { senderId_receiverId: { senderId: userId, receiverId } },
    });

    if (existing) {
      if (existing.status === 'ACCEPTED') return { message: "Already friends" };
      return { message: "Friend request already sent" };
    }

    return this.prisma.friendRequest.create({
      data: {
        senderId: userId,
        receiverId,
        message,
      },
    });
  }

  /** Accept/reject a friend request */
  async respondToFriendRequest(userId: string, requestId: string, action: 'accept' | 'reject') {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) throw new BadRequestException("Request not found");
    if (request.receiverId !== userId) throw new BadRequestException("Not your request");

    const status = action === 'accept' ? FriendRequestStatus.ACCEPTED : FriendRequestStatus.REJECTED;

    await this.prisma.friendRequest.update({
      where: { id: requestId },
      data: { status, respondedAt: new Date() },
    });

    if (action === 'accept') {
      await this.prisma.$transaction([
        this.prisma.friend.create({ data: { userId: request.senderId, friendId: request.receiverId } }),
        this.prisma.friend.create({ data: { userId: request.receiverId, friendId: request.senderId } }),
      ]);
    }

    return { success: true, status };
  }
}
