-- CreateTable
CREATE TABLE "vocab_progress_archive" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wordKey" TEXT NOT NULL,
    "bestScorePct" INTEGER NOT NULL DEFAULT 0,
    "attemptsCount" INTEGER NOT NULL DEFAULT 0,
    "lastWrongCount" INTEGER NOT NULL DEFAULT 0,
    "masteredAt" TIMESTAMP(3),
    "forceUnlocked" BOOLEAN NOT NULL DEFAULT true,
    "remasterRequired" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vocab_progress_archive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vocab_progress_archive_userId_wordKey_key" ON "vocab_progress_archive"("userId", "wordKey");

-- CreateIndex
CREATE INDEX "vocab_progress_archive_wordKey_idx" ON "vocab_progress_archive"("wordKey");
