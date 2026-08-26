/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { cacheGet, cacheSet } from '../common/cache';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const cached = cacheGet(`user:${id}`);
    if (cached) return cached;

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
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
        darkMode: true,
        preferredLanguage: true,
        referralCode: true,
        referredByCode: true,
        freeSubFromReferral: true,
        createdAt: true,
        updatedAt: true,
        subscriptions: {
          where: { status: { not: 'CANCELLED' } },
          select: { id: true, status: true, startsAt: true, endsAt: true, planId: true, plan: { select: { name: true, priceInr: true } } },
          orderBy: { startsAt: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            testAttempts: true,
            bookmarks: true,
            referralsMade: true,
            studyPlans: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    cacheSet(`user:${id}`, user, 300_000);
    return user;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async updatePreferences(userId: string, data: { darkMode?: boolean; preferredLanguage?: string; phone?: string }) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, darkMode: true, preferredLanguage: true, phone: true },
    });
  }

  async updateOpenrouterApiKey(userId: string, apiKey: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { openrouterApiKey: apiKey },
    });

    cacheSet(`user:${userId}`, null, 0);
    return { hasOpenrouterApiKey: true };
  }

  async getStats(userId: string) {
    const [
      totalTests,
      totalQuestions,
      avgAccuracy,
      currentStreak,
      longestStreak,
      weakTopics,
    ] = await Promise.all([
      this.prisma.testAttempt.count({ where: { userId } }),
      this.prisma.attemptAnswer.count({ where: { testAttempt: { userId } } }),
      this.prisma.testAttempt.aggregate({
        where: { userId, status: 'SUBMITTED' },
        _avg: { score: true },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { currentStreak: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { longestStreak: true } }),
      this.prisma.weakTopicReport.findMany({
        where: { userId, isWeak: true },
        select: { topicId: true },
        take: 5,
      }),
    ]);

    const topicNames = await this.prisma.topic.findMany({
      where: { id: { in: weakTopics.map((t: any) => t.topicId) } },
      select: { id: true, name: true },
    });
    const topicMap = new Map(topicNames.map((t: any) => [t.id, t.name]));

    return {
      totalTests: totalTests ?? 0,
      totalQuestions: totalQuestions ?? 0,
      avgAccuracy: Math.round((avgAccuracy._avg.score ?? 0) * 100) / 100,
      currentStreak: currentStreak?.currentStreak ?? 0,
      longestStreak: longestStreak?.longestStreak ?? 0,
      weakTopics: weakTopics.map((t: any) => topicMap.get(t.topicId) ?? 'Unknown'),
    };
  }

  async getRecentActivity(userId: string, limit: number = 10) {
    return this.prisma.testAttempt.findMany({
      where: { userId },
      orderBy: { submittedAt: 'desc' },
      take: limit,
      include: {
        testTemplate: { select: { title: true, type: true } },
        _count: { select: { answers: true } },
      },
    });
  }
}
