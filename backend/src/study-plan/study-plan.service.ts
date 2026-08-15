import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudyPlanType } from '@prisma/client';

@Injectable()
export class StudyPlanService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a study plan for the user.
   * Calculates daily_target = ceil(total_questions_for_exam / remaining_days).
   */
  async createPlan(
    userId: string,
    examId: string,
    subjectId: string | undefined,
    type: 'COMBINED' | 'SUBJECT_WISE',
    targetDate: string, // ISO date string
  ) {
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) throw new NotFoundException('Exam not found');

    if (subjectId && type === 'SUBJECT_WISE') {
      const subject = await this.prisma.subject.findUnique({ where: { id: subjectId } });
      if (!subject) throw new NotFoundException('Subject not found');
    }

    // Count total questions for the exam (and optionally subject)
    const questionFilter: Record<string, unknown> = { examId, isActive: true };
    if (subjectId) questionFilter.subjectId = subjectId;
    const totalQuestions = await this.prisma.question.count({ where: questionFilter });

    if (totalQuestions === 0) {
      throw new BadRequestException('No questions available for the selected exam/subject combination');
    }

    // Calculate remaining days (start today, targetDate is the deadline)
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const target = new Date(targetDate);
    target.setHours(23, 59, 59, 999);

    if (target <= start) {
      throw new BadRequestException('Target date must be in the future');
    }

    const remainingDays = Math.max(1, Math.ceil((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    const dailyTarget = Math.ceil(totalQuestions / remainingDays);

    // Create the plan
    const plan = await this.prisma.studyPlan.create({
      data: {
        userId,
        examId,
        subjectId: subjectId ?? null,
        type: type as StudyPlanType,
        startDate: start,
        targetDate: target,
        dailyTarget,
        currentStreak: 0,
        longestStreak: 0,
      },
    });

    return {
      plan,
      stats: {
        totalQuestions,
        remainingDays,
        dailyTarget,
      },
    };
  }

  /** Get the user's most recent active study plan */
  async getPlan(userId: string) {
    const plan = await this.prisma.studyPlan.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        exam: { select: { id: true, name: true, slug: true } },
        subject: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!plan) return null;

    // Compute progress stats
    const questionFilter: Record<string, unknown> = { examId: plan.examId, isActive: true };
    if (plan.subjectId) questionFilter.subjectId = plan.subjectId;
    const totalQuestions = await this.prisma.question.count({ where: questionFilter });

    // Count questions practiced so far under this plan (via test attempts since plan start)
    const practiced = await this.prisma.testAttempt.aggregate({
      where: {
        userId,
        startedAt: { gte: plan.startDate },
        status: 'SUBMITTED',
      },
      _sum: { totalCorrect: true, totalWrong: true },
    });
    const questionsDone = (practiced._sum.totalCorrect ?? 0) + (practiced._sum.totalWrong ?? 0);

    return {
      ...plan,
      progress: {
        totalQuestions,
        questionsDone,
        remaining: Math.max(0, totalQuestions - questionsDone),
        percentComplete: totalQuestions > 0 ? Math.round((questionsDone / totalQuestions) * 100) : 0,
      },
    };
  }

  /**
   * Record a practice session. Updates streaks and recomputes daily_target.
   */
  async recordPractice(
    userId: string,
    planId: string,
    questionsAttempted: number,
    _correct: number,
  ) {
    const plan = await this.prisma.studyPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Study plan not found');
    if (plan.userId !== userId) throw new BadRequestException('Plan does not belong to this user');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lastPractice = plan.lastPracticeDate ? new Date(plan.lastPracticeDate) : null;
    let newStreak = plan.currentStreak;

    if (lastPractice) {
      const diffDays = Math.floor((today.getTime() - lastPractice.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        // Consecutive day — increment streak
        newStreak = plan.currentStreak + 1;
      } else if (diffDays > 1) {
        // Missed a day — reset streak
        newStreak = 1;
      }
      // diffDays === 0: same day — keep current streak
    } else {
      // First practice ever
      newStreak = 1;
    }

    const newLongest = Math.max(plan.longestStreak, newStreak);

    // Recompute daily target based on remaining questions / remaining days
    const questionFilter: Record<string, unknown> = { examId: plan.examId, isActive: true };
    if (plan.subjectId) questionFilter.subjectId = plan.subjectId;
    const totalQuestions = await this.prisma.question.count({ where: questionFilter });

    const targetEnd = new Date(plan.targetDate);
    targetEnd.setHours(23, 59, 59, 999);
    const remainingDays = Math.max(1, Math.ceil((targetEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

    const practiced = await this.prisma.testAttempt.aggregate({
      where: {
        userId,
        startedAt: { gte: plan.startDate },
        status: 'SUBMITTED',
      },
      _sum: { totalCorrect: true, totalWrong: true },
    });
    const questionsDone = (practiced._sum.totalCorrect ?? 0) + (practiced._sum.totalWrong ?? 0) + questionsAttempted;
    const remaining = Math.max(0, totalQuestions - questionsDone);
    const newDailyTarget = Math.ceil(remaining / remainingDays);

    const updated = await this.prisma.studyPlan.update({
      where: { id: planId },
      data: {
        currentStreak: newStreak,
        longestStreak: newLongest,
        lastPracticeDate: today,
        dailyTarget: newDailyTarget,
      },
    });

    return {
      plan: updated,
      streak: {
        currentStreak: newStreak,
        longestStreak: newLongest,
        isNewRecord: newLongest > plan.longestStreak,
      },
      progress: {
        remaining,
        dailyTarget: newDailyTarget,
        remainingDays,
      },
    };
  }

  /** Get today's daily target for the user */
  async getDailyTarget(userId: string) {
    const plan = await this.prisma.studyPlan.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (!plan) {
      return { hasPlan: false, dailyTarget: 0, message: 'No active study plan. Create one first!' };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const questionFilter: Record<string, unknown> = { examId: plan.examId, isActive: true };
    if (plan.subjectId) questionFilter.subjectId = plan.subjectId;
    const totalQuestions = await this.prisma.question.count({ where: questionFilter });

    const targetEnd = new Date(plan.targetDate);
    targetEnd.setHours(23, 59, 59, 999);
    const remainingDays = Math.max(1, Math.ceil((targetEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

    const practiced = await this.prisma.testAttempt.aggregate({
      where: {
        userId,
        startedAt: { gte: plan.startDate },
        status: 'SUBMITTED',
      },
      _sum: { totalCorrect: true, totalWrong: true },
    });
    const questionsDone = (practiced._sum.totalCorrect ?? 0) + (practiced._sum.totalWrong ?? 0);
    const remaining = Math.max(0, totalQuestions - questionsDone);

    // Check how many the user did today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayPractice = await this.prisma.testAttempt.aggregate({
      where: {
        userId,
        startedAt: { gte: todayStart, lte: todayEnd },
        status: 'SUBMITTED',
      },
      _sum: { totalCorrect: true, totalWrong: true },
    });
    const todayDone = (todayPractice._sum.totalCorrect ?? 0) + (todayPractice._sum.totalWrong ?? 0);

    return {
      hasPlan: true,
      planId: plan.id,
      dailyTarget: plan.dailyTarget,
      todayDone,
      remaining,
      totalQuestions,
      remainingDays,
      streak: plan.currentStreak,
      targetDate: plan.targetDate,
    };
  }
}