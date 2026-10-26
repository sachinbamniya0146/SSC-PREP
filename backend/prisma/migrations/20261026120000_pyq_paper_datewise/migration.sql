-- Date-wise + tier-wise PYQ mocks. Additive and nullable only: no existing row, mock or attempt changes.
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "tierPaper" TEXT;
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "paperQuestionNo" INTEGER;
CREATE INDEX IF NOT EXISTS "questions_examId_examTier_examDate_shift_idx" ON "questions"("examId", "examTier", "examDate", "shift");

ALTER TABLE "test_templates" ADD COLUMN IF NOT EXISTS "examTier" TEXT;
ALTER TABLE "test_templates" ADD COLUMN IF NOT EXISTS "tierPaper" TEXT;
ALTER TABLE "test_templates" ADD COLUMN IF NOT EXISTS "targetQuestions" INTEGER;
