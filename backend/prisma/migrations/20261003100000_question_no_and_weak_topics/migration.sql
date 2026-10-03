-- 1) Unique, human-friendly question number ------------------------------------------------
ALTER TABLE "questions" ADD COLUMN "questionNo" SERIAL;

-- Number the existing questions oldest-first (1, 2, 3 ...) instead of in random order.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "questions"
)
UPDATE "questions" q
SET "questionNo" = ordered.rn
FROM ordered
WHERE q.id = ordered.id;

-- Make the sequence continue after the highest existing number.
SELECT setval(
  pg_get_serial_sequence('"questions"', 'questionNo'),
  COALESCE((SELECT MAX("questionNo") FROM "questions"), 1),
  (SELECT COUNT(*) > 0 FROM "questions")
);

CREATE UNIQUE INDEX "questions_questionNo_key" ON "questions"("questionNo");

-- 2) Persistent weak-topic tracker -------------------------------------------------------
CREATE TABLE "user_weak_topics" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subjectId" TEXT,
  "chapterId" TEXT,
  "topicId" TEXT,
  "subTopicId" TEXT,
  "scopeKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'WEAK',
  "wrongCount" INTEGER NOT NULL DEFAULT 0,
  "attemptedCount" INTEGER NOT NULL DEFAULT 0,
  "practiceSetsDone" INTEGER NOT NULL DEFAULT 0,
  "practiceCorrect" INTEGER NOT NULL DEFAULT 0,
  "practiceTotal" INTEGER NOT NULL DEFAULT 0,
  "lastPracticeScore" INTEGER,
  "lastSourceAttemptId" TEXT,
  "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "strengthenedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_weak_topics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_weak_topics_userId_scopeKey_key" ON "user_weak_topics"("userId", "scopeKey");
CREATE INDEX "user_weak_topics_userId_status_idx" ON "user_weak_topics"("userId", "status");
CREATE INDEX "user_weak_topics_userId_chapterId_idx" ON "user_weak_topics"("userId", "chapterId");

ALTER TABLE "user_weak_topics"
  ADD CONSTRAINT "user_weak_topics_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
