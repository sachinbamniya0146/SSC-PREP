-- FIX (Sep 26 2026) — "chat support working nahi hai".
--
-- Root cause: SupportConversation, SupportMessage, and ReportMessage were
-- added to schema.prisma (and fully implemented in support-chat.service.ts /
-- report-error.service.ts / chat.gateway.ts) but NO migration was ever
-- generated for them — the two existing chat-related migration folders
-- (20260811_error_report, 20260811_error_report_category) only cover
-- QuestionErrorReport itself, not its message thread or the general support
-- chat. On the real database these three tables never existed, so every
-- single chat API call (POST /support-chat/start, /support-chat/:id/messages,
-- the report-thread equivalents) was failing with a Postgres
-- "relation ... does not exist" error — the code was correct, it just had
-- nowhere to write.
--
-- Also missing: QuestionErrorReport.firstAdminViewAt (added to schema.prisma,
-- never migrated) — used by report-error.service.ts to flip a report from
-- OPEN to REVIEWING the first time an admin actually opens/replies to it.
--
-- This migration is purely additive — it only creates what schema.prisma
-- already declares. Nothing existing is touched.

-- ---- QuestionErrorReport: the one missing column ----
ALTER TABLE "question_error_reports" ADD COLUMN IF NOT EXISTS "firstAdminViewAt" TIMESTAMP(3);

-- ---- Shared enum used by both message tables ----
DO $$ BEGIN
    CREATE TYPE "SenderRole" AS ENUM ('STUDENT', 'ADMIN', 'MODERATOR');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ---- ReportMessage: per-report-error chat thread ----
CREATE TABLE IF NOT EXISTS "report_messages" (
    "id"               TEXT NOT NULL,
    "reportId"         TEXT NOT NULL,
    "senderId"         TEXT NOT NULL,
    "senderRole"       "SenderRole" NOT NULL,
    "contentEncrypted" TEXT NOT NULL,
    "contentIv"        TEXT NOT NULL,
    "contentAuthTag"   TEXT NOT NULL,
    "readAt"           TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "report_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "report_messages_reportId_createdAt_idx" ON "report_messages"("reportId", "createdAt");
DO $$ BEGIN
    ALTER TABLE "report_messages" ADD CONSTRAINT "report_messages_reportId_fkey"
        FOREIGN KEY ("reportId") REFERENCES "question_error_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
    ALTER TABLE "report_messages" ADD CONSTRAINT "report_messages_senderId_fkey"
        FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ---- SupportConversation + SupportMessage: general "Chat with Admin" ----
DO $$ BEGIN
    CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'RESOLVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "support_conversations" (
    "id"              TEXT NOT NULL,
    "studentId"       TEXT NOT NULL,
    "status"          "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "subject"         TEXT,
    "assignedAdminId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "support_conversations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "support_conversations_studentId_status_idx" ON "support_conversations"("studentId", "status");
CREATE INDEX IF NOT EXISTS "support_conversations_status_updatedAt_idx" ON "support_conversations"("status", "updatedAt");
DO $$ BEGIN
    ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_studentId_fkey"
        FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "support_messages" (
    "id"               TEXT NOT NULL,
    "conversationId"   TEXT NOT NULL,
    "senderId"         TEXT NOT NULL,
    "senderRole"       "SenderRole" NOT NULL,
    "contentEncrypted" TEXT NOT NULL,
    "contentIv"        TEXT NOT NULL,
    "contentAuthTag"   TEXT NOT NULL,
    "readAt"           TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "support_messages_conversationId_createdAt_idx" ON "support_messages"("conversationId", "createdAt");
DO $$ BEGIN
    ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_conversationId_fkey"
        FOREIGN KEY ("conversationId") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
    ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_senderId_fkey"
        FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
