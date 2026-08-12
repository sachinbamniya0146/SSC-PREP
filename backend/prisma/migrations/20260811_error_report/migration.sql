-- CreateTable: QuestionErrorReport (v5 §37.4 Report Error + auto soft-suspend)
-- CreateEnum
CREATE TYPE "ErrorReportStatus" AS ENUM ('OPEN', 'REVIEWING', 'CONFIRMED', 'REJECTED');

-- AlterTable
ALTER TABLE "questions" ADD COLUMN "errorReportCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "autoSuspended" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "suspendedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "question_error_reports" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ErrorReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_error_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "question_error_reports_questionId_status_idx" ON "question_error_reports"("questionId", "status");

-- CreateIndex
CREATE INDEX "question_error_reports_status_idx" ON "question_error_reports"("status");

-- CreateIndex
CREATE INDEX "questions_errorReportCount_idx" ON "questions"("errorReportCount");

-- AddForeignKey
ALTER TABLE "question_error_reports" ADD CONSTRAINT "question_error_reports_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_error_reports" ADD CONSTRAINT "question_error_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;