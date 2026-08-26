import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { BankModule } from '../bank/bank.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { MonetizationModule } from '../monetization/monetization.module';

@Module({
  imports: [PrismaModule, BankModule, AuditLogModule, MonetizationModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
