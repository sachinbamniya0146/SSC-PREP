-- P0: strict sectional timers (SSC CGL 2026 pattern). All changes are additive and nullable/defaulted,
-- so existing rows and running attempts keep their old single-clock behaviour.
ALTER TABLE "exam_patterns" ADD COLUMN IF NOT EXISTS "lockPreviousSections" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "exam_patterns" ADD COLUMN IF NOT EXISTS "scribeExtraMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "exam_patterns" ADD COLUMN IF NOT EXISTS "sourceNote" TEXT;

ALTER TABLE "test_templates" ADD COLUMN IF NOT EXISTS "examPatternId" TEXT;
CREATE INDEX IF NOT EXISTS "test_templates_examPatternId_idx" ON "test_templates"("examPatternId");
DO $$ BEGIN
  ALTER TABLE "test_templates"
    ADD CONSTRAINT "test_templates_examPatternId_fkey"
    FOREIGN KEY ("examPatternId") REFERENCES "exam_patterns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "test_attempts" ADD COLUMN IF NOT EXISTS "sectionPlan" JSONB;
ALTER TABLE "test_attempts" ADD COLUMN IF NOT EXISTS "lastSyncAt" TIMESTAMP(3);
