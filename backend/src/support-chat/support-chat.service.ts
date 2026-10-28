/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../chat/chat.gateway';
import { FeaturesService } from '../features/features.service';
import { encryptMessageContent, decryptMessageContent } from '../common/crypto/message-encryption';
import {
  HELPDESK_KEY,
  HelpdeskConfig,
  TicketCategory,
  canReopen,
  cleanContext,
  defaultPriorityFor,
  mergeHelpdeskConfig,
  normalizeCategory,
  normalizePriority,
  previewText,
  shouldAutoClose,
  slaState,
  validateHelpdeskInput,
  waitingMinutes,
} from './helpdesk-config';

const MAX_MESSAGE_LENGTH = 4000;
const CONFIG_CACHE_MS = 20_000;
const AUTO_CLOSE_EVERY_MS = 60 * 60_000;
const PRIORITY_WEIGHT: Record<string, number> = { URGENT: 4, HIGH: 3, NORMAL: 2, LOW: 1 };

export interface InboxFilter {
  status?: 'OPEN' | 'RESOLVED';
  category?: string;
  priority?: string;
  /** 'mine' | 'unassigned' */
  assigned?: string;
  q?: string;
  /** only tickets with something unread from the student */
  unread?: boolean;
  /** only tickets past the reply target */
  late?: boolean;
}

/**
 * SupportChatService - the help desk. A "conversation" is a ticket: it has a short number the student quotes, a
 * category, a priority, who is on it, how long the student has been waiting, and (after it is resolved) a rating.
 * Separate from ReportErrorService's per-question report threads. A student has one OPEN ticket at a time; any
 * admin / support moderator can pick it up from the shared inbox.
 */
@Injectable()
export class SupportChatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SupportChatService.name);
  private timer?: NodeJS.Timeout;
  private configCache: { at: number; value: HelpdeskConfig } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatGateway: ChatGateway,
    private readonly features: FeaturesService,
  ) {}

  // ---- Background: close tickets the student stopped answering ----
  onModuleInit() {
    if (process.env.HELPDESK_JOBS === 'off') return;
    setTimeout(() => void this.tick(), 90_000).unref?.();
    this.timer = setInterval(() => void this.tick(), AUTO_CLOSE_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      const n = await this.autoCloseStale();
      if (n > 0) this.logger.log(`Auto-closed ${n} quiet ticket(s)`);
    } catch (e) {
      this.logger.warn(`auto-close failed: ${(e as Error).message}`);
    }
  }

  // ---- Settings (reply target, auto-close, saved replies) ----
  async config(): Promise<HelpdeskConfig> {
    if (this.configCache && Date.now() - this.configCache.at < CONFIG_CACHE_MS) return this.configCache.value;
    let value = mergeHelpdeskConfig(null);
    try {
      const row = await this.prisma.appSetting.findUnique({ where: { key: HELPDESK_KEY } });
      value = mergeHelpdeskConfig(row?.valueJson);
    } catch {
      // not migrated yet / DB blip: defaults keep the help desk working
    }
    this.configCache = { at: Date.now(), value };
    return value;
  }

  async saveConfig(input: unknown, adminId: string): Promise<{ config: HelpdeskConfig; before: HelpdeskConfig }> {
    const before = await this.config();
    const checked = validateHelpdeskInput(before, input);
    if (!checked.ok) throw new BadRequestException(checked.error);
    await this.prisma.appSetting.upsert({
      where: { key: HELPDESK_KEY },
      create: { key: HELPDESK_KEY, valueJson: checked.config as any, updatedBy: adminId },
      update: { valueJson: checked.config as any, updatedBy: adminId },
    });
    this.configCache = { at: Date.now(), value: checked.config };
    return { config: checked.config, before };
  }

  // ---- Access ----
  private async assertConversationAccess(conversationId: string, userId: string) {
    const conversation = await this.prisma.supportConversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('Ticket not found');
    const isOwner = conversation.studentId === userId;
    // Live check (JWT role can be stale; moderators need SUPPORT department).
    const live = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, permissions: true } });
    const staffRole =
      live?.role === 'ADMIN' ||
      (live?.role === 'MODERATOR' && ((live.permissions ?? []) as string[]).includes('SUPPORT'));
    if (!isOwner && !staffRole) {
      throw new ForbiddenException('You do not have access to this ticket');
    }
    // An admin looking at their OWN ticket (testing the student view) is treated as the student.
    return { conversation, isStaff: !!staffRole && !isOwner };
  }

  // ---- Student ----

  /**
   * Students get exactly one active (OPEN) ticket at a time - calling this again returns the existing one (and, if a
   * first message is sent along, adds it there) instead of spawning duplicates. A fresh ticket can be opened once the
   * previous one is resolved. Opening a NEW ticket respects the admin's "Help desk" switch; answering an open one never does.
   */
  async startOrGetConversation(
    studentId: string,
    input: { category?: string; subject?: string; message?: string; context?: unknown } = {},
  ) {
    const message = (input.message ?? '').trim();
    const existing = await this.prisma.supportConversation.findFirst({
      where: { studentId, status: 'OPEN' },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) {
      if (message) await this.postMessage(existing.id, studentId, 'STUDENT', message);
      return { conversation: existing, isNew: false };
    }

    await this.features.assertEnabled('helpDesk', 'The help desk is closed for new tickets right now. Please try again later.');
    const category: TicketCategory = normalizeCategory(input.category);
    const conversation = await this.prisma.supportConversation.create({
      data: {
        studentId,
        category,
        priority: defaultPriorityFor(category),
        subject: input.subject?.trim() ? previewText(input.subject, 80) : null,
        contextJson: (cleanContext(input.context) as any) ?? undefined,
      },
    });
    if (message) await this.postMessage(conversation.id, studentId, 'STUDENT', message);
    return { conversation, isNew: true };
  }

  /** Student: their tickets (newest first) with unread counts and what they can still do (rate / reopen). */
  async studentConversations(studentId: string) {
    const cfg = await this.config();
    const rows = await this.prisma.supportConversation.findMany({
      where: { studentId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    const unread = await this.prisma.supportMessage.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: rows.map((r) => r.id) }, senderRole: { not: 'STUDENT' }, readAt: null, isInternal: false },
      _count: { _all: true },
    });
    const unreadMap = new Map(unread.map((g) => [g.conversationId, g._count._all]));
    return {
      conversations: rows.map((c) => ({
        id: c.id,
        ticketNo: c.ticketNo,
        status: c.status,
        category: c.category,
        subject: c.subject,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        resolvedAt: c.resolvedAt,
        rating: c.rating,
        unreadCount: unreadMap.get(c.id) ?? 0,
        canRate: c.status === 'RESOLVED' && c.rating == null,
        canReopen: canReopen(c.status, c.resolvedAt, cfg.reopenDays),
      })),
    };
  }

  async rate(studentId: string, conversationId: string, rating: unknown, note?: unknown) {
    const c = await this.prisma.supportConversation.findUnique({ where: { id: conversationId } });
    if (!c || c.studentId !== studentId) throw new NotFoundException('Ticket not found');
    if (c.status !== 'RESOLVED') throw new ConflictException('You can rate a ticket after it is resolved.');
    const n = Number(rating);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new BadRequestException('Rating must be a whole number from 1 to 5.');
    const text = typeof note === 'string' ? note.trim().slice(0, 500) : '';
    const updated = await this.prisma.supportConversation.update({
      where: { id: conversationId },
      data: { rating: n, ratingNote: text || null },
    });
    return { conversation: { id: updated.id, rating: updated.rating } };
  }

  /** Student brings a resolved ticket back (inside the reopen window). Writing a new message does the same automatically. */
  async reopenMine(studentId: string, conversationId: string) {
    const c = await this.prisma.supportConversation.findUnique({ where: { id: conversationId } });
    if (!c || c.studentId !== studentId) throw new NotFoundException('Ticket not found');
    const cfg = await this.config();
    if (!canReopen(c.status, c.resolvedAt, cfg.reopenDays)) {
      throw new ConflictException('This ticket cannot be reopened any more. Please start a new one.');
    }
    const other = await this.prisma.supportConversation.findFirst({ where: { studentId, status: 'OPEN' } });
    if (other) throw new ConflictException(`You already have an open ticket (#${other.ticketNo}). Continue there.`);
    const updated = await this.prisma.supportConversation.update({ where: { id: conversationId }, data: { status: 'OPEN', resolvedAt: null } });
    return { conversation: updated };
  }

  // ---- Messages ----

  async postMessage(
    conversationId: string,
    senderId: string,
    senderRole: 'STUDENT' | 'ADMIN' | 'MODERATOR',
    content: string,
    opts: { internal?: boolean } = {},
  ) {
    const trimmed = (content || '').trim();
    if (!trimmed) throw new ConflictException('Message cannot be empty');
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new ConflictException(`Message too long (max ${MAX_MESSAGE_LENGTH} characters)`);
    }

    const { conversation, isStaff } = await this.assertConversationAccess(conversationId, senderId);
    const internal = opts.internal === true;
    if (internal && !isStaff) throw new ForbiddenException('Only staff can write internal notes');
    const cfg = await this.config();

    // A student writing on a resolved ticket brings it back (inside the reopen window); staff must reopen first.
    let reopened = false;
    if (conversation.status === 'RESOLVED' && !internal) {
      if (isStaff) {
        throw new ConflictException('This ticket is resolved. Reopen it before replying.');
      }
      if (!canReopen(conversation.status, conversation.resolvedAt, cfg.reopenDays)) {
        throw new ConflictException('This ticket is closed. Start a new one to keep chatting.');
      }
      const other = await this.prisma.supportConversation.findFirst({ where: { studentId: conversation.studentId, status: 'OPEN' } });
      if (other) throw new ConflictException(`You already have an open ticket (#${other.ticketNo}). Continue there.`);
      reopened = true;
    }

    // Flood guard for students (staff are trusted).
    if (!isStaff) {
      const recent = await this.prisma.supportMessage.count({
        where: { senderId, createdAt: { gte: new Date(Date.now() - 60_000) } },
      });
      if (recent >= 8) {
        throw new HttpException('You are sending messages too fast. Please wait a minute.', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    const encrypted = encryptMessageContent(trimmed);
    const now = new Date();
    const convData: Record<string, unknown> = { updatedAt: now };
    if (!internal) {
      if (isStaff) {
        convData.lastStaffMessageAt = now;
        if (!conversation.firstResponseAt) convData.firstResponseAt = now;
        // the first person to answer owns the ticket until somebody reassigns it
        if (!conversation.assignedAdminId) convData.assignedAdminId = senderId;
      } else {
        convData.lastStudentMessageAt = now;
        // First message from the student becomes the inbox preview label.
        if (conversation.subject == null) convData.subject = previewText(trimmed);
        if (reopened) {
          convData.status = 'OPEN';
          convData.resolvedAt = null;
        }
      }
    }

    const [message] = await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: { conversationId, senderId, senderRole: senderRole as any, isInternal: internal, ...encrypted },
        include: { sender: { select: { id: true, fullName: true, role: true } } },
      }),
      this.prisma.supportConversation.update({ where: { id: conversationId }, data: convData as any }),
    ]);

    const plain = {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderRole: message.senderRole,
      senderName: message.sender.fullName,
      content: trimmed,
      isInternal: internal,
      createdAt: message.createdAt,
      readAt: message.readAt,
    };

    // Internal notes never go out on the live channel: the student is in the same room.
    if (!internal) {
      this.chatGateway.emitConversationMessage(conversationId, plain, isStaff ? conversation.studentId : undefined);
    }

    return { message: plain, reopened };
  }

  async listMessages(conversationId: string, userId: string) {
    const { conversation, isStaff } = await this.assertConversationAccess(conversationId, userId);

    const messages = await this.prisma.supportMessage.findMany({
      where: { conversationId, ...(isStaff ? {} : { isInternal: false }) },
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
        this.logger.warn(`Failed to decrypt support message ${m.id}: ${(e as Error).message}`);
        content = '[message unavailable]';
      }
      return {
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        senderRole: m.senderRole,
        senderName: m.sender.fullName,
        content,
        isInternal: m.isInternal,
        createdAt: m.createdAt,
        readAt: m.readAt,
      };
    });

    return {
      messages: decrypted,
      count: decrypted.length,
      ticket: {
        id: conversation.id,
        ticketNo: conversation.ticketNo,
        status: conversation.status,
        category: conversation.category,
        priority: conversation.priority,
        rating: conversation.rating,
      },
    };
  }

  async markRead(conversationId: string, userId: string) {
    const { isStaff: readerIsStaff } = await this.assertConversationAccess(conversationId, userId);
    await this.prisma.supportMessage.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        readAt: null,
        // a student never "reads" internal notes
        ...(readerIsStaff ? {} : { isInternal: false }),
      },
      data: { readAt: new Date() },
    });
    this.chatGateway.emitConversationRead(conversationId, readerIsStaff ? 'ADMIN' : 'STUDENT');
    return { success: true };
  }

  // ---- Staff ----

  /** Admin inbox: filters, "who has waited longest" ordering, reply-target flag, unread count per ticket. */
  async adminInbox(f: InboxFilter, adminId: string) {
    const cfg = await this.config();
    const where: Prisma.SupportConversationWhereInput = {};
    if (f.status) where.status = f.status;
    if (f.category) where.category = normalizeCategory(f.category);
    const pr = normalizePriority(f.priority);
    if (pr) where.priority = pr;
    if (f.assigned === 'mine') where.assignedAdminId = adminId;
    if (f.assigned === 'unassigned') where.assignedAdminId = null;
    const q = (f.q ?? '').trim().replace(/^#/, '');
    if (q) {
      const or: Prisma.SupportConversationWhereInput[] = [
        { subject: { contains: q, mode: 'insensitive' } },
        { student: { fullName: { contains: q, mode: 'insensitive' } } },
        { student: { email: { contains: q, mode: 'insensitive' } } },
      ];
      if (/^\d{1,9}$/.test(q)) or.push({ ticketNo: Number(q) });
      where.OR = or;
    }

    const conversations = await this.prisma.supportConversation.findMany({
      where,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 300,
      include: {
        student: { select: { id: true, fullName: true, email: true } },
        _count: { select: { messages: true } },
      },
    });

    // Unread-from-student counts, one query rather than N+1.
    const unreadGroups = await this.prisma.supportMessage.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: { in: conversations.map((c) => c.id) },
        senderRole: 'STUDENT',
        readAt: null,
      },
      _count: { _all: true },
    });
    const unreadMap = new Map(unreadGroups.map((g) => [g.conversationId, g._count._all]));

    const now = Date.now();
    let rows = conversations.map((c) => {
      const waiting = waitingMinutes(c, now);
      return {
        id: c.id,
        ticketNo: c.ticketNo,
        student: c.student,
        status: c.status,
        category: c.category,
        priority: c.priority,
        subject: c.subject,
        assignedAdminId: c.assignedAdminId,
        messageCount: c._count.messages,
        unreadCount: unreadMap.get(c.id) ?? 0,
        waitingMinutes: waiting,
        sla: slaState(waiting, cfg.slaMinutes),
        rating: c.rating,
        updatedAt: c.updatedAt,
        createdAt: c.createdAt,
      };
    });
    if (f.unread) rows = rows.filter((r) => r.unreadCount > 0);
    if (f.late) rows = rows.filter((r) => r.sla === 'late');

    // Open tickets where the student is waiting come first (urgent > high > ..., then longest wait), then the rest by recency.
    rows.sort((a, b) => {
      const aw = a.waitingMinutes != null ? 1 : 0;
      const bw = b.waitingMinutes != null ? 1 : 0;
      if (aw !== bw) return bw - aw;
      if (aw && bw) {
        const pw = (PRIORITY_WEIGHT[b.priority] ?? 2) - (PRIORITY_WEIGHT[a.priority] ?? 2);
        if (pw) return pw;
        return (b.waitingMinutes ?? 0) - (a.waitingMinutes ?? 0);
      }
      if (a.status !== b.status) return a.status === 'OPEN' ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return { conversations: rows, slaMinutes: cfg.slaMinutes };
  }

  /** Numbers for the top of the inbox. */
  async adminStats(adminId: string) {
    const cfg = await this.config();
    const now = Date.now();
    const open = await this.prisma.supportConversation.findMany({
      where: { status: 'OPEN' },
      select: { id: true, status: true, createdAt: true, lastStudentMessageAt: true, lastStaffMessageAt: true, assignedAdminId: true },
      take: 2000,
    });
    let waiting = 0;
    let late = 0;
    let unassigned = 0;
    let mine = 0;
    for (const c of open) {
      const w = waitingMinutes(c, now);
      if (w != null) waiting++;
      if (slaState(w, cfg.slaMinutes) === 'late') late++;
      if (!c.assignedAdminId) unassigned++;
      if (c.assignedAdminId === adminId) mine++;
    }
    const since30 = new Date(now - 30 * 86_400_000);
    const responded = await this.prisma.supportConversation.findMany({
      where: { createdAt: { gte: since30 }, firstResponseAt: { not: null } },
      select: { createdAt: true, firstResponseAt: true },
      take: 1000,
    });
    const diffs = responded
      .map((c) => (c.firstResponseAt ? (new Date(c.firstResponseAt).getTime() - new Date(c.createdAt).getTime()) / 60000 : null))
      .filter((m): m is number => m != null && m >= 0)
      .sort((a, b) => a - b);
    const avgFirstResponseMin = diffs.length ? Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length) : null;
    const medianFirstResponseMin = diffs.length ? Math.round(diffs[Math.floor(diffs.length / 2)]) : null;
    const resolved24h = await this.prisma.supportConversation.count({
      where: { status: 'RESOLVED', resolvedAt: { gte: new Date(now - 86_400_000) } },
    });
    const rating = await this.prisma.supportConversation.aggregate({
      where: { rating: { not: null }, resolvedAt: { gte: since30 } },
      _avg: { rating: true },
      _count: { rating: true },
    });
    return {
      open: open.length,
      waiting,
      late,
      unassigned,
      mine,
      resolved24h,
      avgFirstResponseMin,
      medianFirstResponseMin,
      avgRating: rating._avg.rating != null ? Math.round(rating._avg.rating * 10) / 10 : null,
      ratingCount: rating._count.rating,
      slaMinutes: cfg.slaMinutes,
    };
  }

  /** Staff side panel: who is this student and what is going on with their account. */
  async ticketDetail(conversationId: string) {
    const c = await this.prisma.supportConversation.findUnique({
      where: { id: conversationId },
      include: {
        student: {
          select: { id: true, fullName: true, email: true, phone: true, state: true, createdAt: true, isSuspended: true, isEmailVerified: true, xp: true },
        },
      },
    });
    if (!c) throw new NotFoundException('Ticket not found');
    const studentId = c.studentId;
    const [sub, payments, attempts, tickets] = await Promise.all([
      this.prisma.subscription.findFirst({
        where: { userId: studentId, status: 'ACTIVE', endsAt: { gt: new Date() } },
        orderBy: { endsAt: 'desc' },
        include: { plan: { select: { name: true } } },
      }),
      this.prisma.payment.findMany({
        where: { userId: studentId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { gatewayOrderId: true, amountInr: true, status: true, createdAt: true },
      }),
      this.prisma.testAttempt.count({ where: { userId: studentId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } } }),
      this.prisma.supportConversation.count({ where: { studentId } }),
    ]);
    return {
      ticket: {
        id: c.id,
        ticketNo: c.ticketNo,
        status: c.status,
        category: c.category,
        priority: c.priority,
        subject: c.subject,
        assignedAdminId: c.assignedAdminId,
        context: c.contextJson ?? null,
        createdAt: c.createdAt,
        firstResponseAt: c.firstResponseAt,
        resolvedAt: c.resolvedAt,
        rating: c.rating,
        ratingNote: c.ratingNote,
      },
      student: c.student,
      plan: sub ? { name: sub.plan?.name ?? 'Plan', endsAt: sub.endsAt } : null,
      payments,
      testsTaken: attempts,
      ticketsTotal: tickets,
    };
  }

  async assign(conversationId: string, adminId: string | null) {
    const c = await this.prisma.supportConversation.findUnique({ where: { id: conversationId }, select: { id: true } });
    if (!c) throw new NotFoundException('Ticket not found');
    if (adminId) {
      const staff = await this.prisma.user.findUnique({ where: { id: adminId }, select: { role: true } });
      if (!staff || (staff.role !== 'ADMIN' && staff.role !== 'MODERATOR')) {
        throw new BadRequestException('That person is not on the support team.');
      }
    }
    const updated = await this.prisma.supportConversation.update({ where: { id: conversationId }, data: { assignedAdminId: adminId } });
    return { conversation: updated };
  }

  async updateMeta(conversationId: string, meta: { priority?: unknown; category?: unknown }) {
    const data: { priority?: string; category?: string } = {};
    if (meta.priority !== undefined) {
      const p = normalizePriority(meta.priority);
      if (!p) throw new BadRequestException('Priority must be LOW, NORMAL, HIGH or URGENT.');
      data.priority = p;
    }
    if (meta.category !== undefined) data.category = normalizeCategory(meta.category);
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to change.');
    const c = await this.prisma.supportConversation.findUnique({ where: { id: conversationId }, select: { id: true } });
    if (!c) throw new NotFoundException('Ticket not found');
    const updated = await this.prisma.supportConversation.update({ where: { id: conversationId }, data });
    return { conversation: updated };
  }

  async resolveConversation(conversationId: string, adminId: string) {
    const conversation = await this.prisma.supportConversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('Ticket not found');
    const updated = await this.prisma.supportConversation.update({
      where: { id: conversationId },
      data: { status: 'RESOLVED', resolvedAt: new Date(), assignedAdminId: conversation.assignedAdminId ?? adminId },
    });
    this.chatGateway.emitConversationMessage(
      conversationId,
      { system: true, content: 'This ticket was marked resolved.' },
      conversation.studentId,
    );
    return { conversation: updated };
  }

  async reopenConversation(conversationId: string) {
    const c = await this.prisma.supportConversation.findUnique({ where: { id: conversationId }, select: { studentId: true } });
    if (!c) throw new NotFoundException('Ticket not found');
    const other = await this.prisma.supportConversation.findFirst({ where: { studentId: c.studentId, status: 'OPEN', id: { not: conversationId } } });
    if (other) throw new ConflictException(`This student already has an open ticket (#${other.ticketNo}).`);
    const updated = await this.prisma.supportConversation.update({
      where: { id: conversationId },
      data: { status: 'OPEN', resolvedAt: null },
    });
    return { conversation: updated };
  }

  /** Closes tickets where staff replied last and the student has been silent for the configured number of days. */
  async autoCloseStale(now: number = Date.now()): Promise<number> {
    const cfg = await this.config();
    const cutoff = new Date(now - cfg.autoCloseDays * 86_400_000);
    const candidates = await this.prisma.supportConversation.findMany({
      where: { status: 'OPEN', lastStaffMessageAt: { lt: cutoff } },
      select: { id: true, status: true, createdAt: true, lastStudentMessageAt: true, lastStaffMessageAt: true, studentId: true },
      take: 500,
    });
    const due = candidates.filter((c) => shouldAutoClose(c, cfg.autoCloseDays, now));
    if (due.length === 0) return 0;
    await this.prisma.supportConversation.updateMany({
      where: { id: { in: due.map((c) => c.id) }, status: 'OPEN' },
      data: { status: 'RESOLVED', resolvedAt: new Date(now) },
    });
    for (const c of due) {
      try {
        this.chatGateway.emitConversationMessage(
          c.id,
          { system: true, content: `Closed automatically after ${cfg.autoCloseDays} days without a reply. Write again to reopen it.` },
          c.studentId,
        );
      } catch {
        // live notice is a courtesy only
      }
    }
    return due.length;
  }
}
