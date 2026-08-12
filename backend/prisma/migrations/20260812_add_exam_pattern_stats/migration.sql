-- v3 §6.4 ExamPattern + v6 §6 TestAttemptStats
CREATE TABLE IF NOT EXISTS "exam_patterns" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "totalQuestions" INTEGER NOT NULL,
    "totalMarks" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "negativeMarks" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "sections" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exam_patterns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "exam_patterns_examId_name_key" ON "exam_patterns"("examId", "name");

CREATE TABLE IF NOT EXISTS "test_attempt_stats" (
    "testTemplateId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "avgScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cutoffScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "toppers" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "test_attempt_stats_pkey" PRIMARY KEY ("testTemplateId")
);

ALTER TABLE "exam_patterns" DROP CONSTRAINT IF EXISTS "exam_patterns_examId_fkey";
ALTER TABLE "exam_patterns" ADD CONSTRAINT "exam_patterns_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "test_attempt_stats" DROP CONSTRAINT IF EXISTS "test_attempt_stats_testTemplateId_fkey";
ALTER TABLE "test_attempt_stats" ADD CONSTRAINT "test_attempt_stats_testTemplateId_fkey" FOREIGN KEY ("testTemplateId") REFERENCES "test_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
