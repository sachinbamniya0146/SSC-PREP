import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReviewService, ReviewGrade } from './review.service';

@ApiTags('review')
@Controller('review')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get('due')
  @ApiOperation({ summary: 'List due spaced-repetition cards' })
  async due(@CurrentUser() user: { userId: string }, @Query('limit') limit?: string) {
    const due = await this.review.due(user.userId, limit ? parseInt(limit, 10) : 20);
    const stats = await this.review.stats(user.userId);
    return { due, stats };
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'List upcoming (not-yet-due) review cards' })
  async upcoming(@CurrentUser() user: { userId: string }) {
    return this.review.upcoming(user.userId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Review queue statistics' })
  async stats(@CurrentUser() user: { userId: string }) {
    return this.review.stats(user.userId);
  }

  @Post('schedule')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Queue a question for review (after a wrong/skipped answer)' })
  async schedule(
    @CurrentUser() user: { userId: string },
    @Body() body: { questionId: string; reason?: string },
  ) {
    if (!body.questionId) {
      return { statusCode: 400, message: 'questionId is required' };
    }
    return this.review.schedule(user.userId, body.questionId, body.reason || 'manual');
  }

  @Post('grade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Grade a review attempt (again/hard/good/easy)' })
  async grade(
    @CurrentUser() user: { userId: string },
    @Body() body: { cardId: string; grade: ReviewGrade },
  ) {
    if (!body.cardId || !body.grade) {
      return { statusCode: 400, message: 'cardId and grade are required' };
    }
    return this.review.grade(user.userId, body.cardId, body.grade);
  }
}