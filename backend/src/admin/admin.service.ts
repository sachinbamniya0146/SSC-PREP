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

  // ---- Admin Help System ----

  /**
   * Get format examples for bulk question upload
   */
  async getFormatExamples() {
    return {
      excel: {
        description: 'Excel (.xlsx) format for bulk question upload',
        headers: [
          'examId*', 'subjectId*', 'chapterId*', 'topicId', 'subTopicId',
          'questionText*', 'questionTextHindi',
          'optionA*', 'optionA_Hindi',
          'optionB*', 'optionB_Hindi',
          'optionC*', 'optionC_Hindi',
          'optionD*', 'optionD_Hindi',
          'correctAnswer*', 'explanation', 'explanationHindi',
          'year', 'shift', 'paperCode', 'marks', 'negativeMarks',
          'difficulty'
        ],
        sampleRow: {
          examId: 'cgl-exam-id',
          subjectId: 'quantitative-aptitude-id',
          chapterId: 'arithmetic-id',
          topicId: 'percentage',
          subTopicId: 'percentage-basics',
          questionText: 'What is 20% of 150?',
          questionTextHindi: '150 का 20% क्या है?',
          optionA: '30',
          optionA_Hindi: '30',
          optionB: '25',
          optionB_Hindi: '25',
          optionC: '35',
          optionC_Hindi: '35',
          optionD: '40',
          optionD_Hindi: '40',
          correctAnswer: 'A',
          explanation: 'Multiply 150 by 0.20',
          explanationHindi: '150 को 0.20 से गुणा करें',
          year: 2023,
          shift: 'Shift 1',
          paperCode: 'PAPER-1',
          marks: 2,
          negativeMarks: 0.5,
          difficulty: 'EASY'
        },
        rules: [
          'Required fields are marked with *',
          'Hindi fields are optional but recommended for bilingual support',
          'correctAnswer must be A, B, C, or D',
          'difficulty must be EASY, MEDIUM, or HARD',
          'year should be a valid year (e.g., 2023, 2024)',
          'marks default to 1, negativeMarks default to 0.25',
          'examId, subjectId, chapterId must exist in the database',
          'topicId and subTopicId are optional but recommended for better organization'
        ]
      },
      csv: {
        description: 'CSV format for bulk question upload (comma-separated)',
        headers: [
          'examId*', 'subjectId*', 'chapterId*', 'topicId', 'subTopicId',
          'questionText*', 'questionTextHindi',
          'optionA*', 'optionA_Hindi',
          'optionB*', 'optionB_Hindi',
          'optionC*', 'optionC_Hindi',
          'optionD*', 'optionD_Hindi',
          'correctAnswer*', 'explanation', 'explanationHindi',
          'year', 'shift', 'paperCode', 'marks', 'negativeMarks',
          'difficulty'
        ],
        sampleRow: 'cgl-exam-id,quantitative-aptitude-id,arithmetic-id,percentage,percentage-basics,"What is 20% of 150?","150 का 20% क्या है?",30,30,25,25,35,35,40,40,A,"Multiply 150 by 0.20","150 को 0.20 से गुणा करें",2023,"Shift 1","PAPER-1",2,0.5,EASY',
        rules: [
          'Required fields are marked with *',
          'Use comma separation',
          'Wrap fields with commas or quotes in double quotes',
          'Hindi fields are optional',
          'correctAnswer must be A, B, C, or D',
          'difficulty must be EASY, MEDIUM, or HARD'
        ]
      },
      json: {
        description: 'JSON Lines format - one JSON object per line',
        structure: {
          examId: 'cgl-exam-id',
          subjectId: 'quantitative-aptitude-id',
          chapterId: 'arithmetic-id',
          topicId: 'percentage',
          subTopicId: 'percentage-basics',
          questionText: 'What is 20% of 150?',
          questionTextHindi: '150 का 20% क्या है?',
          options: [
            { key: 'A', text: '30', textHi: '30' },
            { key: 'B', text: '25', textHi: '25' },
            { key: 'C', text: '35', textHi: '35' },
            { key: 'D', text: '40', textHi: '40' }
          ],
          correctAnswer: 'A',
          explanation: 'Multiply 150 by 0.20',
          explanationHindi: '150 को 0.20 से गुणा करें',
          year: 2023,
          shift: 'Shift 1',
          paperCode: 'PAPER-1',
          marks: 2,
          negativeMarks: 0.5,
          difficulty: 'EASY'
        },
        rules: [
          'One JSON object per line (JSONL format)',
          'All fields in single object',
          'options array with key, text, textHi',
          'correctAnswer must match one of the option keys',
          'difficulty must be EASY, MEDIUM, or HARD'
        ]
      },
      text: {
        description: 'Tab-separated text format',
        headers: [
          'examId*', 'subjectId*', 'chapterId*', 'topicId', 'subTopicId',
          'questionText*', 'questionTextHindi',
          'optionA*', 'optionA_Hindi',
          'optionB*', 'optionB_Hindi',
          'optionC*', 'optionC_Hindi',
          'optionD*', 'optionD_Hindi',
          'correctAnswer*', 'explanation', 'explanationHindi',
          'year', 'shift', 'paperCode', 'marks', 'negativeMarks',
          'difficulty'
        ],
        sampleRow: 'cgl-exam-id\tquantitative-aptitude-id\tarithmetic-id\tpercentage\tpercentage-basics\tWhat is 20% of 150?\t150 का 20% क्या है?\t30\t30\t25\t25\t35\t35\t40\t40\tA\tMultiply 150 by 0.20\t150 को 0.20 से गुणा करें\t2023\tShift 1\tPAPER-1\t2\t0.5\tEASY',
        rules: [
          'Required fields are marked with *',
          'Use tabs between fields',
          'Hindi fields are optional',
          'correctAnswer must be A, B, C, or D'
        ]
      }
    };
  }

  /**
   * Get AI prompts for generating questions
   */
  async getAIPrompts() {
    return {
      systemPrompt: `You are an expert SSC exam question creator. Generate high-quality, exam-standard questions for SSC CGL, CHSL, MTS, CPO, GD, and other government exams.

CRITICAL RULES:
1. Questions MUST be bilingual (English + Hindi)
2. Exactly 4 options (A, B, C, D) with non-empty text
3. One correct answer clearly marked
4. Detailed explanation in both English and Hindi
5. Match actual SSC exam patterns, difficulty, and topic distribution
6. Include year, shift, paperCode where applicable
7. Marks: 2 for correct, -0.5 for wrong (standard SSC)
8. Difficulty: EASY, MEDIUM, or HARD

OUTPUT FORMAT: JSON object with all required fields.`,
      
      topicPrompts: {
        'percentage': {
          english: `Generate 10 SSC-level percentage questions covering: basic percentage, profit/loss, discount, simple/compound interest, population growth. Include bilingual text, 4 options each, detailed explanations.`,
          hindi: `SSC स्तर के 10 प्रतिशत प्रश्न बनाएं: बुनियादी प्रतिशत, लाभ/हानि, छूट, साधारण/चक्रवृद्धि ब्याज, जनसंख्या वृद्धि। द्विभाषी पाठ, प्रत्येक के 4 विकल्प, विस्तृत व्याख्या।`
        },
        'time-work': {
          english: `Generate 10 SSC-level Time & Work questions: pipes/cisterns, efficiency, work division, alternating work. Bilingual, 4 options, detailed explanations.`,
          hindi: `SSC स्तर के 10 समय और कार्य प्रश्न: पाइप/सिस्टर्न, दक्षता, कार्य विभाजन, बारी-बारी कार्य। द्विभाषी, 4 विकल्प, विस्तृत व्याख्या।`
        },
        'algebra': {
          english: `Generate 10 SSC-level Algebra questions: linear equations, quadratic equations, polynomials, identities, factorization. Bilingual, 4 options, detailed explanations.`,
          hindi: `SSC स्तर के 10 बीजगणित प्रश्न: रैखिक समीकरण, द्विघात समीकरण, बहुपद, सर्वसमिकाएँ, गुणनखंड। द्विभाषी, 4 विकल्प, विस्तृत व्याख्या।`
        },
        'geometry': {
          english: `Generate 10 SSC-level Geometry questions: triangles, circles, quadrilaterals, coordinate geometry, mensuration. Bilingual, 4 options, detailed explanations.`,
          hindi: `SSC स्तर के 10 ज्यामिति प्रश्न: त्रिभुज, वृत्त, चतुर्भुज, निर्देशांक ज्यामिति, क्षेत्रमिति। द्विभाषी, 4 विकल्प, विस्तृत व्याख्या।`
        },
        'trigonometry': {
          english: `Generate 10 SSC-level Trigonometry questions: ratios, identities, heights/distances, max/min values. Bilingual, 4 options, detailed explanations.`,
          hindi: `SSC स्तर के 10 त्रिकोणमिति प्रश्न: अनुपात, सर्वसमिकाएँ, ऊंचाई/दूरी, अधिकतम/न्यूनतम मान। द्विभाषी, 4 विकल्प, विस्तृत व्याख्या।`
        },
        'reasoning-analogy': {
          english: `Generate 10 SSC Reasoning Analogy questions: word analogy, number analogy, letter analogy. Bilingual, 4 options, explanations with pattern logic.`,
          hindi: `SSC रीजनिंग सादृश्यता के 10 प्रश्न: शब्द सादृश्यता, संख्या सादृश्यता, अक्षर सादृश्यता। द्विभाषी, 4 विकल्प, पैटर्न तर्क के साथ व्याख्या।`
        },
        'reasoning-series': {
          english: `Generate 10 SSC Reasoning Series questions: number series, letter series, mixed series. Bilingual, 4 options, explanations with pattern.`,
          hindi: `SSC रीजनिंग श्रृंखला के 10 प्रश्न: संख्या श्रृंखला, अक्षर श्रृंखला, मिश्रित श्रृंखला। द्विभाषी, 4 विकल्प, पैटर्न के साथ व्याख्या।`
        },
        'english-spotting': {
          english: `Generate 10 SSC English Error Spotting questions covering: subject-verb agreement, tense, preposition, article, pronoun, conjunction. Bilingual explanations.`,
          hindi: `SSC अंग्रेजी त्रुटि खोज के 10 प्रश्न: विषय-क्रिया सहमति, काल, पूर्वसर्ग, आर्टिकल, सर्वनाम, संयोजन। द्विभाषी व्याख्या।`
        },
        'english-fill': {
          english: `Generate 10 SSC English Fill in the Blanks questions: vocabulary, grammar, prepositions, phrasal verbs. Bilingual explanations.`,
          hindi: `SSC अंग्रेजी रिक्त स्थान भरें के 10 प्रश्न: शब्दावली, व्याकरण, पूर्वसर्ग, फ्रेज़ल क्रिया। द्विभाषी व्याख्या।`
        },
        'ga-history': {
          english: `Generate 10 SSC General Awareness History questions: Ancient, Medieval, Modern Indian History. Focus on SSC-repeated topics. Bilingual.`,
          hindi: `SSC सामान्य जागरूकता इतिहास के 10 प्रश्न: प्राचीन, मध्यकालीन, आधुनिक भारतीय इतिहास। SSC दोहराए गए विषयों पर ध्यान। द्विभाषी।`
        },
        'ga-polity': {
          english: `Generate 10 SSC Polity questions: Constitution, Parliament, Fundamental Rights, DPSP, Amendments. Bilingual.`,
          hindi: `SSC राजव्यवस्था के 10 प्रश्न: संविधान, संसद, मौलिक अधिकार, नीति निदेशक तत्व, संशोधन। द्विभाषी।`
        },
        'ga-geography': {
          english: `Generate 10 SSC Geography questions: Physical, Indian, World Geography. Climate, rivers, mountains, soils. Bilingual.`,
          hindi: `SSC भूगोल के 10 प्रश्न: भौतिक, भारतीय, विश्व भूगोल। जलवायु, नदियाँ, पर्वत, मिट्टी। द्विभाषी।`
        },
        'ga-science': {
          english: `Generate 10 SSC General Science questions: Physics, Chemistry, Biology (up to Class 10 level). Practical applications. Bilingual.`,
          hindi: `SSC सामान्य विज्ञान के 10 प्रश्न: भौतिकी, रसायन विज्ञान, जीव विज्ञान (कक्षा 10 तक)। व्यावहारिक अनुप्रयोग। द्विभाषी।`
        },
        'ga-current': {
          english: `Generate 10 SSC Current Affairs questions (last 6 months): Awards, Sports, Appointments, Schemes, Summits, Reports. Bilingual.`,
          hindi: `SSC समसामयिकी के 10 प्रश्न (पिछले 6 महीने): पुरस्कार, खेल, नियुक्तियाँ, योजनाएँ, शिखर सम्मेलन, रिपोर्ट। द्विभाषी।`
        }
      },

      bulkGenerationPrompt: `Generate a complete mock test paper for SSC CGL Tier 1:
- 100 questions total (25 each: Reasoning, GA, Quant, English)
- 15 minutes per section, 60 minutes total
- Multi-year distribution (2017-2024)
- Bilingual (English + Hindi)
- Exactly 4 non-empty options per question
- Detailed explanations
- Output as JSON array

Section A - General Intelligence & Reasoning (25 Qs): Analogy, Series, Coding-Decoding, Blood Relations, Direction, Venn Diagram, Syllogism, etc.

Section B - General Awareness (25 Qs): History, Polity, Geography, Science, Current Affairs, Static GK

Section C - Quantitative Aptitude (25 Qs): Arithmetic, Algebra, Geometry, Trigonometry, Data Interpretation

Section D - English Comprehension (25 Qs): Error Spotting, Fill in Blanks, Synonyms/Antonyms, Idioms, Reading Comprehension, Cloze Test`,

      validationPrompt: `Validate this question for SSC exam standards:
1. Is it bilingual (English + Hindi)?
2. Exactly 4 options with non-empty text?
3. Correct answer is one of A/B/C/D?
4. Explanation provided in both languages?
5. Difficulty appropriate (EASY/MEDIUM/HARD)?
6. Topic matches the subject/chapter?
7. Year/shift/paperCode realistic?
8. No duplicate questions?
9. Marks: 2, Negative: 0.5?

Return: { valid: true/false, issues: [], suggestions: [] }`
    };
  }

  /**
   * Generate Excel template for download
   */
  generateExcelTemplate(): Buffer {
    // We'll create a simple XLSX buffer using a basic approach
    // In production, use xlsx library to create proper Excel file
    const headers = [
      'examId*', 'subjectId*', 'chapterId*', 'topicId', 'subTopicId',
      'questionText*', 'questionTextHindi',
      'optionA*', 'optionA_Hindi',
      'optionB*', 'optionB_Hindi',
      'optionC*', 'optionC_Hindi',
      'optionD*', 'optionD_Hindi',
      'correctAnswer*', 'explanation', 'explanationHindi',
      'year', 'shift', 'paperCode', 'marks', 'negativeMarks',
      'difficulty'
    ];
    
    const sampleRow = [
      'cgl-exam-id', 'quantitative-aptitude-id', 'arithmetic-id', 'percentage', 'percentage-basics',
      'What is 20% of 150?', '150 का 20% क्या है?',
      '30', '30',
      '25', '25',
      '35', '35',
      '40', '40',
      'A', 'Multiply 150 by 0.20', '150 को 0.20 से गुणा करें',
      '2023', 'Shift 1', 'PAPER-1', '2', '0.5',
      'EASY'
    ];

    // Create CSV content (can be opened in Excel)
    const lines = [
      headers.join(','),
      sampleRow.map(cell => cell.includes(',') ? `"${cell}"` : cell).join(',')
    ];
    
    return Buffer.from(lines.join('\n'), 'utf-8');
  }

  /**
   * Generate CSV template for download
   */
  generateCSVTemplate(): Buffer {
    const headers = [
      'examId*', 'subjectId*', 'chapterId*', 'topicId', 'subTopicId',
      'questionText*', 'questionTextHindi',
      'optionA*', 'optionA_Hindi',
      'optionB*', 'optionB_Hindi',
      'optionC*', 'optionC_Hindi',
      'optionD*', 'optionD_Hindi',
      'correctAnswer*', 'explanation', 'explanationHindi',
      'year', 'shift', 'paperCode', 'marks', 'negativeMarks',
      'difficulty'
    ];
    
    const sampleRow = [
      'cgl-exam-id', 'quantitative-aptitude-id', 'arithmetic-id', 'percentage', 'percentage-basics',
      'What is 20% of 150?', '150 का 20% क्या है?',
      '30', '30',
      '25', '25',
      '35', '35',
      '40', '40',
      'A', 'Multiply 150 by 0.20', '150 को 0.20 से गुणा करें',
      '2023', 'Shift 1', 'PAPER-1', '2', '0.5',
      'EASY'
    ];

    const lines = [
      headers.join(','),
      sampleRow.map(cell => cell.includes(',') || cell.includes('"') ? `"${cell.replace(/"/g, '""')}"` : cell).join(',')
    ];
    
    return Buffer.from(lines.join('\n'), 'utf-8');
  }

  /**
   * Generate JSON template for download
   */
  generateJSONTemplate(): Buffer {
    const template = {
      examId: 'cgl-exam-id',
      subjectId: 'quantitative-aptitude-id',
      chapterId: 'arithmetic-id',
      topicId: 'percentage',
      subTopicId: 'percentage-basics',
      questionText: 'What is 20% of 150?',
      questionTextHindi: '150 का 20% क्या है?',
      options: [
        { key: 'A', text: '30', textHi: '30' },
        { key: 'B', text: '25', textHi: '25' },
        { key: 'C', text: '35', textHi: '35' },
        { key: 'D', text: '40', textHi: '40' }
      ],
      correctAnswer: 'A',
      explanation: 'Multiply 150 by 0.20',
      explanationHindi: '150 को 0.20 से गुणा करें',
      year: 2023,
      shift: 'Shift 1',
      paperCode: 'PAPER-1',
      marks: 2,
      negativeMarks: 0.5,
      difficulty: 'EASY'
    };

    return Buffer.from(JSON.stringify(template, null, 2), 'utf-8');
  }

  /**
   * Generate Text template for download
   */
  generateTextTemplate(): Buffer {
    const headers = [
      'examId*', 'subjectId*', 'chapterId*', 'topicId', 'subTopicId',
      'questionText*', 'questionTextHindi',
      'optionA*', 'optionA_Hindi',
      'optionB*', 'optionB_Hindi',
      'optionC*', 'optionC_Hindi',
      'optionD*', 'optionD_Hindi',
      'correctAnswer*', 'explanation', 'explanationHindi',
      'year', 'shift', 'paperCode', 'marks', 'negativeMarks',
      'difficulty'
    ];
    
    const sampleRow = [
      'cgl-exam-id', 'quantitative-aptitude-id', 'arithmetic-id', 'percentage', 'percentage-basics',
      'What is 20% of 150?', '150 का 20% क्या है?',
      '30', '30',
      '25', '25',
      '35', '35',
      '40', '40',
      'A', 'Multiply 150 by 0.20', '150 को 0.20 से गुणा करें',
      '2023', 'Shift 1', 'PAPER-1', '2', '0.5',
      'EASY'
    ];

    const lines = [
      headers.join('\t'),
      sampleRow.join('\t')
    ];
    
    return Buffer.from(lines.join('\n'), 'utf-8');
  }
}