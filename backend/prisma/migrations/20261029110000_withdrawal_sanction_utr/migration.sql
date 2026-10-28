-- Withdrawals: sanction -> pay trail (who sanctioned, when, who paid, UTR / reference, gateway status).
-- Additive only and re-run safe: every statement is IF NOT EXISTS or guarded by "IS NULL".

ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "approvedAt"    TIMESTAMP(3);
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "approvedById"  TEXT;
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "paidAt"        TIMESTAMP(3);
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "paidById"      TEXT;
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "rejectedAt"    TIMESTAMP(3);
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "paymentRef"    TEXT;
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "gatewayStatus" TEXT;
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "lastCheckedAt" TIMESTAMP(3);

-- Back-fill old rows in the same migration so the new stats / timeline are right from day one.
UPDATE "withdrawal_requests"
   SET "approvedAt" = COALESCE("processedAt", "createdAt")
 WHERE "approvedAt" IS NULL AND "status"::text IN ('APPROVED', 'PROCESSING', 'PAID');

UPDATE "withdrawal_requests"
   SET "approvedById" = "processedByAdminId"
 WHERE "approvedById" IS NULL AND "approvedAt" IS NOT NULL AND "processedByAdminId" IS NOT NULL;

UPDATE "withdrawal_requests"
   SET "paidAt" = COALESCE("processedAt", "createdAt")
 WHERE "paidAt" IS NULL AND "status"::text = 'PAID';

UPDATE "withdrawal_requests"
   SET "paidById" = "processedByAdminId"
 WHERE "paidById" IS NULL AND "paidAt" IS NOT NULL AND "processedByAdminId" IS NOT NULL;

UPDATE "withdrawal_requests"
   SET "rejectedAt" = COALESCE("processedAt", "createdAt")
 WHERE "rejectedAt" IS NULL AND "status"::text IN ('REJECTED', 'FAILED');
