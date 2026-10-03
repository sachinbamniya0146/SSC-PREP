-- Daily revision + 8:30 AM reminder support for the study planner
ALTER TABLE "study_plan_chapters" ADD COLUMN "lastRevisedAt" TIMESTAMP(3);
ALTER TABLE "study_plan_chapters" ADD COLUMN "revisionCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "study_plan_tests" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'TEST';
ALTER TABLE "study_plan_tests" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
CREATE INDEX "study_plan_tests_kind_scheduledFor_idx" ON "study_plan_tests"("kind", "scheduledFor");

-- error-report: remember that the reporter was thanked after the question was fixed
ALTER TABLE "question_error_reports" ADD COLUMN "fixedNotifiedAt" TIMESTAMP(3);
