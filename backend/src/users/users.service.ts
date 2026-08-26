import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        phone: true,
        isEmailVerified: true,
        currentStreak: true,
        longestStreak: true,
        xp: true,
        coins: true,
        hintQuota: true,
        createdAt: true,
      },
    });
  }

  async updatePhone(userId: string, phone: string) {
    const normalizedPhone = phone.trim();
    if (normalizedPhone.length < 10) {
      throw new Error('Mobile number must be at least 10 digits');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { phone: normalizedPhone },
      select: { id: true, phone: true },
    });
  }

  async listActiveSessions(userId: string) {
    return this.prisma.deviceSession.findMany({
      where: { userId },
      orderBy: { lastActiveAt: 'desc' },
      take: 20,
    });
  }

  // ---- User Dashboard Analytics ----

  /**
   * Get comprehensive user dashboard with daily activity tracking
   */
  async getDashboard(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        phone: true,
        isEmailVerified: true,
        currentStreak: true,
        longestStreak: true,
        xp: true,
        coins: true,
        hintQuota: true,
        createdAt: true,
        subscriptions: {
          where: { status: 'ACTIVE' },
          select: { id: true, planId: true, endsAt: true, plan: { select: { name: true, priceInr: true } } },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Get last 30 days of activity
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Daily login activity
    const sessions = await this.prisma.deviceSession.findMany({
      where: { userId, createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true, lastActiveAt: true, userAgent: true },
      orderBy: { createdAt: 'asc' },
    });

    // Test attempts in last 30 days
    const testAttempts = await this.prisma.testAttempt.findMany({
      where: { userId, status: 'SUBMITTED', submittedAt: { gte: thirtyDaysAgo } },
      select: {
        id: true,
        score: true,
        accuracyPercent: true,
        submittedAt: true,
        testTemplate: { select: { title: true, type: true } },
      },
      orderBy: { submittedAt: 'asc' },
    });

    // Question practice activity
    const questionAttempts = await this.prisma.attemptAnswer.findMany({
      where: {
        testAttempt: { userId, status: 'SUBMITTED', submittedAt: { gte: thirtyDaysAgo } },
      },
      select: {
        isCorrect: true,
        selectedOption: true,
        timeSpentSeconds: true,
        testAttemptId: true,
        question: { select: { chapterId: true, subjectId: true } },
      },
    });

    // Build daily activity map
    const dailyActivity = new Map<string, {
      date: string;
      logins: number;
      testsTaken: number;
      questionsAnswered: number;
      correctAnswers: number;
      studyTimeSeconds: number;
      xpEarned: number;
    }>();

    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      dailyActivity.set(dateStr, {
        date: dateStr,
        logins: 0,
        testsTaken: 0,
        questionsAnswered: 0,
        correctAnswers: 0,
        studyTimeSeconds: 0,
        xpEarned: 0,
      });
    }

    // Aggregate logins by day
    for (const session of sessions) {
      const dateStr = session.createdAt.toISOString().split('T')[0];
      const day = dailyActivity.get(dateStr);
      if (day) day.logins++;
    }

    // Aggregate test attempts by day
    for (const attempt of testAttempts) {
      const dateStr = attempt.submittedAt!.toISOString().split('T')[0];
      const day = dailyActivity.get(dateStr);
      if (day) {
        day.testsTaken++;
        day.questionsAnswered += 1; // approximate
        day.studyTimeSeconds += attempt.submittedAt && attempt.testTemplate
          ? Math.floor((new Date(attempt.submittedAt).getTime() - new Date(attempt.submittedAt).getTime()) / 1000) || 0
          : 0;
      }
    }

    // Aggregate question attempts by day
    for (const qa of questionAttempts) {
      // Find the test attempt date
      const testAttempt = testAttempts.find(t => t.id === qa.testAttemptId);
      if (testAttempt) {
        const dateStr = testAttempt.submittedAt!.toISOString().split('T')[0];
        const day = dailyActivity.get(dateStr);
        if (day) {
          day.questionsAnswered++;
          if (qa.isCorrect) day.correctAnswers++;
          day.studyTimeSeconds += qa.timeSpentSeconds || 0;
        }
      }
    }

    // Overall stats
    const totalQuestionsAnswered = questionAttempts.length;
    const totalCorrectAnswers = questionAttempts.filter(q => q.isCorrect).length;
    const overallAccuracy = totalQuestionsAnswered > 0
      ? Math.round((totalCorrectAnswers / totalQuestionsAnswered) * 1000) / 10
      : 0;

    // Upcoming tests (scheduled mocks)
    const mockAccesses = await this.prisma.mockAccess.findMany({
      where: { userId, paidPacksPurchased: { gt: 0 } },
      select: {
        testTemplateId: true,
      },
    });

    // Fetch test templates for these IDs
    const testTemplateIds = mockAccesses.map(m => m.testTemplateId);
    const testTemplates = await this.prisma.testTemplate.findMany({
      where: { id: { in: testTemplateIds } },
      select: { id: true, title: true, totalQuestions: true, durationMinutes: true },
    });
    const templateMap = new Map(testTemplates.map(t => [t.id, t]));

    const upcomingTests = mockAccesses.map(u => {
      const template = templateMap.get(u.testTemplateId);
      return {
        templateId: u.testTemplateId,
        title: template?.title,
        totalQuestions: template?.totalQuestions,
        durationMinutes: template?.durationMinutes,
      };
    }).filter(u => u.title);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        currentStreak: user.currentStreak,
        longestStreak: user.longestStreak,
        xp: user.xp,
        coins: user.coins,
        hintQuota: user.hintQuota,
        joinedAt: user.createdAt,
        subscription: user.subscriptions[0] || null,
      },
      stats: {
        totalTestsTaken: testAttempts.length,
        totalQuestionsAnswered,
        overallAccuracy,
        bestScore: testAttempts.length ? Math.max(...testAttempts.map(t => t.score || 0)) : 0,
        avgScore: testAttempts.length
          ? Math.round((testAttempts.reduce((sum, t) => sum + (t.score || 0), 0) / testAttempts.length) * 10) / 10
          : 0,
        totalStudyTimeHours: Math.round((questionAttempts.reduce((sum, q) => sum + (q.timeSpentSeconds || 0), 0)) / 3600 * 10) / 10,
        activeDays: Array.from(dailyActivity.values()).filter(d => d.logins > 0 || d.testsTaken > 0).length,
      },
      dailyActivity: Array.from(dailyActivity.values()).reverse(),
      recentTests: testAttempts.slice(-5).reverse().map(t => ({
        id: t.id,
        title: t.testTemplate?.title,
        type: t.testTemplate?.type,
        score: t.score,
        accuracy: t.accuracyPercent,
        date: t.submittedAt,
      })),
      upcomingTests: upcomingTests.map(u => ({
        templateId: u.templateId,
        title: u.title,
        totalQuestions: u.totalQuestions,
        durationMinutes: u.durationMinutes,
      })),
    };
  }

  /**
   * Get weekly progress report
   */
  async getWeeklyProgress(userId: string) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [testAttempts, questionAttempts, sessions] = await Promise.all([
      this.prisma.testAttempt.findMany({
        where: { userId, status: 'SUBMITTED', submittedAt: { gte: sevenDaysAgo } },
        select: { score: true, accuracyPercent: true, submittedAt: true },
      }),
      this.prisma.attemptAnswer.findMany({
        where: {
          testAttempt: { userId, status: 'SUBMITTED', submittedAt: { gte: sevenDaysAgo } },
        },
        select: { isCorrect: true, timeSpentSeconds: true, selectedOption: true },
      }),
      this.prisma.deviceSession.findMany({
        where: { userId, createdAt: { gte: sevenDaysAgo } },
        select: { createdAt: true },
      }),
    ]);

    const daysActive = new Set(sessions.map(s => s.createdAt.toISOString().split('T')[0])).size;
    const testsThisWeek = testAttempts.length;
    const questionsThisWeek = questionAttempts.length;
    const correctThisWeek = questionAttempts.filter(q => q.isCorrect).length;
    const accuracyThisWeek = questionsThisWeek > 0
      ? Math.round((correctThisWeek / questionsThisWeek) * 1000) / 10
      : 0;
    const avgScoreThisWeek = testsThisWeek > 0
      ? Math.round((testAttempts.reduce((sum, t) => sum + (t.score || 0), 0) / testsThisWeek) * 10) / 10
      : 0;
    const studyTimeHours = Math.round((questionAttempts.reduce((sum, q) => sum + (q.timeSpentSeconds || 0), 0)) / 3600 * 10) / 10;

    return {
      period: '7 days',
      daysActive,
      testsTaken: testsThisWeek,
      questionsAnswered: questionsThisWeek,
      accuracy: accuracyThisWeek,
      avgScore: avgScoreThisWeek,
      studyTimeHours,
      streak: daysActive >= 5 ? 'Great consistency!' : daysActive >= 3 ? 'Good progress' : 'Try to be more consistent',
    };
  }

  /**
   * Get monthly activity summary
   */
  async getMonthlySummary(userId: string) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [testAttempts, questionAttempts] = await Promise.all([
      this.prisma.testAttempt.findMany({
        where: { userId, status: 'SUBMITTED', submittedAt: { gte: thirtyDaysAgo } },
        select: { score: true, accuracyPercent: true, submittedAt: true },
      }),
      this.prisma.attemptAnswer.findMany({
        where: {
          testAttempt: { userId, status: 'SUBMITTED', submittedAt: { gte: thirtyDaysAgo } },
        },
        select: { isCorrect: true, timeSpentSeconds: true, selectedOption: true },
      }),
    ]);

    const totalTests = testAttempts.length;
    const totalQuestions = questionAttempts.length;
    const totalCorrect = questionAttempts.filter(q => q.isCorrect).length;
    const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 1000) / 10 : 0;
    const bestScore = totalTests > 0 ? Math.max(...testAttempts.map(t => t.score || 0)) : 0;
    const avgScore = totalTests > 0
      ? Math.round((testAttempts.reduce((sum, t) => sum + (t.score || 0), 0) / totalTests) * 10) / 10
      : 0;
    const studyTimeHours = Math.round((questionAttempts.reduce((sum, q) => sum + (q.timeSpentSeconds || 0), 0)) / 3600 * 10) / 10;

    // Weekly breakdown
    const weeklyData = [];
    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - (i + 1) * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const weekTests = testAttempts.filter(t =>
        new Date(t.submittedAt!) >= weekStart && new Date(t.submittedAt!) <= weekEnd
      );
      // weekQuestions not used - keeping for future implementation
      // const weekQuestions = questionAttempts.filter(_q => {
      //   // We'd need to join with testAttempt to get date - simplified
      //   return false;
      // });

      weeklyData.push({
        week: `Week ${4 - i}`,
        tests: weekTests.length,
        avgScore: weekTests.length > 0
          ? Math.round((weekTests.reduce((sum, t) => sum + (t.score || 0), 0) / weekTests.length) * 10) / 10
          : 0,
      });
    }

    return {
      period: '30 days',
      totalTests,
      totalQuestions,
      accuracy,
      bestScore,
      avgScore,
      studyTimeHours,
      weeklyBreakdown: weeklyData,
    };
  }
}