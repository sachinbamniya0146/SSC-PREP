import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('performance')
  getPerformance(@CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.analyzeChapterPerformance(user.userId);
  }

  @Get('chapter/:chapterId')
  getChapter(@CurrentUser() user: AuthenticatedUser, @Param('chapterId') chapterId: string) {
    return this.analyticsService.analyzeChapter(user.userId, chapterId);
  }

  @Get('chapter/:chapterId/drill')
  getDrill(@CurrentUser() user: AuthenticatedUser, @Param('chapterId') chapterId: string) {
    return this.analyticsService.getWeakChapterDrill(user.userId, chapterId);
  }
}
