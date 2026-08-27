/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ErrorReportStatus } from '@prisma/client';
import { SearchService } from '../search/search.service';

// v5 §37.4 — Report Error loop
// A question is auto soft-suspended once OPEN reports cross the threshold.
const SOFT_SUSPEND_THRESHOLD = 3;

@Injectable()
export class ReportErrorService {
  private readonly logger = new Logger(ReportErrorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
  ) {}

  // BUG FIX (found while closing the "autoSuspended leaks into search"
  // gap — see search.service.ts): every place below that flips
  // Question.autoSuspended in Postgres was never telling Meilisearch about
  // it. search.service.ts's index only gets a question's current
  // isApproved/isActive/autoSuspended values when indexQuestion() (single
  // doc, admin-triggered) or indexAllApproved() (full rebuild) runs — a
  // plain `prisma.question.update()` here does not touch the search index
  // at all. So a question a student got auto-suspended, or an admin
  // CONFIRMED as wrong, stayed fully findable via search (and, before the
  // autoSuspended filter fix in search.service.ts, was never even excluded
  // once found) until someone happened to run a full re-index. Re-index
  // the single affected question right after every autoSuspended change so
  // search stays in sync in real time. Best-effort / fire-and-forget: a
  // Meilisearch hiccup must never block the report/resolve/unsuspend flow
  // itself.
  private reindexAfterVisibilityChange(questionId: string) {
    this.search.indexQuestion(questionId).catch((e) =>
      this.logger.warn(`Failed to re-index question ${questionId} after visibility change: ${e?.message || e}`),
    );
  }

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

    if (nowSuspended) this.reindexAfterVisibilityChange(questionId);

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
      this.reindexAfterVisibilityChange(report.questionId);
    }
    // On REJECTED: all reports were false alarms — lift the suspension, keep the audit trail
    if (status === 'REJECTED') {
      await this.prisma.question.update({
        where: { id: report.questionId },
        data: { autoSuspended: false, suspendedAt: null },
      });
      this.reindexAfterVisibilityChange(report.questionId);
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
    this.reindexAfterVisibilityChange(questionId);

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
