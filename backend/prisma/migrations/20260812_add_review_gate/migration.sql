-- v1 §7.3-7.4 — AI confidence score + human review gate. Existing rows
-- grandfathered with APPROVED (they went through manual import + admin approval).
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "aiConfidenceScore" DOUBLE PRECISION;
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT NOT NULL DEFAULT 'APPROVED';