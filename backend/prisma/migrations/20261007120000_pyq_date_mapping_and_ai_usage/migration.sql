-- Oct 7 2026: PYQ date mapping worker + AI key usage log.
-- Safe to re-run: every statement is guarded.

ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "examTier" TEXT;

CREATE TABLE IF NOT EXISTS "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "keyId" TEXT,
    "keyName" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_usage_logs_keyId_createdAt_idx" ON "ai_usage_logs"("keyId", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_usage_logs_feature_createdAt_idx" ON "ai_usage_logs"("feature", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_usage_logs_createdAt_idx" ON "ai_usage_logs"("createdAt");

CREATE TABLE IF NOT EXISTS "pyq_date_maps" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "examTier" TEXT,
    "proposedDate" TEXT,
    "proposedYear" INTEGER,
    "agreeCount" INTEGER NOT NULL DEFAULT 0,
    "passesDone" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION,
    "note" TEXT,
    "passesJson" JSONB,
    "sourcesJson" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "verifyExisting" BOOLEAN NOT NULL DEFAULT false,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pyq_date_maps_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "pyq_date_maps_questionId_key" ON "pyq_date_maps"("questionId");
CREATE INDEX IF NOT EXISTS "pyq_date_maps_status_nextRunAt_idx" ON "pyq_date_maps"("status", "nextRunAt");
CREATE INDEX IF NOT EXISTS "pyq_date_maps_updatedAt_idx" ON "pyq_date_maps"("updatedAt");

DO $$ BEGIN
  ALTER TABLE "pyq_date_maps" ADD CONSTRAINT "pyq_date_maps_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "pyq_date_configs" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "autoRun" BOOLEAN NOT NULL DEFAULT true,
    "minAgeMinutes" INTEGER NOT NULL DEFAULT 5,
    "batchSize" INTEGER NOT NULL DEFAULT 2,
    "passes" INTEGER NOT NULL DEFAULT 5,
    "lastTickAt" TIMESTAMP(3),
    "lastMessage" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pyq_date_configs_pkey" PRIMARY KEY ("id")
);
