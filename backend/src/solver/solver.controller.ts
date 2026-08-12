import { Controller, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SolverService } from './solver.service';

@ApiTags('solver')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/solver')
export class SolverController {
  constructor(private readonly solverService: SolverService) {}

  // v5 §37.2 — deterministic re-derivation of one question (never LLM-guessed)
  @Post('recompute/:questionId')
  @ApiOperation({ summary: 'Re-derive a question answer deterministically (VERIFIED_COMPUTED)' })
  recompute(@Param('questionId') questionId: string, @CurrentUser() user: { userId: string }) {
    return this.solverService.recompute(questionId, user.userId);
  }

  // v5 §37.2 — batch re-derivation (by ids or exam/chapter filter), cap 500
  @Post('recompute-batch')
  @ApiOperation({ summary: 'Batch re-derive: questionIds[] or examId/chapterId filter' })
  recomputeBatch(
    @CurrentUser() user: { userId: string },
    @Body() body: { questionIds?: string[]; examId?: string; chapterId?: string; limit?: number },
  ) {
    return this.solverService.recomputeBatch(user.userId, body);
  }
}