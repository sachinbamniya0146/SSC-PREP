import { Module } from '@nestjs/common';
import { ReferralService } from './referral.service';
import { ReferralController } from './referral.controller';
import { PayoutService } from './payout.service';

@Module({
  providers: [ReferralService, PayoutService],
  controllers: [ReferralController],
  exports: [ReferralService, PayoutService],
})
export class ReferralModule {}
