-- CreateEnum
CREATE TYPE "VideoSource" AS ENUM ('YOUTUBE', 'VIMEO', 'S3_R2', 'CUSTOM');

-- CreateEnum
CREATE TYPE "StudyPlanType" AS ENUM ('COMBINED', 'SUBJECT_WISE');

-- DropIndex
DROP INDEX "mock_accesses_userId_examId_key";

-- AlterTable
ALTER TABLE "daily_quizzes" ADD COLUMN     "questionsJson" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "mock_accesses" DROP COLUMN "examId",
ADD COLUMN     "testTemplateId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "answerVerificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED_SINGLE_SOURCE',
ADD COLUMN     "lastVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "videoDescription" TEXT,
ADD COLUMN     "videoDurationSeconds" INTEGER,
ADD COLUMN     "videoLanguage" TEXT,
ADD COLUMN     "videoSource" "VideoSource",
ADD COLUMN     "videoTitle" TEXT,
ADD COLUMN     "videoUploadedAt" TIMESTAMP(3),
ADD COLUMN     "videoUploadedBy" TEXT,
ADD COLUMN     "videoUrl" TEXT;

-- CreateTable
CREATE TABLE "study_plans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "subjectId" TEXT,
    "type" "StudyPlanType" NOT NULL,
    "startDate" DATE NOT NULL,
    "targetDate" DATE NOT NULL,
    "dailyTarget" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastPracticeDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_users" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "languageCode" TEXT DEFAULT 'en',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "telegram_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_bots" (
    "id" TEXT NOT NULL,
    "botToken" TEXT NOT NULL,
    "botUsername" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "allowedUpdates" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_bots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "study_plans_userId_idx" ON "study_plans"("userId");

-- CreateIndex
CREATE INDEX "study_plans_userId_examId_idx" ON "study_plans"("userId", "examId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_users_userId_key" ON "telegram_users"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_users_chatId_key" ON "telegram_users"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_subscriptions_chatId_type_key" ON "telegram_subscriptions"("chatId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_bots_botToken_key" ON "telegram_bots"("botToken");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_bots_botUsername_key" ON "telegram_bots"("botUsername");

-- CreateIndex
CREATE UNIQUE INDEX "mock_accesses_userId_testTemplateId_key" ON "mock_accesses"("userId", "testTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "weak_topic_reports_userId_chapterId_key" ON "weak_topic_reports"("userId", "chapterId");

-- AddForeignKey
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_users" ADD CONSTRAINT "telegram_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_subscriptions" ADD CONSTRAINT "telegram_subscriptions_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "telegram_users"("chatId") ON DELETE CASCADE ON UPDATE CASCADE;

