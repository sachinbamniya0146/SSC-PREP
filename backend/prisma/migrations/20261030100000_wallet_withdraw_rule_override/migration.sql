-- Per-student override of "paying friends needed before a withdrawal" (admin decides for one person).
-- NULL = follow the programme rule (Admin -> Refer & Earn -> Rules). 0 = no friend needed. Additive only, re-run safe.

ALTER TABLE "referral_wallets" ADD COLUMN IF NOT EXISTS "withdrawMinFriends" INTEGER;
ALTER TABLE "referral_wallets" ADD COLUMN IF NOT EXISTS "withdrawRuleNote" TEXT;
ALTER TABLE "referral_wallets" ADD COLUMN IF NOT EXISTS "withdrawRuleSetAt" TIMESTAMP(3);
ALTER TABLE "referral_wallets" ADD COLUMN IF NOT EXISTS "withdrawRuleSetById" TEXT;
