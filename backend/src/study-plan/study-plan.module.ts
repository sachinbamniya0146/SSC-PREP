import { Module } from '@nestjs/common';
import { StudyPlanService } from './study-plan.service';
import { StudyPlanController } from './study-plan.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [StudyPlanController],
  providers: [StudyPlanService],
  exports: [StudyPlanService],
})
export class StudyPlanModule {}
