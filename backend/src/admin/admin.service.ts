import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { startOfDay, subDays, format } from 'date-fns';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  /** Get comprehensive dashboard statistics */
  async getDashboardStats(days: number = 30) {
    const since = startOfDay(subDays(new Date(), days));
    const today = startOfDay(new Date());
    const yesterday = startOfDay(subDays(new Date(), 1));

    // Core metrics
    const [
      totalUsers,
      activeUsers,
      newUsers,
      totalRevenue,
      activeSubscriptions,
      totalTestAttempts,
      totalMockAttempts,
      totalPracticeSets,
      revenueData,
      dailyActiveUsers,
      weeklyActiveUsers,
      monthlyActiveUsers,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({
        where: { testAttempts: { some: { startedAt: { gte: since } } } },
      }),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.payment.aggregate({
        where: { status: 'SUCCESS', createdAt: { gte: since } },
        _sum: { amountInr: true },
      }),
      this.prisma.subscription.count({ where: { status: 'ACTIVE', endsAt: { gt: new Date() } } }),
      this.prisma.testAttempt.count({ where: { startedAt: { gte: since } } }),
      this.prisma.testAttempt.count({
        where: { startedAt: { gte: since }, testTemplate: { type: 'FULL_MOCK' } },
      }),
      this.prisma.questionBankSet.count({ where: { startedAt: { gte: since } } }),
      this.prisma.payment.groupBy({
        by: ['createdAt'],
        where: { status: 'SUCCESS', createdAt: { gte: since } },
        _sum: { amountInr: true },
        _count: true,
      }),
      // Daily active users (last 30 days)
      this.getDailyActiveUsers(days),
      // Weekly active users
      this.getWeeklyActiveUsers(),
      // Monthly active users
      this.getMonthlyActiveUsers(),
    ]);

    // Revenue by day for chart
    const revenueByDay = revenueData.reduce((acc: Record<string, { revenue: number; count: number }>, r: { createdAt: Date; _sum: { amountInr: number | null }; _count: number }) => {
      const day = r.createdAt.toISOString().split('T')[0];
      if (!acc[day]) acc[day] = { revenue: 0, count: 0 };
      acc[day].revenue += r._sum.amountInr || 0;
      acc[day].count += r._count;
      return acc;
    }, {});

    // Top users by activity
    const topUsers = await this.prisma.user.findMany({
      where: { testAttempts: { some: { startedAt: { gte: since } } } },
      select: {
        id: true,
        email: true,
        fullName: true,
        _count: { select: { testAttempts: true } },
      },
      orderBy: { testAttempts: { _count: 'desc' } },
      take: 10,
    });

    // Question bank practice stats
    const practiceStats = await this.prisma.questionBankSet.groupBy({
      by: ['mode', 'isCompleted'],
      where: { startedAt: { gte: since } },
      _count: true,
    });

    // Subject-wise practice distribution
    const subjectPractice = await this.prisma.questionBankSet.groupBy({
      by: ['subjectId'],
      where: { startedAt: { gte: since } },
      _count: true,
      orderBy: { _count: { subjectId: 'desc' } },
      take: 10,
    });

    const subjectIds = subjectPractice.map(s => s.subjectId).filter((id): id is string => id !== null);
    const subjects = subjectIds.length > 0
      ? await this.prisma.subject.findMany({
          where: { id: { in: subjectIds } },
          select: { id: true, name: true },
        })
      : [];
    const subjectMap = new Map(subjects.map(s => [s.id, s.name]));

    // Mock test stats
    const mockStats = await this.prisma.testAttempt.groupBy({
      by: ['testTemplateId', 'status'],
      where: { startedAt: { gte: since }, testTemplate: { isPremium: true } },
      _count: true,
    });

    // Referral stats
    const referralStats = await this.getReferralStats(since);

    // User registration by day
    const registrationData = await this.getRegistrationsByDay(since);

    // Revenue breakdown
    const [planRevenue, chapterRevenue, mockRevenue] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { status: 'SUCCESS', createdAt: { gte: since }, metadataJson: { path: ['kind'], equals: 'PLAN' } },
        _sum: { amountInr: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: { status: 'SUCCESS', createdAt: { gte: since }, metadataJson: { path: ['kind'], equals: 'CHAPTER' } },
        _sum: { amountInr: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: { status: 'SUCCESS', createdAt: { gte: since }, metadataJson: { path: ['kind'], equals: 'MOCK' } },
        _sum: { amountInr: true },
        _count: true,
      }),
    ]);

    return {
      period: { since, days },
      overview: {
        totalUsers,
        activeUsers,
        newUsers,
        revenueInr: Math.round((totalRevenue._sum?.amountInr ?? 0) * 100) / 100,
        activeSubscriptions,
        totalTestAttempts,
        totalMockAttempts,
        totalPracticeSets,
      },
      engagement: {
        dailyActiveUsers,
        weeklyActiveUsers: weeklyActiveUsers.length,
        monthlyActiveUsers: monthlyActiveUsers.length,
        dailyActiveUsersChart: dailyActiveUsers,
      },
      revenue: {
        byDay: Object.entries(revenueByDay).map(([day, data]) => ({ day, ...data })),
        byType: {
          plans: { revenue: planRevenue._sum?.amountInr || 0, count: planRevenue._count },
          chapters: { revenue: chapterRevenue._sum?.amountInr || 0, count: chapterRevenue._count },
          mocks: { revenue: mockRevenue._sum?.amountInr || 0, count: mockRevenue._count },
        },
      },
      topUsers,
      questionBankPractice: {
        byMode: practiceStats,
        bySubject: subjectPractice.map(s => ({
          subjectId: s.subjectId,
          subjectName: s.subjectId ? subjectMap.get(s.subjectId) : 'Unknown',
          count: s._count,
        })),
      },
      mockTests: mockStats,
      referrals: referralStats,
      registrations: registrationData,
    };
  }

  /** Get daily active users for the last N days */
  private async getDailyActiveUsers(days: number) {
    const since = startOfDay(subDays(new Date(), days));
    
    // Get users with any activity (test attempts, practice sets, mock tests)
    const activities = await Promise.all([
      this.prisma.testAttempt.findMany({
        where: { startedAt: { gte: since } },
        select: { userId: true, startedAt: true },
      }),
      this.prisma.questionBankSet.findMany({
        where: { startedAt: { gte: since } },
        select: { userId: true, startedAt: true },
      }),
      this.prisma.dailyQuizAttempt.findMany({
        where: { startedAt: { gte: since } },
        select: { userId: true, startedAt: true },
      }),
    ]);

    const dailyActive = new Map<string, Set<string>>();
    
    activities.flat().forEach(activity => {
      const day = format(activity.startedAt, 'yyyy-MM-dd');
      if (!dailyActive.has(day)) dailyActive.set(day, new Set());
      dailyActive.get(day)!.add(activity.userId);
    });

    const result = [];
    for (let i = 0; i < days; i++) {
      const day = format(subDays(new Date(), i), 'yyyy-MM-dd');
      const users = dailyActive.get(day) || new Set();
      result.unshift({ date: day, count: users.size });
    }

    return result;
  }

  /** Get weekly active users */
  private async getWeeklyActiveUsers() {
    const since = startOfDay(subDays(new Date(), 7));
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { testAttempts: { some: { startedAt: { gte: since } } } },
          { questionBankSets: { some: { startedAt: { gte: since } } } },
          { dailyQuizAttempts: { some: { startedAt: { gte: since } } } },
        ],
      },
      select: { id: true },
    });
    return users;
  }

  /** Get monthly active users */
  private async getMonthlyActiveUsers() {
    const since = startOfDay(subDays(new Date(), 30));
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { testAttempts: { some: { startedAt: { gte: since } } } },
          { questionBankSets: { some: { startedAt: { gte: since } } } },
          { dailyQuizAttempts: { some: { startedAt: { gte: since } } } },
        ],
      },
      select: { id: true },
    });
    return users;
  }

  /** Get referral statistics */
  private async getReferralStats(since: Date) {
    const [
      totalReferrals,
      paidReferrals,
      rewardedReferrals,
      totalReferralRevenue,
      topReferrers,
    ] = await Promise.all([
      this.prisma.referral.count({ where: { createdAt: { gte: since } } }),
      this.prisma.referral.count({ 
        where: { createdAt: { gte: since }, status: { in: ['PAIDED', 'REWARDED'] } } 
      }),
      this.prisma.referral.count({ 
        where: { createdAt: { gte: since }, status: 'REWARDED' } 
      }),
      this.prisma.payment.aggregate({
        where: { 
          status: 'SUCCESS', 
          createdAt: { gte: since },
          metadataJson: { path: ['referral'], equals: true },
        },
        _sum: { amountInr: true },
        _count: true,
      }),
      this.prisma.user.findMany({
        where: { referralCode: { not: null } },
        select: {
          id: true,
          email: true,
          fullName: true,
          referralCode: true,
          _count: { select: { referralsMade: true } },
        },
        orderBy: { referralsMade: { _count: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      totalReferrals,
      paidReferrals,
      rewardedReferrals,
      referralRevenue: totalReferralRevenue._sum?.amountInr || 0,
      topReferrers,
    };
  }

  /** Get registrations by day */
  private async getRegistrationsByDay(since: Date) {
    const users = await this.prisma.user.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
    });

    const byDay = users.reduce((acc: Record<string, number>, u) => {
      const day = format(u.createdAt, 'yyyy-MM-dd');
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(byDay).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Get user activity analytics */
  async getUserActivityAnalytics(days: number = 30) {
    const since = startOfDay(subDays(new Date(), days));
    
    const [
      activityByType,
      activityByExam,
      activityBySubject,
      streakData,
      retentionData,
    ] = await Promise.all([
      this.getActivityByType(since),
      this.getActivityByExam(since),
      this.getActivityBySubject(since),
      this.getStreakData(),
      this.getRetentionData(days),
    ]);

    return { activityByType, activityByExam, activityBySubject, streakData, retentionData };
  }

  private async getActivityByType(since: Date) {
    const [testAttempts, practiceSets, mockAttempts, dailyQuiz] = await Promise.all([
      this.prisma.testAttempt.count({ where: { startedAt: { gte: since }, testTemplate: { type: { not: 'FULL_MOCK' } } } }),
      this.prisma.questionBankSet.count({ where: { startedAt: { gte: since } } }),
      this.prisma.testAttempt.count({ where: { startedAt: { gte: since }, testTemplate: { type: 'FULL_MOCK' } } }),
      this.prisma.dailyQuizAttempt.count({ where: { startedAt: { gte: since } } }),
    ]);

    return [
      { type: 'Sectional Tests', count: testAttempts },
      { type: 'Question Bank Practice', count: practiceSets },
      { type: 'Full Mock Tests', count: mockAttempts },
      { type: 'Daily Quiz', count: dailyQuiz },
    ];
  }

  private async getActivityByExam(since: Date) {
    return this.prisma.testAttempt.groupBy({
      by: ['testTemplateId'],
      where: { startedAt: { gte: since } },
      _count: true,
      orderBy: { _count: { testTemplateId: 'desc' } },
      take: 10,
    });
  }

  private async getActivityBySubject(since: Date) {
    return this.prisma.questionBankSet.groupBy({
      by: ['subjectId'],
      where: { startedAt: { gte: since } },
      _count: true,
      orderBy: { _count: { subjectId: 'desc' } },
      take: 10,
    });
  }

  private async getStreakData() {
    const users = await this.prisma.user.findMany({
      select: { currentStreak: true, longestStreak: true },
    });

    const streaks = users.map(u => u.currentStreak);
    const avgStreak = streaks.length > 0 ? streaks.reduce((a, b) => a + b, 0) / streaks.length : 0;
    const maxStreak = Math.max(...streaks, 0);
    const usersWithStreak = streaks.filter(s => s > 0).length;

    return {
      averageStreak: Math.round(avgStreak * 10) / 10,
      maxStreak,
      usersWithActiveStreak: usersWithStreak,
      streakDistribution: this.getStreakDistribution(streaks),
    };
  }

  private getStreakDistribution(streaks: number[]) {
    const ranges = { '0': 0, '1-3': 0, '4-7': 0, '8-14': 0, '15-30': 0, '30+': 0 };
    streaks.forEach(s => {
      if (s === 0) ranges['0']++;
      else if (s <= 3) ranges['1-3']++;
      else if (s <= 7) ranges['4-7']++;
      else if (s <= 14) ranges['8-14']++;
      else if (s <= 30) ranges['15-30']++;
      else ranges['30+']++;
    });
    return Object.entries(ranges).map(([range, count]) => ({ range, count }));
  }

  private async getRetentionData(days: number) {
    const since = startOfDay(subDays(new Date(), days));
    const users = await this.prisma.user.findMany({
      where: { createdAt: { gte: since } },
      select: { id: true, createdAt: true },
    });

    // Check how many returned on day 1, day 3, day 7, day 14, day 30
    const retention = { day1: 0, day3: 0, day7: 0, day14: 0, day30: 0 };
    const total = users.length;

    for (const user of users) {
      const createdDay = startOfDay(user.createdAt);
      const day1 = new Date(createdDay.getTime() + 24 * 60 * 60 * 1000);
      const day3 = new Date(createdDay.getTime() + 3 * 24 * 60 * 60 * 1000);
      const day7 = new Date(createdDay.getTime() + 7 * 24 * 60 * 60 * 1000);
      const day14 = new Date(createdDay.getTime() + 14 * 24 * 60 * 60 * 1000);
      const day30 = new Date(createdDay.getTime() + 30 * 24 * 60 * 60 * 1000);

      const [hasDay1, hasDay3, hasDay7, hasDay14, hasDay30] = await Promise.all([
        this.prisma.testAttempt.findFirst({ where: { userId: user.id, startedAt: { gte: day1, lt: new Date(day1.getTime() + 24 * 60 * 60 * 1000) } } }),
        this.prisma.testAttempt.findFirst({ where: { userId: user.id, startedAt: { gte: day3, lt: new Date(day3.getTime() + 24 * 60 * 60 * 1000) } } }),
        this.prisma.testAttempt.findFirst({ where: { userId: user.id, startedAt: { gte: day7, lt: new Date(day7.getTime() + 24 * 60 * 60 * 1000) } } }),
        this.prisma.testAttempt.findFirst({ where: { userId: user.id, startedAt: { gte: day14, lt: new Date(day14.getTime() + 24 * 60 * 60 * 1000) } } }),
        this.prisma.testAttempt.findFirst({ where: { userId: user.id, startedAt: { gte: day30, lt: new Date(day30.getTime() + 24 * 60 * 60 * 1000) } } }),
      ]);

      if (hasDay1) retention.day1++;
      if (hasDay3) retention.day3++;
      if (hasDay7) retention.day7++;
      if (hasDay14) retention.day14++;
      if (hasDay30) retention.day30++;
    }

    return Object.entries(retention).map(([day, count]) => ({
      day,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }));
  }
}