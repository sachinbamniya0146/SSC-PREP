import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

// PrismaModule and AuditLogModule are @Global(), so nothing else to import.
@Module({
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
