-- Vocabulary Mastery feature (word-by-word learn -> 95%-gated quiz -> next
-- word unlock, daily word-count goal, optional Rs10 force-unlock). Additive
-- only — no existing table touched.

CREATE TABLE IF NOT EXISTS "vocab_words" (
    "id"                 TEXT NOT NULL,
    "slug"               TEXT NOT NULL,
    "word"               TEXT NOT NULL,
    "orderIndex"         INTEGER NOT NULL,
    "partOfSpeech"       TEXT,
    "pronunciation"      TEXT,
    "meaningHindi"       TEXT NOT NULL,
    "meaningEnglish"     TEXT NOT NULL,
    "memoryTrick"        TEXT,
    "etymology"          TEXT,
    "registerNote"       TEXT,
    "examTrendNote"      TEXT,
    "confusingPairNote"  TEXT,
    "examplesJson"       JSONB,
    "synonymsJson"       JSONB,
    "antonymsJson"       JSONB,
    "isActive"           BOOLEAN NOT NULL DEFAULT true,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vocab_words_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "vocab_words_slug_key" ON "vocab_words"("slug");
CREATE INDEX IF NOT EXISTS "vocab_words_orderIndex_idx" ON "vocab_words"("orderIndex");

CREATE TABLE IF NOT EXISTS "vocab_questions" (
    "id"            TEXT NOT NULL,
    "wordId"        TEXT NOT NULL,
    "questionText"  TEXT NOT NULL,
    "optionsJson"   JSONB NOT NULL,
    "correctAnswer" TEXT NOT NULL,
    "explanation"   TEXT,
    "questionType"  TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vocab_questions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "vocab_questions_wordId_idx" ON "vocab_questions"("wordId");
ALTER TABLE "vocab_questions" ADD CONSTRAINT "vocab_questions_wordId_fkey"
    FOREIGN KEY ("wordId") REFERENCES "vocab_words"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "vocab_word_progress" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "wordId"         TEXT NOT NULL,
    "bestScorePct"   INTEGER NOT NULL DEFAULT 0,
    "attemptsCount"  INTEGER NOT NULL DEFAULT 0,
    "lastWrongCount" INTEGER NOT NULL DEFAULT 0,
    "masteredAt"     TIMESTAMP(3),
    "forceUnlocked"  BOOLEAN NOT NULL DEFAULT false,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vocab_word_progress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "vocab_word_progress_userId_wordId_key" ON "vocab_word_progress"("userId", "wordId");
CREATE INDEX IF NOT EXISTS "vocab_word_progress_userId_masteredAt_idx" ON "vocab_word_progress"("userId", "masteredAt");
ALTER TABLE "vocab_word_progress" ADD CONSTRAINT "vocab_word_progress_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vocab_word_progress" ADD CONSTRAINT "vocab_word_progress_wordId_fkey"
    FOREIGN KEY ("wordId") REFERENCES "vocab_words"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "vocab_daily_goals" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "wordsPerDay" INTEGER NOT NULL DEFAULT 1,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vocab_daily_goals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "vocab_daily_goals_userId_key" ON "vocab_daily_goals"("userId");
ALTER TABLE "vocab_daily_goals" ADD CONSTRAINT "vocab_daily_goals_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "vocab_word_purchases" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "wordId"    TEXT NOT NULL,
    "amountInr" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "status"    "PaymentStatus" NOT NULL DEFAULT 'SUCCESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vocab_word_purchases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "vocab_word_purchases_userId_wordId_key" ON "vocab_word_purchases"("userId", "wordId");
ALTER TABLE "vocab_word_purchases" ADD CONSTRAINT "vocab_word_purchases_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vocab_word_purchases" ADD CONSTRAINT "vocab_word_purchases_wordId_fkey"
    FOREIGN KEY ("wordId") REFERENCES "vocab_words"("id") ON DELETE CASCADE ON UPDATE CASCADE;
