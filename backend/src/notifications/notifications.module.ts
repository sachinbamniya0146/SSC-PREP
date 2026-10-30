import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NudgeService } from './nudge.service';

@Module({
  imports: [PushModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NudgeService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
