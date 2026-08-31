import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ErrorReportStatus } from '@prisma/client';
import { ReportErrorService } from './report-error.service';

/**
 * CRITICAL BUGFIX (bonus grep): this file previously contained a stray,
 * exact duplicate of ai-explanation.controller.ts — `@Controller('ai-explanation')`,
 * class `AIExplanationController`, and an `import { AIExplanationService }
 * from './ai-explanation.service'` pointing at a file that doesn't even
 * exist inside this folder (it lives in ../ai-explanation/).
 *
 * That mistake did two things, both severe:
 *   1. report-error.module.ts does `import { ReportErrorController } from
 *      './report-error.controller'` — but the file exported
 *      `AIExplanationController` instead, and imported a non-existent
 *      module path. This is a straight compile error: the backend could
 *      not build/boot at all with this file in place.
 *   2. Even setting the compile error aside, every method on
 *      ReportErrorService (report / list / resolve / unsuspendQuestion /
 *      getQuestionReports / categoryStats) had ZERO controller wired to
 *      it — "Report an error on this question" (used live by
 *      frontend/src/app/quiz/page.tsx via `POST /report-error`) and the
 *      entire admin error-report review/unsuspend workflow were
 *      completely unreachable.
 *
 * This restores the actual ReportErrorController, matching what
 * report-error.module.ts expects and what report-error.service.ts / the
 * frontend actually call.
 */
@Controller('report-error')
@UseGuards(JwtAuthGuard)
export class ReportErrorController {
  constructor(private readonly reportError: ReportErrorService) {}

  // Any logged-in user (student) can report a suspected error on a question.
  // Matches frontend/src/app/quiz/page.tsx: POST /report-error
  // { questionId, description, category }
  @Post()
  async report(
    @CurrentUser() user: { userId: string },
    @Body() body: { questionId: string; description: string; category?: string; issueType?: string },
  ) {
    if (!body.questionId) throw new BadRequestException('questionId is required');
    return this.reportError.report(user.userId, body.questionId, body.description || 'Reported error', body.category, body.issueType);
  }

  // Informational — the auto-suspend threshold, safe for any logged-in user.
  @Get('config')
  async config() {
    return this.reportError.getExports();
  }

  // ---- Admin / Moderator review workflow ----

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async list(@Query('status') status?: string, @Query('questionId') questionId?: string, @Query('issueType') issueType?: string) {
    return this.reportError.list(status, questionId, issueType);
  }

  @Get('category-stats')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async categoryStats() {
    return this.reportError.categoryStats();
  }

  @Get('question/:questionId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async getQuestionReports(@Param('questionId') questionId: string) {
    return this.reportError.getQuestionReports(questionId);
  }

  @Post(':id/resolve')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  async resolve(
    @CurrentUser() user: { userId: string },
    @Param('id') reportId: string,
    @Body() body: { status: ErrorReportStatus; adminNotes?: string },
  ) {
    if (!body.status) throw new BadRequestException('status is required');
    return this.reportError.resolve(reportId, body.status, user.userId, body.adminNotes);
  }

  @Post('question/:questionId/unsuspend')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async unsuspend(@CurrentUser() user: { userId: string }, @Param('questionId') questionId: string) {
    return this.reportError.unsuspendQuestion(questionId, user.userId);
  }
}
