-- BUGFIX (schema/migration drift — same class of bug as the missing
-- "admin_api_keys" table fixed in 20260830_add_api_key_rotation_and_alerts):
-- schema.prisma has QuestionBankSet ("question_bank_sets") and UserProgress
-- ("user_progress") models, and backend/src/bank/question-bank-practice.service.ts,
-- bank.service.ts, bookmarks.service.ts, study-plan.service.ts,
-- ai-explanation.service.ts, review.service.ts, and admin.service.ts/
-- admin.controller.ts all already call `this.prisma.questionBankSet` /
-- `this.prisma.userProgress` — but NO migration in this folder ever created
-- either table. `npx prisma generate` succeeds fine (schema-only, no DB
-- needed), so this slipped past that check completely; the first time any
-- of the above features actually runs against a real database it throws
-- "relation \"question_bank_sets\" does not exist" / "relation
-- \"user_progress\" does not exist" and 500s.
--
-- IF NOT EXISTS everywhere — safe to run even if a dev DB already has these
-- from a stray `prisma db push`.

CREATE TABLE IF NOT EXISTS "question_bank_sets" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "subjectId"    TEXT,
  "chapterId"    TEXT,
  "examId"       TEXT,
  "setNumber"    INTEGER NOT NULL,
  "questions"    JSONB NOT NULL,
  "currentIndex" INTEGER NOT NULL DEFAULT 0,
  "answers"      JSONB,
  "startedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"  TIMESTAMP(3),
  "score"        DOUBLE PRECISION,
  "isCompleted"  BOOLEAN NOT NULL DEFAULT false,
  "mode"         TEXT NOT NULL DEFAULT 'practice',
  CONSTRAINT "question_bank_sets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "question_bank_sets_userId_subjectId_chapterId_examId_setNumber_key"
  ON "question_bank_sets"("userId", "subjectId", "chapterId", "examId", "setNumber");
CREATE INDEX IF NOT EXISTS "question_bank_sets_userId_subjectId_chapterId_idx"
  ON "question_bank_sets"("userId", "subjectId", "chapterId");
CREATE INDEX IF NOT EXISTS "question_bank_sets_userId_isCompleted_idx"
  ON "question_bank_sets"("userId", "isCompleted");

DO $$ BEGIN
  ALTER TABLE "question_bank_sets" ADD CONSTRAINT "question_bank_sets_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "question_bank_sets" ADD CONSTRAINT "question_bank_sets_subjectId_fkey"
    FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "question_bank_sets" ADD CONSTRAINT "question_bank_sets_chapterId_fkey"
    FOREIGN KEY ("chapterId") REFERENCES "chapters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "question_bank_sets" ADD CONSTRAINT "question_bank_sets_examId_fkey"
    FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "user_progress" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "subjectId"       TEXT NOT NULL,
  "chapterId"       TEXT,
  "examId"          TEXT,
  "setsCompleted"   INTEGER NOT NULL DEFAULT 0,
  "totalQuestions"  INTEGER NOT NULL DEFAULT 0,
  "correctAnswers"  INTEGER NOT NULL DEFAULT 0,
  "wrongAnswers"    INTEGER NOT NULL DEFAULT 0,
  "skippedAnswers"  INTEGER NOT NULL DEFAULT 0,
  "lastPracticedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_progress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_progress_userId_subjectId_chapterId_examId_key"
  ON "user_progress"("userId", "subjectId", "chapterId", "examId");
CREATE INDEX IF NOT EXISTS "user_progress_userId_subjectId_idx"
  ON "user_progress"("userId", "subjectId");

DO $$ BEGIN
  ALTER TABLE "user_progress" ADD CONSTRAINT "user_progress_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "user_progress" ADD CONSTRAINT "user_progress_subjectId_fkey"
    FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "user_progress" ADD CONSTRAINT "user_progress_chapterId_fkey"
    FOREIGN KEY ("chapterId") REFERENCES "chapters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "user_progress" ADD CONSTRAINT "user_progress_examId_fkey"
    FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
