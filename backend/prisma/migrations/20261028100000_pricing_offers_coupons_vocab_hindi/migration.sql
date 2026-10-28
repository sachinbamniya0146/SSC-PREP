-- Pricing / offers / coupon rules + Hindi explanation for vocabulary questions.
-- Purely additive: every column is nullable or has a default, so existing plans, coupons,
-- payments and vocabulary questions behave exactly as before.

-- Plans: MRP (display only), time-boxed % offer, badge, ordering
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "mrpInr" DOUBLE PRECISION;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "offerPct" DOUBLE PRECISION;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "offerLabel" TEXT;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "offerStartsAt" TIMESTAMP(3);
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "offerEndsAt" TIMESTAMP(3);
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "badge" TEXT;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Coupons: start date, minimum order, % cap, per-student limit, plan restriction, offer stacking
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "startsAt" TIMESTAMP(3);
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "minOrderInr" DOUBLE PRECISION;
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "maxDiscountInr" DOUBLE PRECISION;
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "perUserLimit" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "planIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "stackWithOffer" BOOLEAN NOT NULL DEFAULT true;

-- Vocabulary: Hindi explanation shown next to the English one
ALTER TABLE "vocab_questions" ADD COLUMN IF NOT EXISTS "explanationHindi" TEXT;
