import { Module } from '@nestjs/common';
import { StudyStatsController } from './study-stats.controller';
import { StudyStatsService } from './study-stats.service';

@Module({ controllers: [StudyStatsController], providers: [StudyStatsService] })
export class StudyStatsModule {}
