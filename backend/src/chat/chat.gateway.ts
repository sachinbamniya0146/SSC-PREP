import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

interface SocketAuthPayload {
  sub: string;
  email: string;
  role: string;
  sid: string;
  type: string;
}

interface AuthedSocket extends Socket {
  data: {
    userId: string;
    role: 'STUDENT' | 'ADMIN' | 'MODERATOR';
  };
}

/**
 * ChatGateway — real-time delivery for BOTH chat systems built for Sachin's
 * "students report + chat with admin" request:
 *   1. Report-thread chat (ReportMessage) — tied to one QuestionErrorReport
 *   2. General support chat (SupportMessage) — student ↔ admin, not tied to
 *      a specific question
 *
 * One gateway, two "room families" (`report:<reportId>` and
 * `conv:<conversationId>`), so a single socket connection covers both —
 * a student doesn't need two separate WebSocket connections open.
 *
 * AUTH: reuses the exact same access-token verification as JwtAuthGuard
 * (backend/src/common/guards/jwt-auth.guard.ts) but done manually in
 * handleConnection, because NestJS's built-in guards don't run on the
 * WebSocket upgrade handshake the same way — see NestJS WS docs. The token
 * is read from the Socket.io handshake auth payload (`socket.handshake.auth.token`),
 * which the frontend sets when it calls io(url, { auth: { token } }) — see
 * frontend/src/lib/chat-socket.ts.
 *
 * DELIVERY MODEL: the actual message write (encrypt + Prisma create)
 * happens over the normal REST endpoints in report-error.service.ts /
 * support-chat.service.ts — NOT here. Those services call
 * ChatGateway.emitToReportRoom()/emitToConversationRoom() after a
 * successful write, so REST stays the single source of truth (simpler auth,
 * validation, and rate-limiting reuse) and the socket is purely a
 * "someone in this room just posted, and here's the decrypted content for
 * whoever's listening" push channel. This also means chat still works
 * (just without instant push) if a client's socket briefly disconnects —
 * the REST history endpoint is always the ground truth on reconnect/poll.
 */
@Injectable()
@WebSocketGateway({
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Mirrors the HTTP CORS allow-list in main.ts — kept in sync manually
      // since socket.io's cors option can't import an Express middleware.
      const frontendUrl = process.env.FRONTEND_URL || 'https://sscprephub.in';
      const allowList = [
        frontendUrl,
        frontendUrl.replace('localhost', '127.0.0.1'),
        frontendUrl.replace('https://', 'https://www.'),
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3001',
      ];
      if (!origin) return callback(null, true);
      if (allowList.includes(origin)) return callback(null, true);
      const lanPrefixes = ['192.168.', '10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.'];
      const isLan = lanPrefixes.some((p) => origin.startsWith(`http://${p}`) || origin.startsWith(`https://${p}`));
      if (isLan) return callback(null, true);
      callback(null, false);
    },
    credentials: true,
  },
  // socket.io mounts under /api/v1/socket.io by default given the path
  // below — matches nginx's /api/v1/ location block, which already
  // forwards the Upgrade/Connection headers needed for WebSocket (see
  // nginx/conf.d/sscprephub.conf).
  path: '/api/v1/socket.io',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger('ChatGateway');

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(socket: AuthedSocket) {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ||
        (socket.handshake.headers?.authorization?.toString().replace(/^Bearer /, ''));
      if (!token) throw new Error('Missing token');

      const payload = await this.jwtService.verifyAsync<SocketAuthPayload>(token);
      if (payload.type !== 'access' || !payload.sub) throw new Error('Invalid token type');

      // Same single-active-session check as JwtAuthGuard — a logged-out
      // device's still-technically-valid token shouldn't get a live socket.
      const session = await this.prisma.deviceSession.findUnique({ where: { id: payload.sid } });
      if (!session || !session.isActive) throw new Error('Session inactive');

      socket.data.userId = payload.sub;
      socket.data.role = payload.role as 'STUDENT' | 'ADMIN' | 'MODERATOR';

      // Admins auto-join a global "admin inbox" room so the admin chat list
      // can show live new-message badges without joining every conversation
      // room individually.
      if (socket.data.role === 'ADMIN' || socket.data.role === 'MODERATOR') {
        socket.join('admins');
      }
      // Every user joins their own personal room — used to push
      // "you have a new reply" notifications regardless of which specific
      // report/conversation room they currently have open in the UI.
      socket.join(`user:${socket.data.userId}`);
    } catch (err) {
      this.logger.warn(`Rejected socket connection: ${(err as Error).message}`);
      socket.disconnect(true);
    }
  }

  handleDisconnect(_socket: AuthedSocket) {
    // No explicit cleanup needed — socket.io removes room memberships
    // automatically on disconnect.
  }

  /**
   * Client asks to join a specific report thread's room. Ownership/role
   * check mirrors report-error.service.ts's access rule: the reporting
   * student, or any ADMIN/MODERATOR, may join.
   */
  @SubscribeMessage('report:join')
  async onJoinReport(@ConnectedSocket() socket: AuthedSocket, @MessageBody() data: { reportId: string }) {
    if (!data?.reportId) return;
    if (socket.data.role === 'ADMIN' || socket.data.role === 'MODERATOR') {
      socket.join(`report:${data.reportId}`);
      return;
    }
    const report = await this.prisma.questionErrorReport.findUnique({
      where: { id: data.reportId },
      select: { userId: true },
    });
    if (report && report.userId === socket.data.userId) {
      socket.join(`report:${data.reportId}`);
    }
  }

  @SubscribeMessage('report:leave')
  onLeaveReport(@ConnectedSocket() socket: AuthedSocket, @MessageBody() data: { reportId: string }) {
    if (data?.reportId) socket.leave(`report:${data.reportId}`);
  }

  /** Same pattern for general support conversations. */
  @SubscribeMessage('conversation:join')
  async onJoinConversation(@ConnectedSocket() socket: AuthedSocket, @MessageBody() data: { conversationId: string }) {
    if (!data?.conversationId) return;
    if (socket.data.role === 'ADMIN' || socket.data.role === 'MODERATOR') {
      socket.join(`conv:${data.conversationId}`);
      return;
    }
    const conv = await this.prisma.supportConversation.findUnique({
      where: { id: data.conversationId },
      select: { studentId: true },
    });
    if (conv && conv.studentId === socket.data.userId) {
      socket.join(`conv:${data.conversationId}`);
    }
  }

  @SubscribeMessage('conversation:leave')
  onLeaveConversation(@ConnectedSocket() socket: AuthedSocket, @MessageBody() data: { conversationId: string }) {
    if (data?.conversationId) socket.leave(`conv:${data.conversationId}`);
  }

  /** Typing indicator — report thread. Fire-and-forget, no persistence. */
  @SubscribeMessage('report:typing')
  onReportTyping(@ConnectedSocket() socket: AuthedSocket, @MessageBody() data: { reportId: string }) {
    if (!data?.reportId) return;
    socket.to(`report:${data.reportId}`).emit('report:typing', {
      reportId: data.reportId,
      userId: socket.data.userId,
      role: socket.data.role,
    });
  }

  @SubscribeMessage('conversation:typing')
  onConversationTyping(@ConnectedSocket() socket: AuthedSocket, @MessageBody() data: { conversationId: string }) {
    if (!data?.conversationId) return;
    socket.to(`conv:${data.conversationId}`).emit('conversation:typing', {
      conversationId: data.conversationId,
      userId: socket.data.userId,
      role: socket.data.role,
    });
  }

  // ---- Server-side emit helpers, called by report-error.service.ts /
  // support-chat.service.ts after a message is persisted. Not @SubscribeMessage
  // handlers — plain methods invoked directly via DI.

  /** Push a newly-sent report-thread message to everyone in that room, plus notify the other party's personal room (so it shows up even if they don't have the thread open). */
  emitReportMessage(reportId: string, message: unknown, notifyUserId?: string) {
    this.server.to(`report:${reportId}`).emit('report:message', { reportId, message });
    this.server.to('admins').emit('report:new-message-admin-inbox', { reportId });
    if (notifyUserId) {
      this.server.to(`user:${notifyUserId}`).emit('report:notify', { reportId, message });
    }
  }

  emitReportStatusChange(reportId: string, status: string, notifyUserId?: string) {
    this.server.to(`report:${reportId}`).emit('report:status', { reportId, status });
    if (notifyUserId) {
      this.server.to(`user:${notifyUserId}`).emit('report:status', { reportId, status });
    }
  }

  emitConversationMessage(conversationId: string, message: unknown, notifyUserId?: string) {
    this.server.to(`conv:${conversationId}`).emit('conversation:message', { conversationId, message });
    this.server.to('admins').emit('conversation:new-message-admin-inbox', { conversationId });
    if (notifyUserId) {
      this.server.to(`user:${notifyUserId}`).emit('conversation:notify', { conversationId, message });
    }
  }

  emitConversationRead(conversationId: string, readerRole: 'STUDENT' | 'ADMIN' | 'MODERATOR') {
    this.server.to(`conv:${conversationId}`).emit('conversation:read', { conversationId, readerRole });
  }
}
