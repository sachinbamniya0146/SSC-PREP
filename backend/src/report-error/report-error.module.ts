import { Module } from '@nestjs/common';
import { ReportErrorService } from './report-error.service';
import { ReportErrorController } from './report-error.controller';
import { ChatModule } from '../chat/chat.module';
import { PushModule } from '../push/push.module';

@Module({
  imports: [ChatModule, PushModule],
  providers: [ReportErrorService],
  controllers: [ReportErrorController],
  exports: [ReportErrorService],
})
export class ReportErrorModule {}
