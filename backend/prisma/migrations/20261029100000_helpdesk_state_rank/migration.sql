-- Help desk tickets + State rank. Purely additive and re-run safe (every statement is IF NOT EXISTS / guarded).

-- State rank: the student's home state (optional)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "state" TEXT;
CREATE INDEX IF NOT EXISTS "users_state_idx" ON "users"("state");

-- Help desk: a conversation becomes a ticket
ALTER TABLE "support_conversations" ADD COLUMN IF NOT EXISTS "ticketNo" SERIAL;
ALTER TABLE "support_conversations" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'GENERAL';
ALTER TABLE "support_conversations" ADD COLUMN IF NOT EXISTS "priority" TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "support_conversations" ADD COLUMN IF NOT EXISTS "contextJson" JSONB;
ALTER TABLE "support_conversations" ADD COLUMN IF NOT EXISTS "firstResponseAt" TIMESTAMP(3);
ALTER TABLE "support_conversations" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);
ALTER TABLE "support_conversations" ADD COLUMN IF NOT EXISTS "lastStudentMessageAt" TIMESTAMP(3);
ALTER TABLE "support_conversations" ADD COLUMN IF NOT EXISTS "lastStaffMessageAt" TIMESTAMP(3);
ALTER TABLE "support_conversations" ADD COLUMN IF NOT EXISTS "rating" INTEGER;
ALTER TABLE "support_conversations" ADD COLUMN IF NOT EXISTS "ratingNote" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "support_conversations_ticketNo_key" ON "support_conversations"("ticketNo");
CREATE INDEX IF NOT EXISTS "support_conversations_status_category_idx" ON "support_conversations"("status", "category");

-- Old conversations: fill the new timestamps from their messages so the inbox sorts and measures them correctly.
UPDATE "support_conversations" c
SET "lastStudentMessageAt" = m.t
FROM (SELECT "conversationId", MAX("createdAt") AS t FROM "support_messages" WHERE "senderRole" = 'STUDENT' GROUP BY "conversationId") m
WHERE m."conversationId" = c."id" AND c."lastStudentMessageAt" IS NULL;

UPDATE "support_conversations" c
SET "lastStaffMessageAt" = m.t
FROM (SELECT "conversationId", MAX("createdAt") AS t FROM "support_messages" WHERE "senderRole" <> 'STUDENT' GROUP BY "conversationId") m
WHERE m."conversationId" = c."id" AND c."lastStaffMessageAt" IS NULL;

UPDATE "support_conversations" c
SET "firstResponseAt" = m.t
FROM (SELECT "conversationId", MIN("createdAt") AS t FROM "support_messages" WHERE "senderRole" <> 'STUDENT' GROUP BY "conversationId") m
WHERE m."conversationId" = c."id" AND c."firstResponseAt" IS NULL;

UPDATE "support_conversations" SET "resolvedAt" = "updatedAt" WHERE "status" = 'RESOLVED' AND "resolvedAt" IS NULL;

-- Private staff notes
ALTER TABLE "support_messages" ADD COLUMN IF NOT EXISTS "isInternal" BOOLEAN NOT NULL DEFAULT false;

-- Bookmarks list is "newest first" per student
CREATE INDEX IF NOT EXISTS "bookmarks_userId_createdAt_idx" ON "bookmarks"("userId", "createdAt");

-- Duplicates decided automatically after the waiting time (auto-publish)
ALTER TABLE "question_duplicate_reviews" ADD COLUMN IF NOT EXISTS "autoResolved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "question_duplicate_reviews" ADD COLUMN IF NOT EXISTS "autoReason" TEXT;
