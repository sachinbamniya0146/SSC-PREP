import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TestType } from '@prisma/client';

interface MockTestConfig {
  examId: string;
  templateId?: string;
  type: TestType;
  durationMinutes: number;
  totalQuestions?: number;
  totalMarks?: number;
  sections?: { name: string; subjectId: string; questions: number; marks: number; durationMinutes?: number }[];
}

interface MockTestResult {
  testAttemptId: string;
  score: number;
  totalCorrect: number;
  totalWrong: number;
  totalSkipped: number;
  accuracyPercent: number;
  rank?: number;
  percentile?: number;
  timeTakenSeconds: number;
  chapterAnalysis: ChapterAnalysis[];
  weakChapters: WeakChapter[];
  strongChapters: StrongChapter[];
}

interface ChapterAnalysis {
  chapterId: string;
  chapterName: string;
  subjectName: string;
  totalQuestions: number;
  attempted: number;
  correct: number;
  accuracy: number;
  timeSpent: number;
  isWeak: boolean;
}

interface WeakChapter {
  chapterId: string;
  chapterName: string;
  subjectName: string;
  accuracy: number;
  questionsMissed: number;
  recommendedPracticeCount: number;
}

interface StrongChapter {
  chapterId: string;
  chapterName: string;
  subjectName: string;
  accuracy: number;
}

@Injectable()
export class MockTestService {
  constructor(private prisma: PrismaService) {}

  // ==========================================
  // 1. LIST ALL SSC EXAMS WITH MOCK TESTS
  // ==========================================
  async getAllExamsWithMocks(userId?: string) {
    const exams = await this.prisma.exam.findMany({
      where: { isActive: true },
      include: {
        patterns: { where: { isActive: true }, take: 1 },
        testTemplates: {
          where: { isActive: true, type: { in: ['FULL_MOCK', 'MINI_MOCK', 'PREVIOUS_YEAR', 'SHIFT_WISE', 'YEAR_WISE'] } },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    let userMockAccess: Map<string, any> = new Map();
    if (userId) {
      const access = await this.prisma.mockAccess.findMany({ where: { userId } });
      userMockAccess = new Map(access.map(a => [a.testTemplateId, a]));
    }

    return exams.map(exam => {
      const pattern = exam.patterns && exam.patterns.length > 0 ? exam.patterns[0] : null;
      const templates = exam.testTemplates.map((t: any) => {
        const access = userMockAccess.get(t.id);
        const isFreeType = t.type === 'PREVIOUS_YEAR' || t.type === 'YEAR_WISE';
        const used = access?.mocksUsed ?? 0;
        const freeAllowed = 2;
        const locked = !isFreeType && t.isPremium && used >= freeAllowed;
        
        return {
          id: t.id,
          title: t.title,
          description: t.description,
          type: t.type,
          durationMinutes: t.durationMinutes,
          totalQuestions: t.totalQuestions,
          totalMarks: t.totalMarks,
          isPremium: t.isPremium,
          free: isFreeType || !t.isPremium || !locked,
          locked,
          freeMocksUsed: used,
          freeMocksAllowed: freeAllowed,
        };
      });

      return {
        id: exam.id,
        name: exam.name,
        slug: exam.slug,
        code: exam.code,
        pattern: pattern ? {
          totalQuestions: pattern?.totalQuestions,
          totalMarks: pattern.totalMarks,
          durationMinutes: pattern?.durationMinutes,
          negativeMarks: pattern.negativeMarks,
          sections: pattern?.sections,
        } : null,
        templates,
      };
    });
  }

  // ==========================================
  // 2. CREATE/GET MOCK TEST FOR AN EXAM
  // ==========================================
  async createMockTest(userId: string, config: MockTestConfig) {
    const exam = await this.prisma.exam.findUnique({ 
      where: { id: config.examId },
      include: { 
        patterns: { where: {}, orderBy: { createdAt: 'desc' }, take: 1 },
        subjects: { include: { chapters: true } },
      }
    });
    
    if (!exam) throw new NotFoundException('Exam not found');
    if (!exam.patterns || exam.patterns.length === 0) throw new BadRequestException('No active exam pattern found');

    const pattern = exam.patterns && exam.patterns.length > 0 ? exam.patterns[0] : null;
    if (!pattern) throw new BadRequestException('No active exam pattern found');
    const sections = config.sections || (pattern?.sections as any[]) || [];

    // Build question selection based on exam pattern
    const questions = await this.selectQuestionsForMock(config, sections, exam.subjects);

    // Create test template if not provided
    let templateId = config.templateId;
    if (!templateId) {
      const template = await this.prisma.testTemplate.create({
        data: {
          title: `${exam.name} Mock Test - ${new Date().toISOString().slice(0,10)}`,
          description: `Auto-generated ${config.type} mock for ${exam.name}`,
          type: config.type,
          durationMinutes: config.durationMinutes || pattern?.durationMinutes,
          totalQuestions: config.totalQuestions || pattern?.totalQuestions,
          totalMarks: config.totalMarks || pattern.totalMarks,
          isPremium: false,
          isActive: true,
        },
      });
      templateId = template.id;
    }

    // Check mock access
    const access = await this.prisma.mockAccess.findUnique({
      where: { userId_testTemplateId: { userId, testTemplateId: templateId } },
    });

    const isFreeType = config.type === 'PREVIOUS_YEAR' || config.type === 'YEAR_WISE';
    const freeAllowed = 2;
    if (!isFreeType && access && access.mocksUsed >= freeAllowed && access.paidPacksPurchased === 0) {
      throw new BadRequestException('Free mock limit reached. Purchase mock access to continue.');
    }

    // Create test attempt
    const attempt = await this.prisma.testAttempt.create({
      data: {
        userId,
        testTemplateId: templateId,
        status: 'IN_PROGRESS',
        startedAt: new Date(),
      },
    });

    // Create attempt answers (question snapshot)
    const attemptAnswers = await Promise.all(
      questions.map((q, index) => 
        this.prisma.attemptAnswer.create({
          data: {
            testAttemptId: attempt.id,
            questionId: q.id,
            selectedOption: null,
            isCorrect: false,
            timeSpentSeconds: 0,
          },
        })
      )
    );

    return {
      testAttemptId: attempt.id,
      templateId,
      exam: { id: exam.id, name: exam.name, slug: exam.slug, code: exam.code },
      durationMinutes: config.durationMinutes || pattern?.durationMinutes,
      totalQuestions: questions.length,
      totalMarks: config.totalMarks || pattern.totalMarks,
      negativeMarks: pattern.negativeMarks,
      sections: (sections || []).map((s: any) => ({
        name: s.name,
        subjectId: s.subjectId,
        questions: s.questions,
        marks: s.marks,
      })),
      questions: questions.map(q => ({
        id: q.id,
        questionText: q.questionText,
        questionTextHindi: q.questionTextHindi ?? '',
        options: q.optionsJson,
        chapterId: q.chapterId,
        chapterName: q.chapter?.name,
        subjectName: q.subject?.name,
        year: q.year,
        shift: q.shift,
      })),
      startedAt: attempt.startedAt,
      expiresAt: new Date(attempt.startedAt.getTime() + (config.durationMinutes || pattern?.durationMinutes) * 60 * 1000),
    };
  }

  private async selectQuestionsForMock(config: MockTestConfig, sections: any[], subjects: any[]) {
    const questions: any[] = [];
    
    for (const section of sections) {
      const subject = subjects.find(s => s.id === section.subjectId);
      if (!subject) continue;

      const chapterIds = (subject as any).chapters.map((c: any) => c.id);
      
      // Get questions for this section
      const sectionQuestions = await this.prisma.question.findMany({
        where: {
          isApproved: true,
          isActive: true,
          examId: config.examId,
          subjectId: section.subjectId,
          chapterId: { in: chapterIds },
        },
        orderBy: { year: 'desc' },
        take: section.questions * 3, // Get 3x for random selection
      });

      // Shuffle and take required number
      const shuffled = sectionQuestions.sort(() => Math.random() - 0.5);
      questions.push(...shuffled.slice(0, section.questions));
    }

    return questions;
  }

  // ==========================================
  // 3. SUBMIT MOCK TEST & GET DETAILED ANALYSIS
  // ==========================================
  async submitMockTest(
    userId: string, 
    testAttemptId: string, 
    answers: { questionId: string; selectedOption: string; timeSpentSeconds: number }[]
  ) {
    const attempt = await this.prisma.testAttempt.findUnique({
      where: { id: testAttemptId },
      include: { 
        testTemplate: true,
        answers: { include: { question: { include: { chapter: true, subject: true } } } },
      },
    });

    if (!attempt) throw new NotFoundException('Test attempt not found');
    if (attempt.userId !== userId) throw new BadRequestException('Unauthorized');
    if (attempt.status !== 'IN_PROGRESS') throw new BadRequestException('Test already submitted');

    let totalCorrect = 0;
    let totalWrong = 0;
    let totalSkipped = 0;
    let totalTimeSpent = 0;

    const chapterStats = new Map<string, ChapterAnalysis>();

    for (const ans of answers) {
      const attemptAnswer = attempt.answers.find(a => a.questionId === ans.questionId);
      if (!attemptAnswer) continue;

      const question = attemptAnswer.question;
      const isCorrect = ans.selectedOption === question.correctAnswer;
      const isSkipped = !ans.selectedOption;

      // Update attempt answer
      await this.prisma.attemptAnswer.update({
        where: { id: attemptAnswer.id },
        data: {
          selectedOption: ans.selectedOption,
          isCorrect,
          timeSpentSeconds: ans.timeSpentSeconds,
        },
      });

      // Track chapter stats
      const chapterId = question.chapterId || 'unknown';
      const chapterName = question.chapter?.name || 'Unknown';
      const subjectName = question.subject?.name || 'Unknown';

      if (!chapterStats.has(chapterId)) {
        chapterStats.set(chapterId, {
          chapterId,
          chapterName,
          subjectName,
          totalQuestions: 0,
          attempted: 0,
          correct: 0,
          accuracy: 0,
          timeSpent: 0,
          isWeak: false,
        });
      }

      const stats = chapterStats.get(chapterId)!;
      stats.totalQuestions++;
      stats.timeSpent += ans.timeSpentSeconds;
      totalTimeSpent += ans.timeSpentSeconds;

      if (!isSkipped) {
        stats.attempted++;
        if (isCorrect) {
          stats.correct++;
          totalCorrect++;
        } else {
          totalWrong++;
        }
      } else {
        totalSkipped++;
      }
      stats.accuracy = stats.attempted > 0 ? (stats.correct / stats.attempted) * 100 : 0;
      stats.isWeak = stats.accuracy < 60 && stats.attempted >= 3;
    }

    const accuracyPercent = attempt.testTemplate.totalQuestions > 0 
      ? (totalCorrect / attempt.testTemplate.totalQuestions) * 100 
      : 0;
    const score = totalCorrect * 2 - totalWrong * 0.5; // 2 marks correct, -0.5 wrong

    // Update WeakTopicReport for weak chapters
    for (const [chapterId, stats] of chapterStats) {
      if (stats.isWeak) {
        await this.prisma.weakTopicReport.upsert({
          where: { userId_chapterId: { userId, chapterId } },
          create: {
            userId,
            chapterId,
            subjectId: (await this.prisma.chapter.findUnique({ where: { id: chapterId } }))?.subjectId || '',
            attemptsMade: stats.attempted,
            correctCount: stats.correct,
            accuracyPercent: stats.accuracy,
            strengthScore: Math.round(stats.accuracy),
            isWeak: true,
          },
          update: {
            attemptsMade: { increment: stats.attempted },
            correctCount: { increment: stats.correct },
            accuracyPercent: stats.accuracy,
            strengthScore: Math.round(stats.accuracy),
            isWeak: true,
          },
        });
      }
    }

    // Update mock access usage
    await this.prisma.mockAccess.upsert({
      where: { userId_testTemplateId: { userId, testTemplateId: attempt.testTemplateId } },
      create: { userId, testTemplateId: attempt.testTemplateId, mocksUsed: 1 },
      update: { mocksUsed: { increment: 1 } },
    });

    // Complete the attempt
    const completedAttempt = await this.prisma.testAttempt.update({
      where: { id: testAttemptId },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        // timeTakenSeconds: totalTimeSpent,
        score,
        totalCorrect,
        totalWrong,
        totalSkipped,
        accuracyPercent,
      },
    });

    // Get weak and strong chapters
    const weakChapters: WeakChapter[] = [];
    const strongChapters: StrongChapter[] = [];

    for (const [chapterId, stats] of chapterStats) {
      if (stats.isWeak) {
        weakChapters.push({
          chapterId,
          chapterName: stats.chapterName,
          subjectName: stats.subjectName,
          accuracy: stats.accuracy,
          questionsMissed: stats.attempted - stats.correct,
          recommendedPracticeCount: Math.max(10, 20 - stats.correct),
        });
      } else if (stats.accuracy >= 80 && stats.attempted >= 5) {
        strongChapters.push({
          chapterId,
          chapterName: stats.chapterName,
          subjectName: stats.subjectName,
          accuracy: stats.accuracy,
        });
      }
    }

    return {
      testAttemptId: attempt.id,
      score,
      totalCorrect,
      totalWrong,
      totalSkipped,
      accuracyPercent,
      rank: completedAttempt.rank,
      percentile: completedAttempt.percentile,
      timeTakenSeconds: totalTimeSpent,
      chapterAnalysis: Array.from(chapterStats.values()),
      weakChapters,
      strongChapters,
    };
  }

  // ==========================================
  // 4. GET WEAK CHAPTER PRACTICE TEST
  // ==========================================
  async getWeakChapterPracticeTest(userId: string, options: {
    examId?: string;
    subjectId?: string;
    chapterIds?: string[];
    questionCount?: number;
  } = {}) {
    // Get user's weak chapters
    const where: any = { userId, isWeak: true };
    if (options.chapterIds) where.chapterId = { in: options.chapterIds };
    if (options.subjectId) where.subjectId = options.subjectId;
    if (options.examId) {
      // Get subjects for this exam, then their chapters
      const subjects = await this.prisma.subject.findMany({
        where: { exams: { some: { id: options.examId } } },
        select: { id: true }
      });
      const chapters = await this.prisma.chapter.findMany({ 
        where: { subjectId: { in: subjects.map(s => s.id) } },
        select: { id: true }
      });
      where.chapterId = { in: chapters.map(c => c.id) };
    }

    const weakReports = await this.prisma.weakTopicReport.findMany({
      where,
      orderBy: { strengthScore: 'asc' },
      take: 20,
      include: { chapter: { include: { subject: true } } },
    });

    if (weakReports.length === 0) {
      return { message: 'No weak chapters found! Great job!', questions: [] };
    }

    // Select questions from weak chapters (not previously attempted in this session)
    const questionCount = options.questionCount || 25;
    const questionsPerChapter = Math.max(1, Math.floor(questionCount / weakReports.length));

    const questions: any[] = [];
    for (const report of weakReports) {
      const chapterQuestions = await this.prisma.question.findMany({
        where: {
          isApproved: true,
          isActive: true,
          chapterId: report.chapterId,
          examId: options.examId,
        },
        orderBy: { year: 'desc' },
        take: questionsPerChapter * 2,
      });

      // Filter out recently attempted questions
      const recentAttempts = await this.prisma.attemptAnswer.findMany({
        where: {
          testAttempt: { userId, status: 'SUBMITTED' },
          
        },
        select: { questionId: true },
      });
      const recentIds = new Set(recentAttempts.map(a => a.questionId));

      const available = chapterQuestions.filter(q => !recentIds.has(q.id));
      questions.push(...available.sort(() => Math.random() - 0.5).slice(0, questionsPerChapter));
    }

    // Create practice test template
    const template = await this.prisma.testTemplate.create({
      data: {
        title: 'Weak Chapter Practice Test',
        description: `Practice test focusing on ${weakReports.length} weak chapters`,
        type: 'CHAPTER',
        durationMinutes: 30,
        totalQuestions: questions.length,
        totalMarks: questions.length * 2,
        isPremium: false,
        isActive: true,
      },
    });

    // Create test attempt
    const attempt = await this.prisma.testAttempt.create({
      data: {
        userId,
        testTemplateId: template.id,
        status: 'IN_PROGRESS',
        startedAt: new Date(),
      },
    });

    return {
      testAttemptId: attempt.id,
      templateId: template.id,
      durationMinutes: 30,
      totalQuestions: questions.length,
      totalMarks: questions.length * 2,
      weakChaptersTargeted: weakReports.map(r => ({
        chapterId: r.chapterId,
        chapterName: r.chapter?.name,
        subjectName: (r.chapter as any)?.subject?.name || '',
        currentAccuracy: r.accuracyPercent,
      })),
      questions: questions.map(q => ({
        id: q.id,
        questionText: q.questionText,
        questionTextHindi: q.questionTextHindi ?? '',
        options: q.optionsJson,
        chapterId: q.chapterId,
        chapterName: q.chapter?.name,
        subjectName: q.subject?.name,
      })),
    };
  }

  // ==========================================
  // 5. RETEST WEAK CHAPTERS AFTER PRACTICE
  // ==========================================
  async retestWeakChapters(userId: string, options: { 
    previousAttemptId?: string;
    chapterIds?: string[] 
  } = {}) {
    // Get weak chapters that were practiced
    let weakChapters: string[] = options.chapterIds || [];
    
    if (options.previousAttemptId) {
      const prevAttempt = await this.prisma.testAttempt.findUnique({
        where: { id: options.previousAttemptId },
        include: { 
          answers: { 
            include: { question: { select: { chapterId: true } } },
            where: { isCorrect: false }
          }
        }
      });
      if (prevAttempt) {
        weakChapters = [...new Set(prevAttempt.answers.map(a => a.question?.chapterId).filter((id): id is string => id != null))];
      }
    }

    if (weakChapters.length === 0) {
      // Fallback to current weak chapters
      const reports = await this.prisma.weakTopicReport.findMany({
        where: { userId, isWeak: true },
        orderBy: { strengthScore: 'asc' },
        take: 10,
      });
      weakChapters = reports.map(r => r.chapterId);
    }

    // Get NEW questions from these chapters (not in previous attempt)
    const previousQuestionIds = options.previousAttemptId 
      ? (await this.prisma.attemptAnswer.findMany({
          where: { testAttemptId: options.previousAttemptId },
          select: { questionId: true },
        })).map(a => a.questionId)
      : [];

    const questions: any[] = [];
    for (const chapterId of weakChapters) {
      const chapterQuestions = await this.prisma.question.findMany({
        where: {
          isApproved: true,
          isActive: true,
          chapterId,
          id: { notIn: previousQuestionIds },
        },
        orderBy: { year: 'desc' },
        take: 5,
      });
      questions.push(...chapterQuestions.sort(() => Math.random() - 0.5).slice(0, 3));
    }

    if (questions.length === 0) {
      return { message: 'No new questions available for retest' };
    }

    const template = await this.prisma.testTemplate.create({
      data: {
        title: 'Weak Chapter Retest',
        description: `Retest on ${weakChapters.length} previously weak chapters with new questions`,
        type: 'CHAPTER',
        durationMinutes: 25,
        totalQuestions: questions.length,
        totalMarks: questions.length * 2,
        isPremium: false,
        isActive: true,
      },
    });

    const attempt = await this.prisma.testAttempt.create({
      data: {
        userId,
        testTemplateId: template.id,
        status: 'IN_PROGRESS',
        startedAt: new Date(),
      },
    });

    return {
      testAttemptId: attempt.id,
      templateId: template.id,
      durationMinutes: 25,
      totalQuestions: questions.length,
      totalMarks: questions.length * 2,
      questions: questions.map(q => ({
        id: q.id,
        questionText: q.questionText,
        questionTextHindi: q.questionTextHindi ?? '',
        options: q.optionsJson,
        chapterId: q.chapterId,
        chapterName: q.chapter?.name,
        subjectName: q.subject?.name,
      })),
    };
  }

  // ==========================================
  // 6. CHAPTER-WISE QUESTION BANK WITH YEAR FILTERS
  // ==========================================
  async getChapterWiseQuestions(examId: string, subjectId?: string, chapterId?: string) {
    const where: any = { 
      examId, 
      isApproved: true, 
      isActive: true 
    };
    if (subjectId) where.subjectId = subjectId;
    if (chapterId) where.chapterId = chapterId;

    // Get subjects for this exam
    const subjects = await this.prisma.subject.findMany({
      where: { exams: { some: { id: examId } } },
      select: { id: true }
    });
    const chapters = await this.prisma.chapter.findMany({
      where: { subjectId: { in: subjects.map(s => s.id) } },
      include: {
        subject: true,
        questions: {
          where: { isApproved: true, isActive: true },
          orderBy: { year: 'desc' },
          select: {
            id: true,
            year: true,
            shift: true,
            questionText: true,
            questionTextHindi: true,
            optionsJson: true,
            correctAnswer: true,
            explanation: true,
            explanationHindi: true,
            difficulty: true,
            answerVerificationStatus: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return chapters.map(ch => ({
      id: ch.id,
      name: ch.name,
      slug: ch.slug,
      subject: { id: ch.subjectId, name: (ch as any).subject?.name || '' },
      questionCount: (ch as any).questions?.length || 0,
      questions: ((ch as any).questions || []).map((q: any) => ({
        ...q,
        options: q.optionsJson,
        optionsJson: undefined,
      })),
      yearDistribution: this.getYearDistribution((ch as any).questions || []),
    }));
  }

  private getYearDistribution(questions: any[]) {
    const dist: Record<number, number> = {};
    for (const q of questions) {
      if (q.year) {
        dist[q.year] = (dist[q.year] || 0) + 1;
      }
    }
    return Object.entries(dist).map(([year, count]) => ({ year: parseInt(year), count }));
  }

  // ==========================================
  // 7. SEARCH QUESTIONS BY MULTIPLE FILTERS
  // ==========================================
  async searchQuestions(filters: {
    examId?: string;
    subjectId?: string;
    chapterId?: string;
    year?: number;
    shift?: string;
    difficulty?: string;
    verifiedOnly?: boolean;
    hasHindi?: boolean;
    hasVideo?: boolean;
    keyword?: string;
    skip?: number;
    take?: number;
  }) {
    const where: any = { isApproved: true, isActive: true };
    
    if (filters.examId) where.examId = filters.examId;
    if (filters.subjectId) where.subjectId = filters.subjectId;
    if (filters.chapterId) where.chapterId = filters.chapterId;
    if (filters.year) where.year = filters.year;
    if (filters.shift) where.shift = filters.shift;
    if (filters.difficulty) where.difficulty = filters.difficulty;
    if (filters.verifiedOnly) where.answerVerificationStatus = 'VERIFIED_OFFICIAL';
    if (filters.hasHindi) where.questionTextHindi = { not: '' };
    if (filters.hasVideo) where.videoUrl = { not: null };
    if (filters.keyword) {
      where.OR = [
        { questionText: { contains: filters.keyword, mode: 'insensitive' } },
        { questionTextHindi: { contains: filters.keyword, mode: 'insensitive' } },
      ];
    }

    const [questions, total] = await Promise.all([
      this.prisma.question.findMany({
        where,
        include: { 
          chapter: { select: { name: true } },
          subject: { select: { name: true } },
          exam: { select: { name: true, code: true } },
        },
        orderBy: [{ year: 'desc' }, { createdAt: 'asc' }],
        skip: filters.skip || 0,
        take: filters.take || 20,
      }),
      this.prisma.question.count({ where }),
    ]);

    return {
      total,
      questions: questions.map(q => ({
        id: q.id,
        questionText: q.questionText,
        questionTextHindi: q.questionTextHindi ?? '',
        options: q.optionsJson,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        explanationHindi: q.explanationHindi,
        chapter: (q as any).chapter?.name,
        subject: (q as any).subject?.name,
        exam: (q as any).exam?.name,
        examCode: (q as any).exam?.code,
        year: q.year,
        shift: q.shift,
        difficulty: q.difficulty,
        answerVerificationStatus: q.answerVerificationStatus,
        videoUrl: q.videoUrl,
        videoTitle: q.videoTitle,
      })),
    };
  }
}
