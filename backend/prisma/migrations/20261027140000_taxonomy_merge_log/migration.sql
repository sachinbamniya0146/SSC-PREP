-- Audit/undo log for topic & sub-topic merges (additive, safe to skip rollback).
CREATE TABLE IF NOT EXISTS "taxonomy_merge_logs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "chapterId" TEXT,
    "survivorId" TEXT NOT NULL,
    "loserId" TEXT NOT NULL,
    "survivorName" TEXT NOT NULL,
    "loserName" TEXT NOT NULL,
    "questionsMoved" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "taxonomy_merge_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "taxonomy_merge_logs_createdAt_idx" ON "taxonomy_merge_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "taxonomy_merge_logs_survivorId_idx" ON "taxonomy_merge_logs"("survivorId");
