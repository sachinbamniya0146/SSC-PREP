/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Fields safe to return to the client — never selects passwordHash or the
// raw openrouterApiKey.
const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  phone: true,
  fullName: true,
  role: true,
  isEmailVerified: true,
  avatarUrl: true,
  currentStreak: true,
  longestStreak: true,
  xp: true,
  coins: true,
  hintQuota: true,
  darkMode: true,
  preferredLanguage: true,
  referralCode: true,
  createdAt: true,
} as const;

const DONE_STATUSES = ['SUBMITTED', 'AUTO_SUBMITTED'] as const;

/**
 * User profile, preferences, and personal-OpenRouter-key management.
 * Backs UsersController's /users/me* routes.
 */
@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async findById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PUBLIC_USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Lightweight profile-page stats: gamification counters + test performance. */
  async getStats(userId: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { currentStreak: true, longestStreak: true, xp: true, coins: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const [attempts, quizAttempts, bookmarksCount, notesCount] = await Promise.all([
      this.prisma.testAttempt.findMany({
        where: { userId, status: { in: [...DONE_STATUSES] } },
        select: { score: true, accuracyPercent: true },
      }),
      this.prisma.dailyQuizAttempt.count({ where: { userId, submittedAt: { not: null } } }),
      this.prisma.bookmark.count({ where: { userId } }),
      this.prisma.userNote.count({ where: { userId } }),
    ]);

    const testsTaken = attempts.length;
    const avgScore = testsTaken
      ? Math.round((attempts.reduce((s, a) => s + (a.score ?? 0), 0) / testsTaken) * 10) / 10
      : 0;
    const avgAccuracy = testsTaken
      ? Math.round((attempts.reduce((s, a) => s + (a.accuracyPercent ?? 0), 0) / testsTaken) * 10) / 10
      : 0;

    return {
      currentStreak: user.currentStreak,
      longestStreak: user.longestStreak,
      xp: user.xp,
      coins: user.coins,
      testsTaken,
      avgScore,
      avgAccuracy,
      dailyQuizzesTaken: quizAttempts,
      bookmarksCount,
      notesCount,
    };
  }

  /** Merged, most-recent-first feed of the user's mock/sectional test + daily quiz attempts. */
  async getRecentActivity(userId: string, limit = 10): Promise<any[]> {
    const [tests, quizzes] = await Promise.all([
      this.prisma.testAttempt.findMany({
        where: { userId, status: { in: [...DONE_STATUSES] }, submittedAt: { not: null } },
        select: {
          id: true,
          score: true,
          accuracyPercent: true,
          submittedAt: true,
          testTemplate: { select: { title: true } },
        },
        orderBy: { submittedAt: 'desc' },
        take: limit,
      }),
      this.prisma.dailyQuizAttempt.findMany({
        where: { userId, submittedAt: { not: null } },
        select: { id: true, score: true, submittedAt: true },
        orderBy: { submittedAt: 'desc' },
        take: limit,
      }),
    ]);

    const merged = [
      ...tests.map((a) => ({
        type: 'TEST' as const,
        id: a.id,
        title: a.testTemplate?.title ?? 'Test',
        score: a.score,
        accuracyPercent: a.accuracyPercent,
        occurredAt: a.submittedAt,
      })),
      ...quizzes.map((a) => ({
        type: 'DAILY_QUIZ' as const,
        id: a.id,
        title: 'Daily Quiz',
        score: a.score,
        accuracyPercent: null,
        occurredAt: a.submittedAt,
      })),
    ];

    merged.sort((a, b) => new Date(b.occurredAt as Date).getTime() - new Date(a.occurredAt as Date).getTime());
    return merged.slice(0, limit);
  }

  /**
   * Partial preference update. Also used by PUT /users/me/phone (passes only
   * `{ phone }`), so phone uniqueness is checked here whenever it's present
   * — mirrors the same check auth.service.ts does at signup.
   */
  async updatePreferences(
    userId: string,
    body: { darkMode?: boolean; preferredLanguage?: string; phone?: string },
  ) {
    const data: Record<string, unknown> = {};

    if (body.darkMode !== undefined) data.darkMode = body.darkMode;
    if (body.preferredLanguage !== undefined) data.preferredLanguage = body.preferredLanguage;

    if (body.phone !== undefined) {
      const normalizedPhone = body.phone.trim();
      const existingPhone = await this.prisma.user.findFirst({
        where: { phone: normalizedPhone, id: { not: userId } },
      });
      if (existingPhone) throw new ConflictException('This mobile number is already registered');
      data.phone = normalizedPhone;
    }

    if (Object.keys(data).length === 0) {
      return this.findById(userId);
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: PUBLIC_USER_SELECT,
    });
    return user;
  }

  /** Save (or clear, when apiKey is null) the user's personal OpenRouter key. */
  async updateOpenrouterApiKey(userId: string, apiKey: string | null) {
    const trimmed = apiKey?.trim() || null;
    await this.prisma.user.update({
      where: { id: userId },
      data: { openrouterApiKey: trimmed },
    });
    return this.getOpenrouterApiKeyStatus(userId);
  }

  /** Whether a personal key is saved, plus a masked preview — never the raw key. */
  async getOpenrouterApiKeyStatus(userId: string): Promise<{ hasOpenrouterApiKey: boolean; maskedKey: string | null }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { openrouterApiKey: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const key = user.openrouterApiKey;
    if (!key) return { hasOpenrouterApiKey: false, maskedKey: null };

    const maskedKey = key.length <= 8 ? '••••' : `${key.slice(0, 4)}${'•'.repeat(6)}${key.slice(-4)}`;
    return { hasOpenrouterApiKey: true, maskedKey };
  }
}
