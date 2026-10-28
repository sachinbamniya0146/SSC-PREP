/* eslint-disable @typescript-eslint/no-explicit-any */
import { Controller, Get, Post, Put, Patch, Body, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Department } from '../common/decorators/department.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SupportChatService } from './support-chat.service';
import { DEFAULT_HELPDESK_CONFIG, TICKET_CATEGORIES, TICKET_PRIORITIES } from './helpdesk-config';

@Controller('support-chat')
@UseGuards(JwtAuthGuard)
export class SupportChatController {
  constructor(
    private readonly supportChat: SupportChatService,
    private readonly audit: AuditLogService,
  ) {}

  // ---- Student-facing ----

  /**
   * Get (or open) the student's active ticket. Optionally carries the first message, the category and where the student
   * was (page / attempt / order) so the admin sees the context without asking.
   */
  @Post('start')
  async start(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { category?: string; subject?: string; message?: string; context?: unknown } = {},
  ) {
    return this.supportChat.startOrGetConversation(user.userId, body ?? {});
  }

  @Get('my-conversations')
  async myConversations(@CurrentUser() user: AuthenticatedUser) {
    return this.supportChat.studentConversations(user.userId);
  }

  @Get('my-tickets')
  async myTickets(@CurrentUser() user: AuthenticatedUser) {
    return this.supportChat.studentConversations(user.userId);
  }

  // ---- Admin-only (declared before the ':id' routes so "admin" is never read as an id) ----

  @Get('admin/inbox')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Department('SUPPORT')
  async adminInbox(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('priority') priority?: string,
    @Query('assigned') assigned?: string,
    @Query('q') q?: string,
    @Query('unread') unread?: string,
    @Query('late') late?: string,
  ) {
    return this.supportChat.adminInbox(
      {
        status: status === 'OPEN' || status === 'RESOLVED' ? status : undefined,
        category: category || undefined,
        priority: priority || undefined,
        assigned: assigned || undefined,
        q: q || undefined,
        unread: unread === '1' || unread === 'true',
        late: late === '1' || late === 'true',
      },
      user.userId,
    );
  }

  @Get('admin/stats')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Department('SUPPORT')
  async adminStats(@CurrentUser() user: AuthenticatedUser) {
    return this.supportChat.adminStats(user.userId);
  }

  /** Saved replies + the lists the inbox filters need. Any support staff may read; only admins may edit. */
  @Get('admin/config')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Department('SUPPORT')
  async getConfig() {
    return { config: await this.supportChat.config(), defaults: DEFAULT_HELPDESK_CONFIG, categories: TICKET_CATEGORIES, priorities: TICKET_PRIORITIES };
  }

  @Put('admin/config')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async saveConfig(@CurrentUser() admin: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    const { config, before } = await this.supportChat.saveConfig(body, admin.userId);
    await this.audit.log({
      userId: admin.userId,
      action: 'HELPDESK_SETTINGS_CHANGED',
      targetEntity: 'AppSetting',
      entityId: 'helpdesk.config',
      metadataJson: { before: { ...before, canned: before.canned.length }, after: { ...config, canned: config.canned.length } } as any,
    });
    return { config };
  }

  // ---- Shared (the student who owns it, or any support staff) - access checked in the service ----

  @Get(':id/messages')
  async listMessages(@CurrentUser() user: AuthenticatedUser, @Param('id') conversationId: string) {
    return this.supportChat.listMessages(conversationId, user.userId);
  }

  @Post(':id/messages')
  async postMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') conversationId: string,
    @Body() body: { content: string; internal?: boolean },
  ) {
    if (!body?.content) throw new BadRequestException('content is required');
    return this.supportChat.postMessage(conversationId, user.userId, user.role, body.content, { internal: body.internal === true });
  }

  @Post(':id/messages/read')
  async markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') conversationId: string) {
    return this.supportChat.markRead(conversationId, user.userId);
  }

  // ---- Student: after the ticket is resolved ----

  @Post(':id/rate')
  async rate(@CurrentUser() user: AuthenticatedUser, @Param('id') conversationId: string, @Body() body: { rating: number; note?: string }) {
    return this.supportChat.rate(user.userId, conversationId, body?.rating, body?.note);
  }

  @Post(':id/reopen-mine')
  async reopenMine(@CurrentUser() user: AuthenticatedUser, @Param('id') conversationId: string) {
    return this.supportChat.reopenMine(user.userId, conversationId);
  }

  // ---- Staff actions on one ticket ----

  @Get(':id/detail')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Department('SUPPORT')
  async detail(@Param('id') conversationId: string) {
    return this.supportChat.ticketDetail(conversationId);
  }

  @Post(':id/resolve')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Department('SUPPORT')
  async resolve(@CurrentUser() user: AuthenticatedUser, @Param('id') conversationId: string) {
    return this.supportChat.resolveConversation(conversationId, user.userId);
  }

  @Post(':id/reopen')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Department('SUPPORT')
  async reopen(@Param('id') conversationId: string) {
    return this.supportChat.reopenConversation(conversationId);
  }

  /** body.to = "me" takes the ticket, "none" releases it, anything else is a staff user id. */
  @Post(':id/assign')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Department('SUPPORT')
  async assign(@CurrentUser() user: AuthenticatedUser, @Param('id') conversationId: string, @Body() body: { to?: string }) {
    const to = body?.to ?? 'me';
    return this.supportChat.assign(conversationId, to === 'none' ? null : to === 'me' ? user.userId : to);
  }

  @Patch(':id/meta')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @Department('SUPPORT')
  async meta(@Param('id') conversationId: string, @Body() body: { priority?: string; category?: string }) {
    return this.supportChat.updateMeta(conversationId, body ?? {});
  }
}
