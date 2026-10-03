/* eslint-disable @typescript-eslint/no-explicit-any */
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WeakTopicService } from './weak-topic.service';

// Student: my weak chapters / topics / sub-topics (+ the ones I already strengthened)
@Controller('bank/weak-topics')
@UseGuards(JwtAuthGuard)
export class WeakTopicController {
  constructor(private readonly weak: WeakTopicService) {}

  @Get()
  list(@Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.weak.list(userId);
  }
}
