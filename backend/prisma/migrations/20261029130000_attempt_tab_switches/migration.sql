-- How often the student left the exam tab for more than 1.5 s (counted by the exam page, only a notice for the student, NO penalty).
-- Additive only and re-run safe: one column with a constant default (older rows read 0 = "not recorded / none").

ALTER TABLE "test_attempts" ADD COLUMN IF NOT EXISTS "tabSwitches" INTEGER NOT NULL DEFAULT 0;
