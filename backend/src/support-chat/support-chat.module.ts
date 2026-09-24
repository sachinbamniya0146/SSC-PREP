import { Module } from '@nestjs/common';
import { SupportChatService } from './support-chat.service';
import { SupportChatController } from './support-chat.controller';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [ChatModule],
  providers: [SupportChatService],
  controllers: [SupportChatController],
  exports: [SupportChatService],
})
export class SupportChatModule {}
