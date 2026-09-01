-- FEATURE: bulk admin API-key pool with rotation + low-key admin alerts,
-- and traceability on Question for AI-generated explanations so a shared
-- solution can be identified/improved later without guessing.
--
-- FIX (2026-08-31): the original version of this migration only ran
-- ALTER TABLE "admin_api_keys" ADD COLUMN ... — but no earlier migration
-- ever CREATEd the "admin_api_keys" table itself (grep across the entire
-- prisma/migrations/ history confirms it). On any environment where that
-- table doesn't already exist (a fresh DB, or production, which had never
-- had this table), Postgres throws "relation admin_api_keys does not
-- exist", `prisma migrate deploy` exits non-zero, and the backend Docker
-- container's start command (`npx prisma migrate deploy && node
-- dist/main.js`) never reaches `node dist/main.js` — so the whole backend
-- never boots => nginx can't reach it => HTTP 502 on every request
-- (login included, since that's usually the first API call a user makes).
--
-- This version CREATEs "admin_api_keys" first (IF NOT EXISTS, so it's
-- also safe to re-run on a dev DB where the table might already exist
-- from `prisma db push`), matching the full AdminApiKey model in
-- schema.prisma, THEN applies the rotation/health-tracking columns.
-- Nothing here breaks existing data: every new column is nullable or has
-- a default, and no existing column/table is renamed or dropped.

-- 0) Base table — was missing from migration history entirely.
CREATE TABLE IF NOT EXISTS "admin_api_keys" (
  "id"            TEXT NOT NULL,
  "provider"      TEXT NOT NULL,
  "keyName"       TEXT NOT NULL,
  "apiKey"        TEXT NOT NULL,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "isPrimary"     BOOLEAN NOT NULL DEFAULT false,
  "freeModelOnly" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "createdBy"     TEXT,
  CONSTRAINT "admin_api_keys_pkey" PRIMARY KEY ("id")
);

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
