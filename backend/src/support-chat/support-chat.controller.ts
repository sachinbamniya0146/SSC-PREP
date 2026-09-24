import { Controller, Get, Post, Body, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { SupportChatService } from './support-chat.service';

@Controller('support-chat')
@UseGuards(JwtAuthGuard)
export class SupportChatController {
  constructor(private readonly supportChat: SupportChatService) {}

  // ---- Student-facing ----

  /** Get (or create) the student's active conversation. Frontend calls this when the "Chat with Admin" panel opens. */
  @Post('start')
  async start(@CurrentUser() user: AuthenticatedUser) {
    return this.supportChat.startOrGetConversation(user.userId);
  }

  @Get('my-conversations')
  async myConversations(@CurrentUser() user: AuthenticatedUser) {
    return this.supportChat.studentConversations(user.userId);
  }

  // ---- Shared (student who owns it, or any admin/mod) — access checked in service ----

  @Get(':id/messages')
  async listMessages(@CurrentUser() user: AuthenticatedUser, @Param('id') conversationId: string) {
    return this.supportChat.listMessages(conversationId, user.userId, user.role);
  }

  @Post(':id/messages')
  async postMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') conversationId: string,
    @Body() body: { content: string },
  ) {
    if (!body?.content) throw new BadRequestException('content is required');
    return this.supportChat.postMessage(conversationId, user.userId, user.role, body.content);
  }

  @Post(':id/messages/read')
  async markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') conversationId: string) {
    return this.supportChat.markRead(conversationId, user.userId, user.role);
  }

  // ---- Admin-only ----

  @Get('admin/inbox')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async adminInbox(@Query('status') status?: 'OPEN' | 'RESOLVED') {
    return this.supportChat.adminInbox(status);
  }

  @Post(':id/resolve')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async resolve(@CurrentUser() user: AuthenticatedUser, @Param('id') conversationId: string) {
    return this.supportChat.resolveConversation(conversationId, user.userId);
  }

  @Post(':id/reopen')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async reopen(@Param('id') conversationId: string) {
    return this.supportChat.reopenConversation(conversationId);
  }
}
