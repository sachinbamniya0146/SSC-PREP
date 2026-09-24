import { Injectable, NotFoundException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../chat/chat.gateway';
import { encryptMessageContent, decryptMessageContent } from '../common/crypto/message-encryption';

const MAX_MESSAGE_LENGTH = 4000;

/**
 * SupportChatService — general "Chat with Admin" support conversations,
 * separate from ReportErrorService's per-report threads (Sachin's decision:
 * "dono — per-report thread + general support chat bhi"). A student opens
 * one conversation (reused across visits — see startOrGetConversation) and
 * any admin/moderator can pick it up and reply from a shared inbox.
 */
@Injectable()
export class SupportChatService {
  private readonly logger = new Logger(SupportChatService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatGateway: ChatGateway,
  ) {}

  /**
   * Students get exactly one active (OPEN) conversation at a time — calling
   * this again just returns the existing one instead of spawning
   * duplicates, similar in spirit to report()'s one-open-report-per-question
   * guard. A student can still get a fresh conversation once an admin marks
   * the previous one RESOLVED.
   */
  async startOrGetConversation(studentId: string) {
    const existing = await this.prisma.supportConversation.findFirst({
      where: { studentId, status: 'OPEN' },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) return { conversation: existing, isNew: false };

    const conversation = await this.prisma.supportConversation.create({
      data: { studentId },
    });
    return { conversation, isNew: true };
  }

  private async assertConversationAccess(conversationId: string, userId: string, role: string) {
    const conversation = await this.prisma.supportConversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const isOwner = conversation.studentId === userId;
    const isStaff = role === 'ADMIN' || role === 'MODERATOR';
    if (!isOwner && !isStaff) {
      throw new ForbiddenException('You do not have access to this conversation');
    }
    return { conversation, isStaff };
  }

  async postMessage(
    conversationId: string,
    senderId: string,
    senderRole: 'STUDENT' | 'ADMIN' | 'MODERATOR',
    content: string,
  ) {
    const trimmed = (content || '').trim();
    if (!trimmed) throw new ConflictException('Message cannot be empty');
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new ConflictException(`Message too long (max ${MAX_MESSAGE_LENGTH} characters)`);
    }

    const { conversation, isStaff } = await this.assertConversationAccess(conversationId, senderId, senderRole);
    if (conversation.status === 'RESOLVED') {
      throw new ConflictException('This conversation is closed. Start a new one to keep chatting.');
    }
    const encrypted = encryptMessageContent(trimmed);

    const [message] = await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: { conversationId, senderId, senderRole: senderRole as any, ...encrypted },
        include: { sender: { select: { id: true, fullName: true, role: true } } },
      }),
      this.prisma.supportConversation.update({
        where: { id: conversationId },
        data: {
          updatedAt: new Date(),
          ...(isStaff ? { assignedAdminId: senderId } : {}),
          // First message from the student becomes the inbox preview label.
          ...(conversation.subject == null && !isStaff ? { subject: trimmed.slice(0, 80) } : {}),
        },
      }),
    ]);

    const plain = {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderRole: message.senderRole,
      senderName: message.sender.fullName,
      content: trimmed,
      createdAt: message.createdAt,
      readAt: message.readAt,
    };

    const notifyUserId = isStaff ? conversation.studentId : undefined;
    this.chatGateway.emitConversationMessage(conversationId, plain, notifyUserId);

    return { message: plain };
  }

  async listMessages(conversationId: string, userId: string, role: string) {
    await this.assertConversationAccess(conversationId, userId, role);

    const messages = await this.prisma.supportMessage.findMany({
      where: { conversationId },
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
        createdAt: m.createdAt,
        readAt: m.readAt,
      };
    });

    return { messages: decrypted, count: decrypted.length };
  }

  async markRead(conversationId: string, userId: string, role: string) {
    const { isStaff } = await this.assertConversationAccess(conversationId, userId, role);
    await this.prisma.supportMessage.updateMany({
      where: { conversationId, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });
    this.chatGateway.emitConversationRead(conversationId, isStaff ? 'ADMIN' : 'STUDENT');
    return { success: true };
  }

  /** Admin: full inbox — open conversations first, most recently active first, with an unread count per conversation. */
  async adminInbox(status?: 'OPEN' | 'RESOLVED') {
    const conversations = await this.prisma.supportConversation.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 200,
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

    return {
      conversations: conversations.map((c) => ({
        id: c.id,
        student: c.student,
        status: c.status,
        subject: c.subject,
        assignedAdminId: c.assignedAdminId,
        messageCount: c._count.messages,
        unreadCount: unreadMap.get(c.id) ?? 0,
        updatedAt: c.updatedAt,
        createdAt: c.createdAt,
      })),
    };
  }

  /** Student: their own conversation history (usually just the one active + past resolved ones). */
  async studentConversations(studentId: string) {
    const conversations = await this.prisma.supportConversation.findMany({
      where: { studentId },
      orderBy: { updatedAt: 'desc' },
    });
    return { conversations };
  }

  async resolveConversation(conversationId: string, adminId: string) {
    const conversation = await this.prisma.supportConversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const updated = await this.prisma.supportConversation.update({
      where: { id: conversationId },
      data: { status: 'RESOLVED', assignedAdminId: adminId },
    });
    this.chatGateway.emitConversationMessage(
      conversationId,
      { system: true, content: 'This conversation was marked resolved by admin.' },
      conversation.studentId,
    );
    return { conversation: updated };
  }

  async reopenConversation(conversationId: string) {
    const updated = await this.prisma.supportConversation.update({
      where: { id: conversationId },
      data: { status: 'OPEN' },
    });
    return { conversation: updated };
  }
}
