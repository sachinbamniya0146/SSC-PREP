/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ErrorReportStatus } from '@prisma/client';

// v5 §37.4 — Report Error loop
// A question is auto soft-suspended once OPEN reports cross the threshold.
const SOFT_SUSPEND_THRESHOLD = 3;

@Injectable()
export class ReportErrorService {
  constructor(private readonly prisma: PrismaService) {}

  async getExports() {
    return { SOFT_SUSPEND_THRESHOLD };
  }

  /** Student reports a suspected error on a question. */
  async report(userId: string, questionId: string, description: string, category?: string, _issueType?: string) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { id: true, autoSuspended: true },
    });
    if (!question) {
      throw new NotFoundException('Question not found');
    }

    // Prevent one user spamming the same question — one open report per user+question
    const existing = await this.prisma.questionErrorReport.findFirst({
      where: { userId, questionId, status: { in: ['OPEN', 'REVIEWING'] } },
    });
    if (existing) {
      throw new ConflictException('You already have an open report for this question');
    }

    const validCategories = ['WRONG_ANSWER', 'WRONG_OPTION', 'WRONG_EXPLANATION', 'TRANSLATION', 'TYPO', 'MISSING_OPTION', 'DUPLICATE', 'OTHER'];
    const cat = validCategories.includes(category ?? '') ? category : 'OTHER';

    const report = await this.prisma.questionErrorReport.create({
      data: { userId, questionId, description, category: cat as any },
    });

    // Count OPEN reports on this question; soft-suspend past threshold
    const openCount = await this.prisma.questionErrorReport.count({
      where: { questionId, status: 'OPEN' },
    });
    const nowSuspended = openCount >= SOFT_SUSPEND_THRESHOLD && !question.autoSuspended;

    await this.prisma.question.update({
      where: { id: questionId },
      data: {
        errorReportCount: { increment: 1 },
        autoSuspended: nowSuspended ? true : question.autoSuspended,
        suspendedAt: nowSuspended ? new Date() : undefined,
      },
    });

    return {
      report,
      openReports: openCount,
      threshold: SOFT_SUSPEND_THRESHOLD,
      suspended: nowSuspended,
    };
  }

  /** Admin: list reports, optionally filtered by status. */
  async list(status?: string, questionId?: string, _issueType?: string) {
    const where: Prisma.QuestionErrorReportWhereInput = {};
    if (status) where.status = status as ErrorReportStatus;
    if (questionId) where.questionId = questionId;
    const reports = await this.prisma.questionErrorReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        question: {
          select: {
            id: true,
            questionText: true,
            correctAnswer: true,
            year: true,
            shift: true,
            autoSuspended: true,
            errorReportCount: true,
            exam: { select: { name: true } },
          },
        },
        user: { select: { id: true, fullName: true, email: true } },
      },
    });
    return { reports, count: reports.length };
  }

  /** Admin resolves a report. */
  async resolve(reportId: string, status: ErrorReportStatus, resolvedBy: string, _adminNotes?: string) {
    const report = await this.prisma.questionErrorReport.update({
      where: { id: reportId },
      data: { status, resolvedAt: new Date(), resolvedBy },
    });

    // On CONFIRMED: mark the question for correction (auto-suspend stays until fixed)
    if (status === 'CONFIRMED') {
      await this.prisma.question.update({
        where: { id: report.questionId },
        data: { autoSuspended: true, suspendedAt: new Date() },
      });
    }
    // On REJECTED: all reports were false alarms — lift the suspension, keep the audit trail
    if (status === 'REJECTED') {
      await this.prisma.question.update({
        where: { id: report.questionId },
        data: { autoSuspended: false, suspendedAt: null },
      });
    }
    return { report };
  }

  /** Get all reports for a specific question */
  async getQuestionReports(questionId: string) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: {
        id: true,
        questionText: true,
        correctAnswer: true,
        autoSuspended: true,
        errorReportCount: true,
        exam: { select: { name: true } },
      },
    });
    if (!question) {
      throw new NotFoundException('Question not found');
    }

    const reports = await this.prisma.questionErrorReport.findMany({
      where: { questionId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
      },
    });

    return { question, reports, count: reports.length };
  }

  /** Admin: manually unsuspend a question after fixing */
  async unsuspendQuestion(questionId: string, adminId: string) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!question) {
      throw new NotFoundException('Question not found');
    }

    // Update all OPEN/REVIEWING reports to REJECTED
    await this.prisma.questionErrorReport.updateMany({
      where: { questionId, status: { in: ['OPEN', 'REVIEWING'] } },
      data: { status: 'REJECTED', resolvedAt: new Date(), resolvedBy: adminId },
    });

    await this.prisma.question.update({
      where: { id: questionId },
      data: { autoSuspended: false, suspendedAt: null, errorReportCount: 0 },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'QUESTION_UNSUSPENDED',
        targetEntity: 'Question',
        entityId: questionId,
        metadataJson: { questionText: question.questionText.substring(0, 100) } as any,
      },
    });

    return { success: true, message: 'Question unsuspended and error reports cleared' };
  }

  /** v5 §40 — error-type classification stats for the admin accuracy dashboard. */
  async categoryStats() {
    const groups = await this.prisma.questionErrorReport.groupBy({
      by: ['category'],
      _count: { _all: true },
    });
    const open = await this.prisma.questionErrorReport.groupBy({
      by: ['category'],
      where: { status: 'OPEN' },
      _count: { _all: true },
    });
    const openMap = new Map(open.map((g) => [g.category, g._count._all]));
    return {
      total: groups.reduce((s, g) => s + g._count._all, 0),
      byCategory: groups.map((g) => ({
        category: g.category,
        count: g._count._all,
        open: openMap.get(g.category) ?? 0,
      })),
    };
  }
}