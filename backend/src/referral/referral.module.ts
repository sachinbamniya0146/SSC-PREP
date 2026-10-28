import { Module } from '@nestjs/common';
import { ReferralService } from './referral.service';
import { ReferralConfigService } from './referral-config.service';
import { ReferralController } from './referral.controller';
import { ReferralPublicController } from './referral-public.controller';
import { ReferralAdminController } from './referral-admin.controller';
import { PayoutService } from './payout.service';

@Module({
  providers: [ReferralService, ReferralConfigService, PayoutService],
  controllers: [ReferralController, ReferralPublicController, ReferralAdminController],
  exports: [ReferralService, ReferralConfigService, PayoutService],
})
export class ReferralModule {}
