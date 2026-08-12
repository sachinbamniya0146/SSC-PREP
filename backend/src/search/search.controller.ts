import { Controller, Get, Post, Body, Query, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipThrottle } from '@nestjs/throttler';
import { Role } from '@prisma/client';

@ApiTags('search')
@Controller('search')
@SkipThrottle()
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Search questions with filters' })
  @ApiQuery({ name: 'q', required: false, description: 'Search query text' })
  @ApiQuery({ name: 'subjectId', required: false })
  @ApiQuery({ name: 'chapterId', required: false })
  @ApiQuery({ name: 'topicId', required: false })
  @ApiQuery({ name: 'examId', required: false })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'difficulty', required: false })
  @ApiQuery({ name: 'explanationSource', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'sort', required: false, isArray: true })
  async search(
    @Query('q') q?: string,
    @Query('subjectId') subjectId?: string,
    @Query('chapterId') chapterId?: string,
    @Query('topicId') topicId?: string,
    @Query('examId') examId?: string,
    @Query('year') year?: number,
    @Query('difficulty') difficulty?: string,
    @Query('explanationSource') explanationSource?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sort') sort?: string[],
  ) {
    return this.searchService.search({
      q,
      subjectId,
      chapterId,
      topicId,
      examId,
      year,
      difficulty,
      explanationSource,
      limit,
      offset,
      sort,
    });
  }

  @Post('reindex')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MODERATOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reindex all approved questions (admin)' })
  async reindexAll() {
    return this.searchService.indexAllApproved();
  }

  @Post('index/:questionId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MODERATOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Index a single question (admin)' })
  async indexOne(@Param('questionId') questionId: string) {
    return this.searchService.indexQuestion(questionId);
  }

  @Post('delete/:questionId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MODERATOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a question from index (admin)' })
  async deleteOne(@Param('questionId') questionId: string) {
    return this.searchService.deleteQuestion(questionId);
  }

  @Get('stats')
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Get Meilisearch index stats (public)' })
  async stats() {
    return this.searchService.getStats();
  }
}