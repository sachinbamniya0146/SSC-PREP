/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, NotFoundException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ErrorReportStatus } from '@prisma/client';
import { SearchService } from '../search/search.service';
import { ChatGateway } from '../chat/chat.gateway';
import { encryptMessageContent, decryptMessageContent } from '../common/crypto/message-encryption';

// v5 §37.4 — Report Error loop
// A question is auto soft-suspended once OPEN reports cross the threshold.
const SOFT_SUSPEND_THRESHOLD = 3;

// Chat: a single message body is capped to keep the encrypted payload and
// the resulting DB rows/socket frames bounded — generous for a support
// conversation, not a document-paste target.
const MAX_MESSAGE_LENGTH = 4000;

@Injectable()
export class ReportErrorService {
  private readonly logger = new Logger(ReportErrorService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly searchService: SearchService,
    private readonly chatGateway: ChatGateway,
  ) {}

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

    if (nowSuspended) {
      this.reindexAfterVisibilityChange(questionId);
    }

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

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'QUESTION_UNSUSPENDED',
        targetEntity: 'Question',
        entityId: questionId,
        metadataJson: { questionText: question.questionText.substring(0, 100) } as any,
      },
    });

    // Re-index in Meilisearch to reflect visibility change
    this.reindexAfterVisibilityChange(questionId);

    return { success: true, message: 'Question unsuspended and error reports cleared' };
  }

  /** Re-index a question in Meilisearch after its visibility changed (autoSuspended flip) */
  private reindexAfterVisibilityChange(questionId: string) {
    this.searchService.indexQuestion(questionId).catch((e) => {
      this.logger.warn(`Failed to re-index question ${questionId} after visibility change: ${e.message}`);
    });
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

  // ================= REPORT-THREAD CHAT =================
  // Direct Q&A attached to one QuestionErrorReport — "is question mein kya
  // wrong hai" from the student, and the admin's replies/resolution notes,
  // in one place instead of the student having no way to explain further
  // or the admin having no way to ask a follow-up.

  /**
   * Checks whether `userId` may read/post in this report's thread: the
   * reporting student themself, or any ADMIN/MODERATOR. Returns the report
   * row (small enough to reuse) so callers don't re-fetch.
   */
  private async assertReportAccess(reportId: string, userId: string, role: string) {
    const report = await this.prisma.questionErrorReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Report not found');
    const isOwner = report.userId === userId;
    const isStaff = role === 'ADMIN' || role === 'MODERATOR';
    if (!isOwner && !isStaff) {
      throw new ForbiddenException('You do not have access to this report thread');
    }
    return { report, isStaff };
  }

  /** Post a message in a report's thread. Encrypts before storing, then pushes the decrypted message live via ChatGateway. */
  async postReportMessage(
    reportId: string,
    senderId: string,
    senderRole: 'STUDENT' | 'ADMIN' | 'MODERATOR',
    content: string,
  ) {
    const trimmed = (content || '').trim();
    if (!trimmed) throw new ConflictException('Message cannot be empty');
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new ConflictException(`Message too long (max ${MAX_MESSAGE_LENGTH} characters)`);
    }

    const { report, isStaff } = await this.assertReportAccess(reportId, senderId, senderRole);
    const encrypted = encryptMessageContent(trimmed);

    const message = await this.prisma.reportMessage.create({
      data: {
        reportId,
        senderId,
        senderRole: senderRole as any,
        ...encrypted,
      },
      include: { sender: { select: { id: true, fullName: true, role: true } } },
    });

    // First time ANY admin/moderator replies (or even just posts) in a
    // still-OPEN report's thread, flip it to REVIEWING — the "admin is now
    // looking at this" signal Sachin asked for ("uska problem solve bhi
    // tick kare — under review mein jaaye"). Only moves OPEN -> REVIEWING;
    // never overrides a report an admin already resolved (CONFIRMED/REJECTED).
    let statusChanged: ErrorReportStatus | null = null;
    if (isStaff && report.status === 'OPEN') {
      const updated = await this.prisma.questionErrorReport.update({
        where: { id: reportId },
        data: { status: 'REVIEWING', firstAdminViewAt: report.firstAdminViewAt ?? new Date() },
      });
      statusChanged = updated.status;
    }

    const plain = {
      id: message.id,
      reportId: message.reportId,
      senderId: message.senderId,
      senderRole: message.senderRole,
      senderName: message.sender.fullName,
      content: trimmed,
      createdAt: message.createdAt,
      readAt: message.readAt,
    };

    // Notify the OTHER party's personal room: if a student sent it, ping
    // the admin inbox room (already done inside emitReportMessage); if
    // staff sent it, ping the reporting student directly so they see a
    // reply even if they've navigated away from the report page.
    const notifyUserId = isStaff ? report.userId : undefined;
    this.chatGateway.emitReportMessage(reportId, plain, notifyUserId);
    if (statusChanged) {
      this.chatGateway.emitReportStatusChange(reportId, statusChanged, report.userId);
    }

    return { message: plain, statusChanged };
  }

  /** List a report thread's messages, decrypted, oldest-first. */
  async listReportMessages(reportId: string, userId: string, role: string) {
    await this.assertReportAccess(reportId, userId, role);

    const messages = await this.prisma.reportMessage.findMany({
      where: { reportId },
      orderBy: { createdAt: 'asc' },
      include: { sender: { select: { id: true, fullName: true, role: true } } },
    });

    const decrypted = messages.map((m) => {
      let content: string;
      try {
        content = decryptMessageContent({
          contentEncrypted: m.contentEncrypted,
          contentIv: m.contentIv,
          contentAuthTag: m.contentAuthTag,
        });
      } catch (e) {
        // A single corrupted/undecryptable row (e.g. key rotated without
        // migrating old rows) should not break the whole thread's listing.
        this.logger.warn(`Failed to decrypt report message ${m.id}: ${(e as Error).message}`);
        content = '[message unavailable]';
      }
      return {
        id: m.id,
        reportId: m.reportId,
        senderId: m.senderId,
        senderRole: m.senderRole,
        senderName: m.sender.fullName,
        content,
        createdAt: m.createdAt,
        readAt: m.readAt,
      };
    });

    return { messages: decrypted, count: decrypted.length };
  }

  /** Mark all messages NOT sent by `userId` as read, in this thread. */
  async markReportThreadRead(reportId: string, userId: string, role: string) {
    await this.assertReportAccess(reportId, userId, role);
    await this.prisma.reportMessage.updateMany({
      where: { reportId, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  }
}
