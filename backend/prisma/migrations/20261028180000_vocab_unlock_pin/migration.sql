-- Vocabulary: an unlock is permanent. Purely additive and re-run safe.
ALTER TABLE "vocab_word_progress" ADD COLUMN IF NOT EXISTS "unlockedAt" TIMESTAMP(3);

-- Back-fill: every word a student has already worked on (or bought) is pinned open from now on.
UPDATE "vocab_word_progress"
   SET "unlockedAt" = COALESCE("masteredAt", "updatedAt")
 WHERE "unlockedAt" IS NULL
   AND ("masteredAt" IS NOT NULL OR "forceUnlocked" = true OR "attemptsCount" > 0);
