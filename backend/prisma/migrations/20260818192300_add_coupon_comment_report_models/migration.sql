/*
  Warnings:

  - You are about to drop the column `metadataJson` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `aiConfidenceScore` on the `questions` table. All the data in the column will be lost.
  - You are about to drop the column `autoSuspended` on the `questions` table. All the data in the column will be lost.
  - You are about to drop the column `errorReportCount` on the `questions` table. All the data in the column will be lost.
  - You are about to drop the column `reviewStatus` on the `questions` table. All the data in the column will be lost.
  - You are about to drop the column `suspendedAt` on the `questions` table. All the data in the column will be lost.
  - You are about to drop the column `verificationEvidence` on the `questions` table. All the data in the column will be lost.
  - You are about to drop the column `videoDescription` on the `questions` table. All the data in the column will be lost.
  - You are about to drop the column `videoDurationSeconds` on the `questions` table. All the data in the column will be lost.
  - You are about to drop the column `videoLanguage` on the `questions` table. All the data in the column will be lost.
  - You are about to drop the column `videoSource` on the `questions` table. All the data in the column will be lost.
  - You are about to drop the column `videoTitle` on the `questions` table. All the data in the column will be lost.
  - You are about to drop the column `videoUploadedAt` on the `questions` table. All the data in the column will be lost.
  - You are about to drop the column `videoUploadedBy` on the `questions` table. All the data in the column will be lost.
  - You are about to drop the column `videoUrl` on the `questions` table. All the data in the column will be lost.
  - You are about to drop the column `expiresAt` on the `test_attempts` table. All the data in the column will be lost.
  - You are about to drop the column `questionSnapshot` on the `test_attempts` table. All the data in the column will be lost.
  - You are about to drop the column `hintQuota` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `chapter_purchases` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `coupons` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `exam_patterns` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `question_error_reports` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `review_cards` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `search_misses` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `telegram_bots` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `telegram_subscriptions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `telegram_users` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `test_attempt_stats` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `test_pdf_exports` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "chapter_purchases" DROP CONSTRAINT "chapter_purchases_chapterId_fkey";

-- DropForeignKey
ALTER TABLE "chapter_purchases" DROP CONSTRAINT "chapter_purchases_userId_fkey";

-- DropForeignKey
ALTER TABLE "exam_patterns" DROP CONSTRAINT "exam_patterns_examId_fkey";

-- DropForeignKey
ALTER TABLE "question_error_reports" DROP CONSTRAINT "question_error_reports_questionId_fkey";

-- DropForeignKey
ALTER TABLE "question_error_reports" DROP CONSTRAINT "question_error_reports_userId_fkey";

-- DropForeignKey
ALTER TABLE "review_cards" DROP CONSTRAINT "review_cards_questionId_fkey";

-- DropForeignKey
ALTER TABLE "review_cards" DROP CONSTRAINT "review_cards_userId_fkey";

-- DropForeignKey
ALTER TABLE "search_misses" DROP CONSTRAINT "search_misses_userId_fkey";

-- DropForeignKey
ALTER TABLE "telegram_subscriptions" DROP CONSTRAINT "telegram_subscriptions_chatId_fkey";

-- DropForeignKey
ALTER TABLE "telegram_users" DROP CONSTRAINT "telegram_users_userId_fkey";

-- DropForeignKey
ALTER TABLE "test_attempt_stats" DROP CONSTRAINT "test_attempt_stats_testTemplateId_fkey";

-- DropForeignKey
ALTER TABLE "test_pdf_exports" DROP CONSTRAINT "test_pdf_exports_testTemplateId_fkey";

-- DropIndex
DROP INDEX "questions_errorReportCount_idx";

-- DropIndex
DROP INDEX "questions_examId_subjectId_isApproved_isActive_idx";

-- DropIndex
DROP INDEX "test_attempts_testTemplateId_status_idx";

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "metadataJson";

-- AlterTable
ALTER TABLE "questions" DROP COLUMN "aiConfidenceScore",
DROP COLUMN "autoSuspended",
DROP COLUMN "errorReportCount",
DROP COLUMN "reviewStatus",
DROP COLUMN "suspendedAt",
DROP COLUMN "verificationEvidence",
DROP COLUMN "videoDescription",
DROP COLUMN "videoDurationSeconds",
DROP COLUMN "videoLanguage",
DROP COLUMN "videoSource",
DROP COLUMN "videoTitle",
DROP COLUMN "videoUploadedAt",
DROP COLUMN "videoUploadedBy",
DROP COLUMN "videoUrl";

-- AlterTable
ALTER TABLE "test_attempts" DROP COLUMN "expiresAt",
DROP COLUMN "questionSnapshot";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "hintQuota";

-- DropTable
DROP TABLE "chapter_purchases";

-- DropTable
DROP TABLE "coupons";

-- DropTable
DROP TABLE "exam_patterns";

-- DropTable
DROP TABLE "question_error_reports";

-- DropTable
DROP TABLE "review_cards";

-- DropTable
DROP TABLE "search_misses";

-- DropTable
DROP TABLE "telegram_bots";

-- DropTable
DROP TABLE "telegram_subscriptions";

-- DropTable
DROP TABLE "telegram_users";

-- DropTable
DROP TABLE "test_attempt_stats";

-- DropTable
DROP TABLE "test_pdf_exports";

-- DropEnum
DROP TYPE "ErrorReportCategory";

-- DropEnum
DROP TYPE "ErrorReportStatus";

-- DropEnum
DROP TYPE "VideoSource";
