-- S48: (1) practice questions keep half of every topic for tests, (2) the student's target exam. Additive only, re-run safe.

ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "testReserved" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "questions_year_testReserved_chapterId_idx" ON "questions" ("year", "testReserved", "chapterId");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "targetExamId" TEXT;

-- Back-fill: for every leaf (sub-topic, else topic, else chapter) keep floor(n / 2) of the live practice questions for tests.
-- The newest questions are reserved first. Nothing is un-reserved, so running this twice changes nothing the second time.
WITH leaf AS (
  SELECT id, COALESCE("subTopicId", "topicId", "chapterId", "subjectId") AS k, "testReserved", "questionNo"
  FROM "questions"
  WHERE "year" IS NULL AND "isActive" = true AND "isApproved" = true AND "autoSuspended" = false
), cnt AS (
  SELECT k, COUNT(*) AS n, COUNT(*) FILTER (WHERE "testReserved") AS r FROM leaf GROUP BY k
), pick AS (
  SELECT l.id,
         ROW_NUMBER() OVER (PARTITION BY l.k ORDER BY l."questionNo" DESC) AS rn,
         (c.n / 2) - c.r AS need
  FROM leaf l JOIN cnt c ON c.k = l.k
  WHERE l."testReserved" = false AND (c.n / 2) > c.r
)
UPDATE "questions" SET "testReserved" = true WHERE "id" IN (SELECT id FROM pick WHERE rn <= need);
