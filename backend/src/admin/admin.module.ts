import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminHelpController } from './admin-help.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { BankModule } from '../bank/bank.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { MonetizationModule } from '../monetization/monetization.module';

// BUG FIX (audit round 3): AdminHelpController (GET /admin/help/formats,
// /admin/help/prompts, /admin/help/templates/excel|csv|json|text — the
// question-upload template downloads + AI-prompt cheatsheet) was written but
// never added to `controllers`, so every one of those routes 404'd. Nest only
// mounts controllers/providers that are explicitly listed in a module.
@Module({
  imports: [PrismaModule, BankModule, AuditLogModule, MonetizationModule],
  controllers: [AdminController, AdminHelpController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
