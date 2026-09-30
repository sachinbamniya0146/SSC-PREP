-- Vocab v2 (daily revision, escalating skip fee, unlock-all) + Study Plan v2
-- (chapter self-marking, scheduled 9 AM test) + Rs 19 plan seed.
-- Additive only — safe to re-run (IF NOT EXISTS / duplicate_object guards).

ALTER TABLE "vocab_word_progress" ADD COLUMN IF NOT EXISTS "remasterRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "vocab_word_progress" ADD COLUMN IF NOT EXISTS "lastRevisedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "vocab_user_states" (
    "id"               TEXT NOT NULL,
    "userId"           TEXT NOT NULL,
    "allUnlockedAt"    TIMESTAMP(3),
    "skipStreak"       INTEGER NOT NULL DEFAULT 0,
    "lastSkipDateKey"  TEXT,
    "totalSkipPaidInr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vocab_user_states_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "vocab_user_states_userId_key" ON "vocab_user_states"("userId");

CREATE TABLE IF NOT EXISTS "vocab_revision_sessions" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "dateKey"        TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "wordIds"        JSONB NOT NULL,
    "questionIds"    JSONB NOT NULL,
    "totalQuestions" INTEGER NOT NULL DEFAULT 0,
    "correctCount"   INTEGER NOT NULL DEFAULT 0,
    "scorePct"       INTEGER NOT NULL DEFAULT 0,
    "wrongWordIds"   JSONB,
    "timeLimitSec"   INTEGER NOT NULL DEFAULT 0,
    "skipFeeInr"     DOUBLE PRECISION,
    "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"      TIMESTAMP(3) NOT NULL,
    "completedAt"    TIMESTAMP(3),
    CONSTRAINT "vocab_revision_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "vocab_revision_sessions_userId_dateKey_idx" ON "vocab_revision_sessions"("userId", "dateKey");
CREATE INDEX IF NOT EXISTS "vocab_revision_sessions_userId_status_idx" ON "vocab_revision_sessions"("userId", "status");

CREATE TABLE IF NOT EXISTS "study_plan_chapters" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "chapterId"    TEXT NOT NULL,
    "status"       TEXT NOT NULL DEFAULT 'PENDING',
    "selfMarkedAt" TIMESTAMP(3),
    "lastScorePct" INTEGER,
    "lastTestedAt" TIMESTAMP(3),
    "completedAt"  TIMESTAMP(3),
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "study_plan_chapters_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "study_plan_chapters_userId_chapterId_key" ON "study_plan_chapters"("userId", "chapterId");
CREATE INDEX IF NOT EXISTS "study_plan_chapters_userId_status_idx" ON "study_plan_chapters"("userId", "status");

CREATE TABLE IF NOT EXISTS "study_plan_tests" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "examId"       TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "chapterIds"   JSONB NOT NULL,
    "status"       TEXT NOT NULL DEFAULT 'SCHEDULED',
    "attemptId"    TEXT,
    "scorePct"     INTEGER,
    "resultJson"   JSONB,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt"    TIMESTAMP(3),
    "submittedAt"  TIMESTAMP(3),
    CONSTRAINT "study_plan_tests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "study_plan_tests_attemptId_key" ON "study_plan_tests"("attemptId");
CREATE INDEX IF NOT EXISTS "study_plan_tests_userId_status_idx" ON "study_plan_tests"("userId", "status");
CREATE INDEX IF NOT EXISTS "study_plan_tests_userId_scheduledFor_idx" ON "study_plan_tests"("userId", "scheduledFor");

DO $$ BEGIN
    ALTER TABLE "vocab_user_states" ADD CONSTRAINT "vocab_user_states_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
    ALTER TABLE "vocab_revision_sessions" ADD CONSTRAINT "vocab_revision_sessions_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
    ALTER TABLE "study_plan_chapters" ADD CONSTRAINT "study_plan_chapters_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
    ALTER TABLE "study_plan_tests" ADD CONSTRAINT "study_plan_tests_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Rs 19 "Plus" plan (1 month, unlimited practice). Seeded only if no plan at
-- exactly Rs 19 exists yet, so re-running / an admin-edited plan is untouched.
INSERT INTO "plans" ("id", "name", "durationMonths", "priceInr", "isActive")
SELECT 'plan-plus-19', 'Plus — Unlimited Practice (1 Month)', 1, 19, true
WHERE NOT EXISTS (SELECT 1 FROM "plans" WHERE "priceInr" = 19);

-- PYQ mock categorisation: exam date on questions + year/shift/date on mock templates.
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "examDate" TEXT;
ALTER TABLE "test_templates" ADD COLUMN IF NOT EXISTS "year" INTEGER;
ALTER TABLE "test_templates" ADD COLUMN IF NOT EXISTS "shift" TEXT;
ALTER TABLE "test_templates" ADD COLUMN IF NOT EXISTS "examDate" TEXT;
