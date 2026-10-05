-- AI solution verification by students (>= 10 confirmations => saved permanently)
ALTER TYPE "ExplanationSource" ADD VALUE IF NOT EXISTS 'COMMUNITY_VERIFIED';

ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "explanationVerifiedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "explanation_votes" (
  "id" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "vote" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "explanation_votes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "explanation_votes_questionId_userId_key" ON "explanation_votes"("questionId", "userId");
CREATE INDEX IF NOT EXISTS "explanation_votes_questionId_vote_idx" ON "explanation_votes"("questionId", "vote");

ALTER TABLE "explanation_votes" ADD CONSTRAINT "explanation_votes_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "explanation_votes" ADD CONSTRAINT "explanation_votes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
