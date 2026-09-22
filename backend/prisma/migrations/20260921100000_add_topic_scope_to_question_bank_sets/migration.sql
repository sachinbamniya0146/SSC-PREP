-- Topic / sub-topic wise practice: a QuestionBankSet can now be scoped to one
-- Topic (and optionally one SubTopic) under its chapter.
--
-- "question_bank_sets" is created in 20260912130000_add_question_bank_sets_and_user_progress,
-- which sorts BEFORE this folder, so the ALTER below always has a table to
-- alter (see the recurring "ALTER without prior CREATE" migration bug in the
-- audit log). IF NOT EXISTS keeps it safe to re-run.
--
-- Plain nullable TEXT columns, no foreign keys on purpose: deleting/merging a
-- topic must never cascade into (or be blocked by) a student's practice
-- history. NULL = chapter-wide / subject-wide set, i.e. every existing row
-- keeps behaving exactly as before.

ALTER TABLE "question_bank_sets" ADD COLUMN IF NOT EXISTS "topicId" TEXT;
ALTER TABLE "question_bank_sets" ADD COLUMN IF NOT EXISTS "subTopicId" TEXT;

CREATE INDEX IF NOT EXISTS "question_bank_sets_userId_topicId_idx"
  ON "question_bank_sets" ("userId", "topicId");
