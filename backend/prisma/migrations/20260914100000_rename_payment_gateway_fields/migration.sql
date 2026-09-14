-- RENAMED (Sep 2026 — "Cashfree hai to razorpayOrderId kyun likha hai" /
-- Sachin's question): payments.razorpayOrderId / razorpayPaymentId have
-- ALWAYS stored Cashfree's order_id / cf_payment_id — see
-- monetization.service.ts's "GATEWAY MIGRATION (PayU → Cashfree)" comment
-- and every call site (createOrder(), the webhook handler, verify()) — the
-- column names are pure leftover naming from before that migration, never
-- actual Razorpay data. Renaming, not adding new columns, so existing data
-- (every payment ever recorded) is preserved exactly, unique constraints
-- carry over automatically with a RENAME COLUMN (Postgres keeps the
-- underlying index/constraint intact, it just now backs a differently-named
-- column — no re-index, no downtime).
ALTER TABLE "payments" RENAME COLUMN "razorpayOrderId" TO "gatewayOrderId";
ALTER TABLE "payments" RENAME COLUMN "razorpayPaymentId" TO "gatewayPaymentId";
