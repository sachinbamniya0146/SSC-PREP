import { Module } from '@nestjs/common';
import { ReportErrorService } from './report-error.service';
import { ReportErrorController } from './report-error.controller';

@Module({
  providers: [ReportErrorService],
  controllers: [ReportErrorController],
  exports: [ReportErrorService],
})
export class ReportErrorModule {}
