-- FEATURE: bulk admin API-key pool with rotation + low-key admin alerts,
-- and traceability on Question for AI-generated explanations so a shared
-- solution can be identified/improved later without guessing.
--
-- Nothing here breaks existing data: every new column is nullable or has
-- a default, and no existing column/table is renamed or dropped.

-- 1) AdminApiKey: usage/failure tracking so requests can rotate across a
--    whole pool of keys (added one-by-one or in bulk) instead of only ever
--    reading the single isPrimary key.
ALTER TABLE "admin_api_keys" ADD COLUMN IF NOT EXISTS "usageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "admin_api_keys" ADD COLUMN IF NOT EXISTS "failureCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "admin_api_keys" ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3);
ALTER TABLE "admin_api_keys" ADD COLUMN IF NOT EXISTS "lastFailureAt" TIMESTAMP(3);
ALTER TABLE "admin_api_keys" ADD COLUMN IF NOT EXISTS "lastErrorMessage" TEXT;
ALTER TABLE "admin_api_keys" ADD COLUMN IF NOT EXISTS "exhaustedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "admin_api_keys_provider_isActive_idx" ON "admin_api_keys"("provider", "isActive");

-- 2) AdminAlert: lets the backend proactively tell the admin "only 1 key
--    left" / "all keys exhausted" instead of AI features silently failing.
CREATE TABLE IF NOT EXISTS "admin_alerts" (
  "id"            TEXT NOT NULL,
  "type"          TEXT NOT NULL,
  "severity"      TEXT NOT NULL DEFAULT 'WARNING',
  "message"       TEXT NOT NULL,
  "messageHindi"  TEXT,
  "metadataJson"  JSONB,
  "isResolved"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"    TIMESTAMP(3),
  CONSTRAINT "admin_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "admin_alerts_isResolved_type_idx" ON "admin_alerts"("isResolved", "type");

-- 3) Question: which model/key-pool last (re)generated the shared AI
--    explanation, so an admin "improve this answer" action has something
--    to show, and so it's obvious this isn't the original PDF explanation.
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "explanationModel" TEXT;
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "explanationGeneratedAt" TIMESTAMP(3);
