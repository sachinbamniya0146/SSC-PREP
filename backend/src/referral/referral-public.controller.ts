import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ReferralService } from './referral.service';

/** Signup page helper: shows who invited the visitor and what they get. Reveals a first name only. */
@Controller('referral')
export class ReferralPublicController {
  constructor(private readonly referral: ReferralService) {}

  @Public()
  @Get('preview/:code')
  preview(@Param('code') code: string) {
    return this.referral.previewCode(String(code || '').slice(0, 40));
  }
}
