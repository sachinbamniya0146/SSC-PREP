import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { NotificationsService } from './notifications.service';
import { AdminSendDto, AudienceDto, MarkReadDto, PrefsDto } from './notifications.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'My inbox (newest first) and the unread count' })
  list(@CurrentUser() u: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.svc.list(u.userId, limit ? Number(limit) : 40);
  }

  @Get('unread-count')
  unread(@CurrentUser() u: AuthenticatedUser) {
    return this.svc.unreadCount(u.userId);
  }

  @Post('read')
  read(@CurrentUser() u: AuthenticatedUser, @Body() dto: MarkReadDto) {
    return this.svc.markRead(u.userId, dto.ids);
  }

  @Post('read-all')
  readAll(@CurrentUser() u: AuthenticatedUser) {
    return this.svc.markAllRead(u.userId);
  }

  @Get('prefs')
  prefs(@CurrentUser() u: AuthenticatedUser) {
    return this.svc.getPrefs(u.userId);
  }

  @Put('prefs')
  setPrefs(@CurrentUser() u: AuthenticatedUser, @Body() dto: PrefsDto) {
    return this.svc.updatePrefs(u.userId, dto);
  }

  @Roles('ADMIN')
  @Post('admin/audience')
  @ApiOperation({ summary: 'Admin: how many students (and phones) an audience reaches' })
  audience(@Body() dto: AudienceDto) {
    return this.svc.audienceCount(dto);
  }

  @Roles('ADMIN')
  @Post('admin/send')
  @ApiOperation({ summary: 'Admin: call a group of students (inbox + phone push)' })
  send(@Body() dto: AdminSendDto) {
    return this.svc.adminSend(dto);
  }
}
