ALTER TABLE "question_upload_batches" ADD COLUMN IF NOT EXISTS "skippedCount" INTEGER NOT NULL DEFAULT 0;
