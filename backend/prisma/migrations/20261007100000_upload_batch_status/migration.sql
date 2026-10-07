-- Upload history status that survives reloads (RUNNING / DONE / FAILED) + duplicate-review count
ALTER TABLE "question_upload_batches" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'DONE';
ALTER TABLE "question_upload_batches" ADD COLUMN IF NOT EXISTS "queuedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "question_upload_batches" ADD COLUMN IF NOT EXISTS "finishedAt" TIMESTAMP(3);
ALTER TABLE "question_upload_batches" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;
