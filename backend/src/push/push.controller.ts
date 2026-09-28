import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PushService } from './push.service';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SubscribeDto, UnsubscribeDto, BroadcastDto } from './dto/push.dto';

@ApiTags('Push Notifications')
@ApiBearerAuth()
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  // Any logged-in user (student or staff) may register a device — no
  // @Roles() restriction needed, JwtAuthGuard (global) already requires
  // a valid session.
  @Post('subscribe')
  @ApiOperation({ summary: 'Register this browser/device for push notifications' })
  subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubscribeDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.push.subscribe(user.userId, dto, userAgent);
  }

  @Post('unsubscribe')
  @ApiOperation({ summary: 'Remove this browser/device from push notifications' })
  unsubscribe(@Body() dto: UnsubscribeDto) {
    return this.push.unsubscribe(dto.endpoint);
  }

  // Admin-only broadcast: "admin chahe to kuch new notification sbh
  // students ke mobile pr send kr ske" — sends one message to every
  // subscribed STUDENT device.
  @Roles('ADMIN')
  @Post('admin/broadcast')
  @ApiOperation({ summary: 'Admin: send a push notification to all students' })
  broadcast(@Body() dto: BroadcastDto) {
    return this.push.broadcastToAllStudents(dto);
  }
}
