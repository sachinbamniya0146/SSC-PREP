-- S48: in-app notification inbox + reminder switches. Additive only, re-run safe.

CREATE TABLE IF NOT EXISTS "user_notifications" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "url" TEXT,
  "dedupeKey" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_notifications_userId_dedupeKey_key" ON "user_notifications" ("userId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "user_notifications_userId_readAt_createdAt_idx" ON "user_notifications" ("userId", "readAt", "createdAt");

CREATE TABLE IF NOT EXISTS "notification_prefs" (
  "userId" TEXT NOT NULL,
  "weakTopic" BOOLEAN NOT NULL DEFAULT true,
  "streak" BOOLEAN NOT NULL DEFAULT true,
  "tests" BOOLEAN NOT NULL DEFAULT true,
  "news" BOOLEAN NOT NULL DEFAULT true,
  "remindHourIst" INTEGER NOT NULL DEFAULT 19,
  "pausedUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_prefs_pkey" PRIMARY KEY ("userId")
);

DO $$ BEGIN
  ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
