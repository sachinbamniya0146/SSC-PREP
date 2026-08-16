import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { MonetizationModule } from '../monetization/monetization.module';

@Module({
  imports: [AuditLogModule, MonetizationModule],
  controllers: [AdminController],
})
export class AdminModule {}
