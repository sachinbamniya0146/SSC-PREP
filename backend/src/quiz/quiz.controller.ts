import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { QuizService } from './quiz.service';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('quiz')
@UseGuards(JwtAuthGuard)
export class QuizController {
  constructor(private readonly quizService: QuizService) {}

  @Get('today')
  getToday() {
    return this.quizService.getToday();
  }

  @Post('submit')
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { quizId: string; answers: Array<{ questionId: string; selectedOption?: string | null }> },
  ) {
    return this.quizService.submitQuiz(user.userId, body.quizId, body.answers);
  }

  @Get('history')
  getHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.quizService.getHistory(user.userId);
  }
}
