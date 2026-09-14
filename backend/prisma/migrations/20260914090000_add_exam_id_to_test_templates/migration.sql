-- NEW (Sep 2026 — "mock tests exam ke hisaab se scope hone chahiye" audit):
-- test_templates never had any column tying a mock/test to a specific exam
-- at all. /mocks (mocks.service.ts#listAvailableMocks) always returned
-- every mock across every exam mixed together with no way to filter, and
-- there was no way for it to filter even if it wanted to. This adds the
-- missing column + FK + index, matching the new `examId`/`exam` fields on
-- the TestTemplate model in schema.prisma.
--
-- onDelete: SET NULL — deleting an Exam row should not cascade-delete
-- historical mock templates (and the TestAttempt rows hanging off them);
-- it should just orphan the exam link.
ALTER TABLE "test_templates" ADD COLUMN IF NOT EXISTS "examId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'test_templates_examId_fkey'
  ) THEN
    ALTER TABLE "test_templates"
      ADD CONSTRAINT "test_templates_examId_fkey"
      FOREIGN KEY ("examId") REFERENCES "exams"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "test_templates_examId_idx" ON "test_templates"("examId");

-- Best-effort backfill for EXISTING rows created before this migration.
-- Every exam-specific template creator in the app builds its title with a
-- predictable "<Exam Name> ..." or "... — <Exam Name> ..." prefix/pattern
-- (see bank-upload.service.ts#upsertPyqMockForPaper, tests.service.ts's
-- year-wise custom-test builder, daily-test.service.ts#templateFor) — so a
-- simple LIKE match against exams.name recovers the exam for the vast
-- majority of already-existing rows without guessing. Anything that
-- doesn't match (hand-created generic templates, "Quick Practice", etc.)
-- is deliberately left NULL rather than force-guessed — NULL means
-- "shows under every exam" (see mocks.service.ts), which is the safe
-- default for a template nobody can confidently attribute to one exam.
UPDATE "test_templates" t
SET "examId" = e.id
FROM "exams" e
WHERE t."examId" IS NULL
  AND (
    t.title ILIKE e.name || ' %'
    OR t.title ILIKE '%— ' || e.name || ' %'
    OR t.title ILIKE '%— ' || e.name
    OR t.title ILIKE e.name || ' —%'
  );
