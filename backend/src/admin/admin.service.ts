/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { startOfDay, subDays } from 'date-fns';
import * as XLSX from 'xlsx';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

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

  /** Get format examples for admin help */
  async getFormatExamples() {
    return {
      excel: {
        headers: ['examId*', 'subjectId*', 'chapterId*', 'questionText*', 'optionA*', 'optionB*', 'optionC*', 'optionD*', 'correctAnswer*'],
        description: 'Excel template with columns for exam, subject, chapter, question, options, and correct answer',
      },
      csv: {
        headers: ['examId*', 'subjectId*', 'chapterId*', 'questionText*', 'optionA*', 'optionB*', 'optionC*', 'optionD*', 'correctAnswer*'],
        description: 'CSV template with comma-separated values',
      },
      json: {
        format: '{ examId: string, subjectId: string, chapterId: string, questionText: string, options: [{key: string, text: string}], correctAnswer: string }[]',
        description: 'JSON array of question objects',
      },
      text: {
        format: 'tab-separated values with header row',
        description: 'Text file with tab-separated columns',
      },
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

  /** Generate Excel template */
  generateExcelTemplate(): Buffer {
    const headers = ['examId*', 'subjectId*', 'chapterId*', 'questionText*', 'questionTextHindi', 'optionA*', 'optionA_Hindi', 'optionB*', 'optionB_Hindi', 'optionC*', 'optionC_Hindi', 'optionD*', 'optionD_Hindi', 'correctAnswer*', 'explanation', 'explanationHindi', 'year', 'shift', 'marks', 'negativeMarks', 'difficulty'];
    const sampleRow = ['cgl', 'quantitative-aptitude', 'percentage', 'What is 20% of 150?', '150 का 20% क्या है?', '30', '30', '25', '25', '35', '35', '40', '40', 'A', '20% of 150 = 30', '150 का 20% = 30', '2023', 'Shift 1', '2', '0.5', 'EASY'];

    const workbook = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
    XLSX.utils.book_append_sheet(workbook, ws, 'Template');

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  /** Generate CSV template */
  generateCSVTemplate(): Buffer {
    const headers = 'examId*,subjectId*,chapterId*,questionText*,questionTextHindi,optionA*,optionA_Hindi,optionB*,optionB_Hindi,optionC*,optionC_Hindi,optionD*,optionD_Hindi,correctAnswer*,explanation,explanationHindi,year,shift,marks,negativeMarks,difficulty';
    const sampleRow = 'cgl,quantitative-aptitude,percentage,What is 20% of 150?,150 का 20% क्या है?,30,30,25,25,35,35,40,40,A,20% of 150 = 30,150 का 20% = 30,2023,Shift 1,2,0.5,EASY';

    return Buffer.from(`${headers}\n${sampleRow}`, 'utf-8');
  }

  /** Generate JSON template */
  generateJSONTemplate(): Buffer {
    const template = [{
      examId: 'cgl',
      subjectId: 'quantitative-aptitude',
      chapterId: 'percentage',
      questionText: 'What is 20% of 150?',
      questionTextHindi: '150 का 20% क्या है?',
      options: [
        { key: 'A', text: '30', textHi: '30' },
        { key: 'B', text: '25', textHi: '25' },
        { key: 'C', text: '35', textHi: '35' },
        { key: 'D', text: '40', textHi: '40' },
      ],
      correctAnswer: 'A',
      explanation: '20% of 150 = 30',
      explanationHindi: '150 का 20% = 30',
      year: 2023,
      shift: 'Shift 1',
      marks: 2,
      negativeMarks: 0.5,
      difficulty: 'EASY',
    }];

    return Buffer.from(JSON.stringify(template, null, 2), 'utf-8');
  }

  /** Generate text template */
  generateTextTemplate(): Buffer {
    const headers = 'examId\tsubjectId\tchapterId\tquestionText\tquestionTextHindi\toptionA\toptionB\toptionC\toptionD\tcorrectAnswer\texplanation\texplanationHindi\tyear\tshift\tmarks\tnegativeMarks\tdifficulty';
    const sampleRow = 'cgl\tquantitative-aptitude\tpercentage\tWhat is 20% of 150?\t150 का 20% क्या है?\t30\t25\t35\t40\tA\t20% of 150 = 30\t150 का 20% = 30\t2023\tShift 1\t2\t0.5\tEASY';

    return Buffer.from(`${headers}\n${sampleRow}`, 'utf-8');
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
