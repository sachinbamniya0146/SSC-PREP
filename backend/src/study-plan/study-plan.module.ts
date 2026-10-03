import { Module } from '@nestjs/common';
import { StudyPlanService } from './study-plan.service';
import { StudyPlanV2Service } from './study-plan-v2.service';
import { StudyPlanController } from './study-plan.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StudyPlanReminderService } from './study-plan-reminder.service';
import { MailService } from '../auth/mail.service';

@Module({
  imports: [PrismaModule],
  controllers: [StudyPlanController],
  providers: [StudyPlanService, StudyPlanV2Service, StudyPlanReminderService, MailService],
  exports: [StudyPlanService, StudyPlanV2Service],
})
export class StudyPlanModule {}
