-- Oct 15 2026: central AI job engine (ai_jobs, ai_job_items, ai_changes).
-- Safe to re-run: every statement is guarded.

CREATE TABLE IF NOT EXISTS "ai_jobs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT,
    "scopeJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "passes" INTEGER NOT NULL DEFAULT 5,
    "minAgree" INTEGER NOT NULL DEFAULT 3,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "doneCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "callsMade" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_jobs_status_createdAt_idx" ON "ai_jobs"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "ai_job_items" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionNo" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "passesDone" INTEGER NOT NULL DEFAULT 0,
    "agreeCount" INTEGER NOT NULL DEFAULT 0,
    "proposalJson" JSONB,
    "passesJson" JSONB,
    "note" TEXT,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_job_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_job_items_jobId_questionId_key" ON "ai_job_items"("jobId", "questionId");
CREATE INDEX IF NOT EXISTS "ai_job_items_jobId_status_idx" ON "ai_job_items"("jobId", "status");
CREATE INDEX IF NOT EXISTS "ai_job_items_questionId_idx" ON "ai_job_items"("questionId");

DO $$ BEGIN
  ALTER TABLE "ai_job_items" ADD CONSTRAINT "ai_job_items_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "ai_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ai_changes" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "itemId" TEXT,
    "questionId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" JSONB NOT NULL,
    "newValue" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'AI_JOB',
    "model" TEXT,
    "appliedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoneBy" TEXT,
    CONSTRAINT "ai_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_changes_jobId_undoneAt_idx" ON "ai_changes"("jobId", "undoneAt");
CREATE INDEX IF NOT EXISTS "ai_changes_questionId_createdAt_idx" ON "ai_changes"("questionId", "createdAt");
