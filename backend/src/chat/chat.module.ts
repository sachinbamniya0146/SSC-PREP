import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';

/**
 * ChatModule — owns the single ChatGateway instance shared by both
 * report-thread messages (report-error module) and general support chat
 * (support-chat module). Kept as its own module (rather than declaring the
 * gateway inside report-error or support-chat) specifically so BOTH of
 * those modules can import it without importing each other.
 */
@Module({
  providers: [ChatGateway],
  exports: [ChatGateway],
})
export class ChatModule {}
