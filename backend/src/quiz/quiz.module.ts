import { Module } from '@nestjs/common';
import { QuizService } from './quiz.service';
import { QuizController } from './quiz.controller';
import { ReviewModule } from '../review/review.module';
import { GamificationModule } from '../gamification/gamification.module';

@Module({
  imports: [ReviewModule, GamificationModule],
  providers: [QuizService],
  controllers: [QuizController],
  exports: [QuizService],
})
export class QuizModule {}