import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminHelpController } from './admin-help.controller';
import { AdminService } from './admin.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { MonetizationModule } from '../monetization/monetization.module';

@Module({
  imports: [AuditLogModule, MonetizationModule],
  controllers: [AdminController, AdminHelpController],
  providers: [AdminService],
})
export class AdminModule {}
