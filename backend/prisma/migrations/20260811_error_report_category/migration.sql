-- CreateEnum
CREATE TYPE "ErrorReportCategory" AS ENUM ('WRONG_ANSWER', 'WRONG_OPTION', 'WRONG_EXPLANATION', 'TRANSLATION', 'TYPO', 'MISSING_OPTION', 'DUPLICATE', 'OTHER');

-- AlterTable
ALTER TABLE "question_error_reports" ADD COLUMN     "category" "ErrorReportCategory" NOT NULL DEFAULT 'OTHER';

-- CreateIndex
CREATE INDEX "question_error_reports_category_status_idx" ON "question_error_reports"("category", "status");

