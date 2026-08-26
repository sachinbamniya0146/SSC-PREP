import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ReportErrorService } from './report-error.service';

@ApiTags('report-error')
@Controller('report-error')
export class ReportErrorController {
  constructor(private readonly reports: ReportErrorService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Report a suspected error on a question (v5 §37.4)' })
  async report(
    @CurrentUser() user: { userId: string },
    @Body() body: { questionId: string; description?: string; category?: string; issueType?: string },
  ) {
    if (!body.questionId) {
      return { statusCode: 400, message: 'questionId is required' };
    }
    return this.reports.report(
      user.userId,
      body.questionId,
      body.description || 'Reported error',
      body.category,
      body.issueType,
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: list error reports (status/question filter)' })
  async list(
    @Query('status') status?: string,
    @Query('questionId') questionId?: string,
    @Query('issueType') issueType?: string,
  ) {
    return this.reports.list(status, questionId, issueType);
  }

  @Post(':id/resolve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: resolve a report (REVIEWING/CONFIRMED/REJECTED)' })
  async resolve(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role?: string },
    @Body() body: { status?: 'REVIEWING' | 'CONFIRMED' | 'REJECTED'; adminNotes?: string },
  ) {
    const status = body.status || 'REVIEWING';
    return this.reports.resolve(id, status, user.userId, body.adminNotes);
  }

  @Get('stats/categories')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: error-type classification stats (v5 §40)' })
  async categoryStats() {
    return this.reports.categoryStats();
  }

  @Get('threshold')
  @Public()
  @ApiOperation({ summary: 'Current auto-suspend threshold (public)' })
  async threshold() {
    return this.reports.getExports();
  }

  @Get('question/:questionId/reports')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all reports for a specific question' })
  async getQuestionReports(@Param('questionId') questionId: string) {
    return this.reports.getQuestionReports(questionId);
  }

  @Put('question/:questionId/unsuspend')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MODERATOR')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: manually unsuspend a question after fixing' })
  async unsuspendQuestion(@Param('questionId') questionId: string, @CurrentUser() user: { userId: string }) {
    return this.reports.unsuspendQuestion(questionId, user.userId);
  }
}