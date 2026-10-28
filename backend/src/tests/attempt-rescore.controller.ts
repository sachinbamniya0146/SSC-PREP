import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AttemptRescoreService } from './attempt-rescore.service';

// Admin only: re-score finished attempts after the answer key of a question was corrected.
@Controller('admin/attempt-rescore')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AttemptRescoreController {
  constructor(private readonly rescore: AttemptRescoreService) {}

  /** How many finished attempts used the old key. Changes nothing. */
  @Get('question/:questionId')
  preview(@Param('questionId') questionId: string) {
    return this.rescore.preview(questionId);
  }

  /** Re-score them (at most 200 per call; repeat until `remaining` is 0). Every change is audit-logged and the first score is kept. */
  @Post('question/:questionId')
  apply(@Param('questionId') questionId: string, @Req() req: { user?: { userId?: string; id?: string } }) {
    return this.rescore.apply(questionId, (req.user?.userId ?? req.user?.id) as string);
  }
}
