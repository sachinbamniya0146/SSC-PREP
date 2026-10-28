import { Module } from '@nestjs/common';
import { ReferralService } from './referral.service';
import { ReferralConfigService } from './referral-config.service';
import { ReferralController } from './referral.controller';
import { ReferralPublicController } from './referral-public.controller';
import { ReferralAdminController } from './referral-admin.controller';
import { WithdrawalAdminController } from './withdrawal-admin.controller';
import { WithdrawalService } from './withdrawal.service';
import { PayoutService } from './payout.service';

@Module({
  providers: [ReferralService, ReferralConfigService, PayoutService, WithdrawalService],
  controllers: [ReferralController, ReferralPublicController, ReferralAdminController, WithdrawalAdminController],
  exports: [ReferralService, ReferralConfigService, PayoutService, WithdrawalService],
})
export class ReferralModule {}
