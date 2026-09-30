import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { VocabService } from './vocab.service';
import { VocabRevisionService } from './vocab-revision.service';

@Controller('vocab')
@UseGuards(JwtAuthGuard)
export class VocabController {
  constructor(
    private readonly vocab: VocabService,
    private readonly revision: VocabRevisionService,
  ) {}

  private uid(req: any): string {
    return req.user?.userId ?? req.user?.id;
  }

  @Get('words')
  listWords(@Req() req: any) {
    return this.vocab.listWords(this.uid(req));
  }

  @Get('words/:slug')
  getWordDetail(@Req() req: any, @Param('slug') slug: string) {
    return this.vocab.getWordDetail(this.uid(req), slug);
  }

  @Get('words/:slug/quiz')
  getQuiz(@Req() req: any, @Param('slug') slug: string) {
    return this.vocab.getQuiz(this.uid(req), slug);
  }

  @Post('words/:slug/submit')
  submitQuiz(@Req() req: any, @Param('slug') slug: string, @Body() body: { answers: Record<string, string> }) {
    return this.vocab.submitQuiz(this.uid(req), slug, body?.answers ?? {});
  }

  @Get('daily-goal')
  getDailyGoal(@Req() req: any) {
    return this.vocab.getDailyGoal(this.uid(req));
  }

  @Put('daily-goal')
  setDailyGoal(@Req() req: any, @Body() body: { wordsPerDay: number }) {
    return this.vocab.setDailyGoal(this.uid(req), Number(body?.wordsPerDay));
  }

  @Get('today')
  todaysPlan(@Req() req: any) {
    return this.vocab.todaysPlan(this.uid(req));
  }

  @Get('subscription')
  getSubscriptionStatus(@Req() req: any) {
    return this.vocab.getSubscriptionStatus(this.uid(req));
  }

  // ---- Daily revision (Sep 29 2026) ----
  @Get('revision/status')
  revisionStatus(@Req() req: any) {
    return this.revision.status(this.uid(req));
  }

  @Post('revision/start')
  revisionStart(@Req() req: any) {
    return this.revision.start(this.uid(req));
  }

  @Post('revision/:sessionId/submit')
  revisionSubmit(@Req() req: any, @Param('sessionId') sessionId: string, @Body() body: { answers: Record<string, string> }) {
    return this.revision.submit(this.uid(req), sessionId, body?.answers ?? {});
  }

  // Prices + bilingual warnings for the pay-to-skip / pay-to-unlock dialogs.
  @Get('pricing')
  pricing() {
    return this.revision.pricing();
  }
}
