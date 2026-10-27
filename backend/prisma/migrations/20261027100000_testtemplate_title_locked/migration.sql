-- Admin can rename a date-wise PYQ mock; titleLocked stops later rebuilds from overwriting the new name.
-- Additive with a default: no existing row, mock or attempt changes.
ALTER TABLE "test_templates" ADD COLUMN IF NOT EXISTS "titleLocked" BOOLEAN NOT NULL DEFAULT false;
