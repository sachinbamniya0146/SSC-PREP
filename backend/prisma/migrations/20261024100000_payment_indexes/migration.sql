-- Payment history lookups and the pending-payment reconciler scan the payments
-- table by (userId, createdAt) and (status, createdAt); neither had an index.
CREATE INDEX IF NOT EXISTS "payments_userId_createdAt_idx" ON "payments"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "payments_status_createdAt_idx" ON "payments"("status", "createdAt");
