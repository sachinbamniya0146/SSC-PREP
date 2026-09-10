-- FEATURE (Sachin's request, Sep 2026 session): Refer & Earn — real cash
-- commission, wallet, payout method, and admin-approved withdrawal via
-- Cashfree Payouts. Previously referral.service.ts only tracked a free
-- 30-day-subscription milestone reward; there was NO wallet, NO commission
-- ledger, NO payout method storage, and NO withdrawal flow at all.
--
-- All new tables are strictly additive — nothing here touches existing
-- columns/tables, so this is safe to run on production with zero downtime.

-- ---- PayoutMethodType / WithdrawalStatus enums ----
DO $$ BEGIN
  CREATE TYPE "PayoutMethodType" AS ENUM ('UPI', 'BANK_ACCOUNT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "WithdrawalStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ---- referral_wallets ----
CREATE TABLE IF NOT EXISTS "referral_wallets" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "balanceInr" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalEarnedInr" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalWithdrawnInr" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "isSuspended" BOOLEAN NOT NULL DEFAULT false,
  "suspendedReason" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referral_wallets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "referral_wallets_userId_key" ON "referral_wallets"("userId");

ALTER TABLE "referral_wallets"
  ADD CONSTRAINT "referral_wallets_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- referral_earnings ----
CREATE TABLE IF NOT EXISTS "referral_earnings" (
  "id" TEXT NOT NULL,
  "referralId" TEXT NOT NULL,
  "referrerId" TEXT NOT NULL,
  "refereeId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "purchaseAmountInr" DOUBLE PRECISION NOT NULL,
  "commissionPct" DOUBLE PRECISION NOT NULL,
  "commissionInr" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referral_earnings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "referral_earnings_paymentId_key" ON "referral_earnings"("paymentId");
CREATE INDEX IF NOT EXISTS "referral_earnings_referrerId_idx" ON "referral_earnings"("referrerId");

ALTER TABLE "referral_earnings"
  ADD CONSTRAINT "referral_earnings_referralId_fkey"
  FOREIGN KEY ("referralId") REFERENCES "referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_earnings"
  ADD CONSTRAINT "referral_earnings_referrerId_fkey"
  FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_earnings"
  ADD CONSTRAINT "referral_earnings_refereeId_fkey"
  FOREIGN KEY ("refereeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_earnings"
  ADD CONSTRAINT "referral_earnings_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- payout_methods ----
CREATE TABLE IF NOT EXISTS "payout_methods" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "PayoutMethodType" NOT NULL,
  "upiId" TEXT,
  "bankAccountNo" TEXT,
  "bankIfsc" TEXT,
  "bankAccountName" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payout_methods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payout_methods_userId_key" ON "payout_methods"("userId");

ALTER TABLE "payout_methods"
  ADD CONSTRAINT "payout_methods_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- withdrawal_requests ----
CREATE TABLE IF NOT EXISTS "withdrawal_requests" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amountInr" DOUBLE PRECISION NOT NULL,
  "status" "WithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
  "payoutMethodType" "PayoutMethodType" NOT NULL,
  "upiId" TEXT,
  "bankAccountNo" TEXT,
  "bankIfsc" TEXT,
  "bankAccountName" TEXT,
  "cashfreeTransferId" TEXT,
  "adminNote" TEXT,
  "processedByAdminId" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "withdrawal_requests_userId_idx" ON "withdrawal_requests"("userId");
CREATE INDEX IF NOT EXISTS "withdrawal_requests_status_idx" ON "withdrawal_requests"("status");

ALTER TABLE "withdrawal_requests"
  ADD CONSTRAINT "withdrawal_requests_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
