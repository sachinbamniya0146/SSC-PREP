-- Refer & Earn v2: commission hold window + reversal, admin-editable settings, fraud flag.
-- Re-run safe: every statement is IF NOT EXISTS / guarded.

CREATE TABLE IF NOT EXISTS "app_settings" (
  "key"       TEXT NOT NULL,
  "valueJson" JSONB NOT NULL,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

DO $$ BEGIN
  CREATE TYPE "EarningStatus" AS ENUM ('PENDING', 'AVAILABLE', 'REVERSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Existing rows were already credited straight to the balance, so they stay AVAILABLE.
ALTER TABLE "referral_earnings" ADD COLUMN IF NOT EXISTS "status" "EarningStatus" NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE "referral_earnings" ADD COLUMN IF NOT EXISTS "availableAt" TIMESTAMP(3);
ALTER TABLE "referral_earnings" ADD COLUMN IF NOT EXISTS "holdReason" TEXT;
ALTER TABLE "referral_earnings" ADD COLUMN IF NOT EXISTS "reversedAt" TIMESTAMP(3);
ALTER TABLE "referral_earnings" ADD COLUMN IF NOT EXISTS "reversalNote" TEXT;
CREATE INDEX IF NOT EXISTS "referral_earnings_status_availableAt_idx" ON "referral_earnings"("status", "availableAt");

ALTER TABLE "referral_wallets" ADD COLUMN IF NOT EXISTS "pendingInr" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "flagReason" TEXT;
