/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { startOfDay, subDays } from 'date-fns';
import { BankUploadService } from '../bank/bank-upload.service';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private uploadService: BankUploadService,
  ) {}

  /** Get comprehensive dashboard statistics */
  async getDashboardStats(days: number = 30) {
    const since = startOfDay(subDays(new Date(), days));

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
    ]);

    const revenueByDay = revenueData.reduce((acc: Record<string, { revenue: number; count: number }>, r: any) => {
      const day = r.createdAt.toISOString().split('T')[0];
      if (!acc[day]) acc[day] = { revenue: 0, count: 0 };
      acc[day].revenue += r._sum.amountInr || 0;
      acc[day].count += r._count;
      return acc;
    }, {});

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

    const questionStats = await this.prisma.question.groupBy({
      by: ['answerVerificationStatus'],
      where: { isApproved: true },
      _count: true,
    });

    const testStats = await this.prisma.testAttempt.groupBy({
      by: ['status'],
      where: { startedAt: { gte: since } },
      _count: true,
    });

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
      revenueByDay: Object.entries(revenueByDay).map(([day, data]) => ({ day, ...data })),
      topUsers,
      questionStats,
      testStats,
    };
  }

  /** Get question statistics */
  async getQuestionStats() {
    const [byExam, bySubject, byChapter, byDifficulty, byYear, byVerification] = await Promise.all([
      this.prisma.question.groupBy({ by: ['examId'], _count: true, where: { isApproved: true } }),
      this.prisma.question.groupBy({ by: ['subjectId'], _count: true, where: { isApproved: true } }),
      this.prisma.question.groupBy({ by: ['chapterId'], _count: true, where: { isApproved: true } }),
      this.prisma.question.groupBy({ by: ['difficulty'], _count: true, where: { isApproved: true } }),
      this.prisma.question.groupBy({ by: ['year'], _count: true, where: { isApproved: true, year: { not: null } } }),
      this.prisma.question.groupBy({ by: ['answerVerificationStatus'], _count: true, where: { isApproved: true } }),
    ]);

    const examNames = await this.prisma.exam.findMany({ select: { id: true, name: true } });
    const subjectNames = await this.prisma.subject.findMany({ select: { id: true, name: true } });
    const chapterNames = await this.prisma.chapter.findMany({ select: { id: true, name: true } });

    const examMap = new Map(examNames.map((e: any) => [e.id, e.name]));
    const subjectMap = new Map(subjectNames.map((s: any) => [s.id, s.name]));
    const chapterMap = new Map(chapterNames.map((c: any) => [c.id, c.name]));

    return {
      byExam: byExam.map((e: any) => ({ exam: examMap.get(e.examId) ?? 'Unknown', count: e._count })),
      bySubject: bySubject.map((s: any) => ({ subject: subjectMap.get(s.subjectId) ?? 'Unknown', count: s._count })),
      byChapter: byChapter.map((c: any) => ({ chapter: chapterMap.get(c.chapterId) ?? 'Unknown', count: c._count })),
      byDifficulty,
      byYear: byYear.map((y: any) => ({ year: y.year, count: y._count })).sort((a: any, b: any) => b.year - a.year),
      byVerification,
    };
  }

  /** Get user activity analytics */
  async getUserActivityAnalytics(days: number = 30) {
    const since = startOfDay(subDays(new Date(), days));

    const [dailyActivity] = await Promise.all([
      this.prisma.testAttempt.groupBy({
        by: ['submittedAt'],
        where: { startedAt: { gte: since } },
        _count: true,
        orderBy: { submittedAt: 'asc' },
      }),
    ]);

    return {
      dailyActivity: dailyActivity.map((d: any) => ({
        date: d.submittedAt.toISOString().split('T')[0],
        count: d._count,
      })),
    };
  }

  // FIX (bonus grep item c — dedupe with BankUploadService's template
  // generator, see AdminHelpController for the full writeup): this used
  // to hand-list its own header set here, which had already drifted from
  // reality (missing topicId/subTopicId/paperCode, present in the real
  // parser). Now derived straight from BankUploadService.getTemplates() —
  // the same source the download routes and the upload parser both use —
  // so this documentation endpoint can never drift out of sync again.
  async getFormatExamples() {
    const templates = this.uploadService.getTemplates();
    return {
      excel: { headers: templates.excel.headers, description: templates.excel.description },
      csv: { headers: templates.csv.headers, description: templates.csv.description },
      json: { format: templates.json.headers.join(', '), description: templates.json.description },
      text: { format: 'tab-separated values with header row', headers: templates.text.headers, description: templates.text.description },
    };
  }

  /** Get AI prompts for admin help */
  async getAIPrompts() {
    return {
      generateExplanation: {
        prompt: 'Explain this SSC question in detail with step-by-step solution in both English and Hindi',
        description: 'Use to generate AI explanations for questions',
      },
      translateQuestion: {
        prompt: 'Translate this question to Hindi: {questionText}',
        description: 'Use to translate English questions to Hindi',
      },
      generateStudyPlan: {
        prompt: 'Create a study plan based on these test results: {testResults}',
        description: 'Use to generate personalized study plans',
      },
      analyzeWeakAreas: {
        prompt: 'Analyze these test results and identify weak areas: {testResults}',
        description: 'Use to identify topics needing improvement',
      },
    };
  }

  /** Get daily quiz stats */
  async getDailyQuizStats(days: number = 30) {
    const since = startOfDay(subDays(new Date(), days));

    const [dailyStats, recentQuizzes] = await Promise.all([
      this.prisma.dailyQuizAttempt.groupBy({
        by: ['submittedAt'],
        where: { submittedAt: { gte: since } },
        _count: true,
        orderBy: { submittedAt: 'asc' },
      }),
      this.prisma.dailyQuizAttempt.findMany({
        where: { submittedAt: { gte: since } },
        orderBy: { submittedAt: 'desc' },
        take: 10,
        include: { user: { select: { id: true, fullName: true, email: true } } },
      }),
    ]);

    return {
      dailyStats: dailyStats.map((d: any) => ({
        date: d.submittedAt.toISOString().split('T')[0],
        count: d._count,
      })),
      recentQuizzes: recentQuizzes.map((q: any) => ({
        userId: q.user.id,
        fullName: q.user.fullName,
        email: q.user.email,
        score: q.score,
        totalQuestions: q.totalQuestions,
        accuracyPercent: q.accuracyPercent,
        submittedAt: q.submittedAt,
      })),
    };
  }
}
