-- Duplicate-question review queue (admin decides: keep old / keep new / keep both)
CREATE TABLE IF NOT EXISTS "question_duplicate_reviews" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "matchType" TEXT NOT NULL,
  "differences" JSONB,
  "existingQuestionId" TEXT,
  "candidateQuestionId" TEXT,
  "candidateJson" JSONB,
  "searchHash" TEXT,
  "uploadBatchId" TEXT,
  "sourceRow" INTEGER,
  "createdById" TEXT,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "question_duplicate_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "question_duplicate_reviews_status_matchType_createdAt_idx" ON "question_duplicate_reviews"("status", "matchType", "createdAt");
CREATE INDEX IF NOT EXISTS "question_duplicate_reviews_existingQuestionId_idx" ON "question_duplicate_reviews"("existingQuestionId");
CREATE INDEX IF NOT EXISTS "question_duplicate_reviews_candidateQuestionId_idx" ON "question_duplicate_reviews"("candidateQuestionId");
CREATE INDEX IF NOT EXISTS "question_duplicate_reviews_uploadBatchId_idx" ON "question_duplicate_reviews"("uploadBatchId");
