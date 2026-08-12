import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [AuditLogModule],
  controllers: [AdminController],
})
export class AdminModule {}
