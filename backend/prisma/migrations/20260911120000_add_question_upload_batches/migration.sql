-- Sachin, Sep 2026 session — Phase 3 (admin upload history + delete-by-
-- batch + persisted error reports).
--
-- Before this, POST /bank/admin/upload/{excel,csv,text,word} returned a
-- rich UploadResult but nothing was ever saved server-side — the moment
-- the admin panel was closed or refreshed, "which Excel did I upload,
-- when, how many failed, and why" was gone for good, and there was no way
-- to bulk-delete the questions from one bad upload.
--
-- IF NOT EXISTS everywhere — safe to run even if partially applied by hand.

CREATE TABLE IF NOT EXISTS "question_upload_batches" (
  "id"           TEXT PRIMARY KEY,
  "adminId"      TEXT NOT NULL,
  "sourceType"   TEXT NOT NULL,
  "filename"     TEXT,
  "totalRows"    INTEGER NOT NULL DEFAULT 0,
  "createdCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount"  INTEGER NOT NULL DEFAULT 0,
  "errorsJson"   JSONB,
  "warningsJson" JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "question_upload_batches_adminId_idx" ON "question_upload_batches"("adminId");
CREATE INDEX IF NOT EXISTS "question_upload_batches_createdAt_idx" ON "question_upload_batches"("createdAt");

ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "uploadBatchId" TEXT;

DO $$ BEGIN
  ALTER TABLE "questions"
    ADD CONSTRAINT "questions_uploadBatchId_fkey"
    FOREIGN KEY ("uploadBatchId") REFERENCES "question_upload_batches"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL; -- constraint already exists, safe to skip
END $$;
