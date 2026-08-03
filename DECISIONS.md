# SSC Prep Hub — Architecture & Engineering Decisions (`DECISIONS.md`)

## Project Overview
- **Name:** SSC Prep Hub (`sscprephub.in`)
- **Target Scale:** 100,000+ registered users, 20,000+ peak concurrent test takers.
- **Architecture:** Monorepo with NestJS Backend (PostgreSQL + Prisma + Redis + BullMQ), Next.js Frontend, and Flutter Mobile App.

---

## Architectural Decisions & Trade-Offs

### 1. Database Schema & Multi-Layer Buffering
- **Decision:** All user test-taking draft answers are buffered in **Redis** during live exams.
- **Trade-off:** Minimal SQL DB traffic during live exams. SQL writes occur asynchronously upon final submission via BullMQ workers.
- **Data Integrity:** Redis data is backed up to persistent queues. Final submit dumps draft choices into `TestAttempt` & `AttemptAnswer` tables with transactional atomicity.

### 2. PDF Processing & Resumable Chunking
- **Decision:** Admin PDF imports are split into 25-page `ImportChunk` records under a parent `ImportBatch`.
- **Trade-off:** Processing large 20,000-question PDFs does not crash memory or block HTTP threads. Individual failed chunks can be retried independently without re-processing the entire PDF.

### 3. AI Enrichment & Fact Verification Policy
- **Decision:** Any AI-inferred fields (chapter, topic, difficulty, generated explanations) are tagged as `AI_INFERRED` or `AI_GENERATED`.
- **Verification Rule:** AI-generated explanations carry an "AI Explanation" label until verified by an admin. Historical exam frequency & previous references are computed strictly from real database queries, never invented by LLM prompts.

### 4. Single-Device Session Enforcement
- **Decision:** Maximum 1 active Web session and 1 active Mobile session per account.
- **Mechanism:** JWTs contain a `sessionId`. When a user logs in on a new device, the previous `sessionId` for that platform type is revoked in Redis.

### 5. Multi-Tenant / Monorepo Layout
- `/backend`: NestJS REST API + WebSockets (Socket.io) + Prisma ORM + BullMQ Workers
- `/frontend`: Next.js 14+ (App Router) + Tailwind CSS + Shadcn UI + Redux Toolkit / React Query
- `/mobile`: Flutter App (Cross-platform Android / iOS / Tablet)
- `/shared`: Shared TypeScript types, schemas, and OpenAPI contracts
