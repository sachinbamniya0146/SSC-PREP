-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'PAIDED', 'REWARDED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "freeSubFromReferral" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredByCode" TEXT;

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "purchasesCount" INTEGER NOT NULL DEFAULT 0,
    "rewardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_quizzes" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "subjectId" TEXT,
    "examId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_quiz_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dailyQuizId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "totalCorrect" INTEGER NOT NULL DEFAULT 0,
    "totalWrong" INTEGER NOT NULL DEFAULT 0,
    "totalSkipped" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "daily_quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weak_topic_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "topicId" TEXT,
    "attemptsMade" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "accuracyPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "strengthScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "isWeak" BOOLEAN NOT NULL DEFAULT false,
    "maxAttempts" INTEGER NOT NULL DEFAULT 25,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weak_topic_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_accesses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "freeMocksAllowed" INTEGER NOT NULL DEFAULT 2,
    "mocksUsed" INTEGER NOT NULL DEFAULT 0,
    "paidPacksPurchased" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mock_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_packs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "examId" TEXT,
    "mocksIncluded" INTEGER NOT NULL DEFAULT 5,
    "priceInr" DOUBLE PRECISION NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_packs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "referrals_referrerId_idx" ON "referrals"("referrerId");

-- CreateIndex
CREATE INDEX "referrals_refereeId_idx" ON "referrals"("refereeId");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referrerId_refereeId_key" ON "referrals"("referrerId", "refereeId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_quizzes_date_key" ON "daily_quizzes"("date");

-- CreateIndex
CREATE INDEX "daily_quiz_attempts_userId_idx" ON "daily_quiz_attempts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_quiz_attempts_userId_dailyQuizId_key" ON "daily_quiz_attempts"("userId", "dailyQuizId");

-- CreateIndex
CREATE INDEX "weak_topic_reports_userId_strengthScore_idx" ON "weak_topic_reports"("userId", "strengthScore");

-- CreateIndex
CREATE INDEX "weak_topic_reports_userId_isWeak_idx" ON "weak_topic_reports"("userId", "isWeak");

-- CreateIndex
CREATE INDEX "mock_accesses_userId_idx" ON "mock_accesses"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "mock_accesses_userId_examId_key" ON "mock_accesses"("userId", "examId");

-- CreateIndex
CREATE UNIQUE INDEX "users_referralCode_key" ON "users"("referralCode");

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_quiz_attempts" ADD CONSTRAINT "daily_quiz_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_quiz_attempts" ADD CONSTRAINT "daily_quiz_attempts_dailyQuizId_fkey" FOREIGN KEY ("dailyQuizId") REFERENCES "daily_quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weak_topic_reports" ADD CONSTRAINT "weak_topic_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weak_topic_reports" ADD CONSTRAINT "weak_topic_reports_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_accesses" ADD CONSTRAINT "mock_accesses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

