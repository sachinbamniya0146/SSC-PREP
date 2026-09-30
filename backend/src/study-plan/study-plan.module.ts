import { Module } from '@nestjs/common';
import { StudyPlanService } from './study-plan.service';
import { StudyPlanV2Service } from './study-plan-v2.service';
import { StudyPlanController } from './study-plan.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [StudyPlanController],
  providers: [StudyPlanService, StudyPlanV2Service],
  exports: [StudyPlanService, StudyPlanV2Service],
})
export class StudyPlanModule {}
