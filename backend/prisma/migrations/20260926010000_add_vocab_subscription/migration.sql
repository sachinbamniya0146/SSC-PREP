-- Vocabulary Mastery — dedicated ₹10/month subscription ("ye vocab ka alag
-- subscription rahe"). While active, every word is treated as unlocked
-- regardless of sequential mastery (see VocabService). Additive only.

CREATE TABLE IF NOT EXISTS "vocab_subscriptions" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "startsAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "amountInr" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "status"    "PaymentStatus" NOT NULL DEFAULT 'SUCCESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vocab_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "vocab_subscriptions_userId_key" ON "vocab_subscriptions"("userId");
CREATE INDEX IF NOT EXISTS "vocab_subscriptions_expiresAt_idx" ON "vocab_subscriptions"("expiresAt");
DO $$ BEGIN
    ALTER TABLE "vocab_subscriptions" ADD CONSTRAINT "vocab_subscriptions_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
