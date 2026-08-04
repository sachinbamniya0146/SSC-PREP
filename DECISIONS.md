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

---

## 6. v3 Amendments (2026-08-03) — Personalized Study-Plan, Bilingual Mandate, ₹1/chapter PDF micropayment

Source: `docs/ssc-prep-hub-hermes-prompt-v3.md` (read with v2). Overrides/extends earlier decisions only where noted; everything else in v1/v2 stands.

### 6.1 Pricing — second independent revenue stream (AMENDS v1)
- Test-PDF download priced **₹1/chapter, one-time**, alongside (not replacing) the subscription tiers.
- Server-side enforcement only; never trust the client:
  - New `ChapterPurchase(user_id, exam_id, subject_id, chapter_id, amount_paise, payment_ref, purchased_at)` ledger.
  - Charge only if not already purchased for `(user_id, exam_id, chapter_id)` — never double-charge a chapter.
  - Payment via Razorpay/UPI with **webhook-confirmed** settlement before the purchase row is written. A client-side success callback alone is forgeable → never treat it as paid.
- Subscription tier and chapter-PDF purchases are independent; free-tier users can buy individual chapter PDFs.

### 6.2 Personalized Study Plan (NEW)
- `StudyPlan` row per user; a user may hold multiple parallel plans (multiple exams) — no single-plan restriction.
- Onboarding: exam selection → combined vs subject-wise → duration (3/6/12 months or custom, stored as `start_date`+`target_date`) → daily quota → subject weighting → reminder → roadmap.
- `ExamPattern` (sections/marks/duration/negative marking) drives every downstream surface: quizzes, PYQ sets, generated test PDFs.
- Daily quota: `daily_target = ceil(pool_size / remaining_days)`, recomputed **daily**, backlog redistribution across remaining days on a miss, capped (default 3× original), excess carried forward, never dropped.
- Subject weighting via admin-maintained `ExamSubjectWeight(exam_id, subject_id, weight_pct)` — not a hardcoded split.
- Reminder stored as `(user_id, plan_id, local_time, timezone, days_of_week)` — never raw UTC (DST/travel drift).
- Roadmap granularity: **day-by-day** (Hermes picks + documents; avoided week-by-week ambiguity).

### 6.3 Bilingual now MANDATORY (rests on v2 §7 bilingual-import requirement)
- Hard publish gate: `Question` must carry `text_en`, `text_hi`, `options_en[]`, `options_hi[]`, `explanation_en`, `explanation_hi`. Cannot leave review queue unless BOTH languages pass validation (no empties, option-count parity, matching correct-answer index).
- Missing-language half is machine-translated + `translation_status: auto_unverified`; enters live pool only after admin approval (same treatment as AI explanations).
- Persistent language toggle (not per-question); switching mid-test re-renders without losing state/timer.
- Applies to every SSC exam — no Hindi-only or English-only tier.

### 6.4 Quiz engine split — two explicit modes (NEW)
- **Practice:** untimed/self-timed, instant feedback, no anti-cheat, free pause/resume.
- **Live/Daily Test:** fixed real-exam duration; server-authoritative countdown (client clock never trusted); auto-submit at zero; tab-switch/blur logged; single attempt.
- Both feed the same analytics → weak-area detection.

### 6.5 Daily Test distinct from Daily Practice (NEW)
- Daily Practice: casual/gamified, loose rotation, no fixed exam pattern.
- Daily Test: day's `daily_target` questions in Live mode following `ExamPattern` (proportional short test until pool grows enough for a full-pattern test).
- Missed Daily Test → folds into backlog redistribution (6.2).

### 6.6 Subject-wise standalone practice (NEW)
- Works alongside combined plan; whether it counts against the daily quota is a global admin toggle, **default OFF** (separate).
- Subject-only prep (no combined roadmap) gets its own per-subject quota/roadmap.

### 6.7 PYQ as first-class module (NEW)
- `exam_year`, `exam_shift`, `exam_type` metadata on every Question at ingest.
- Dedicated "Attempt PYQ" surface filtered by chosen exam.
- Roadmap schedules periodic PYQ mock checkpoints (e.g. monthly) from real PYQ sets per ExamPattern.

### 6.8 Book catalog + coverage gap (EXTENDS v2 §7)
- `SourceBook(title, publisher, edition, subject, exam, year)` catalog — bookkeeping of what's ingested, not open-web discovery.
- Coverage gap view: per `(exam, subject, chapter)` question count vs configurable target.
- Duplicate detection reinforced: exact-hash then embedding near-dup across the **entire bank for that exam+subject**; duplicates logged w/ pointer to original.

### 6.9 OPEN PRODUCT DECISIONS — user must confirm before build. Working defaults: À-la-carte (not giftable) → see section below. TODO(phase-n) — see §7.

## 7. Open Product Decisions (from v3 §9) — awaiting user answers
Pending user confirmation before Phase implementation starts:
1. Chapter-PDF purchase: per-account only, or shareable/giftable? [Default: per-account only]
2. Paid subscriber: chapter-PDFs bundled free, or always à la carte? [Open]
3. Standalone subject practice count against combined daily quota? [v3 default: no]
4. "SSC books search": internal catalog only, or open-web discovery? [Default: internal only]
5. Live Test tab-switch/blur: log-only, or auto-invalidate? [Default: log-only]

## 8. Phase 1 Implementation Log (2026-08-03 night — autonomous run)

### 8.1 Built & verified
- **JWT AuthGuard** (global) + `@Public()` decorator + `@CurrentUser()` — access token (type=access, sid claim) verified per request.
- **Refresh-token rotation** — SHA-256 hash stored in `refresh_tokens`; each refresh revokes old row, issues new pair bound to same `sessionId`; reuse of a rotated token → 401 (e2e-tested).
- **RolesGuard + `@Roles(...)`** RBAC — `ADMIN`/`MODERATOR`/`STUDENT`; `GET /users/:id/sessions` admin-only (student → 403, admin → 200, e2e-tested).
- **Email OTP login** — Redis-backed 6-digit code, 10-min TTL, max 5 attempts, single-use, 60s re-issue guard; dev fallback logs OTP when SMTP unset (never silently drops); `requestOtp` auto-creates email-first account.
- **Google OAuth** — `google-auth-library` id-token verify, account upsert; returns clean 403 when env keys not configured.
- **Single-device enforcement** — new login for a platform revokes previous active `DeviceSession` (DB) + Redis session key; 1 WEB + 1 APP max.
- **Config validation** — Joi schema in `src/config/env.validation.ts`; fail-fast on missing/invalid required env (min-32-char JWT secrets enforced).
- **Security middleware** — Helmet (in main.ts wiring below), global ThrottlerGuard 60 req/min/IP, per-route login 10/min + OTP 5/min.
- **Tests** — 15 e2e tests (supertest) green: signup/login/me/refresh-rotation/logout/OTP/RBAC. `npm test`.
- **CI** — `.github/workflows/ci.yml`: Postgres 16 + Redis 7 services, `npm ci` → prisma migrate → lint → typecheck → build → test.
- **Bilingual Question schema** — `explanationHindi` + `translationStatus` enum (`HUMAN_VERIFIED`|`AUTO_UNVERIFIED`) migration applied.
- **Question bank seed** — `scripts/seed-questions.mjs`: 831 verified PYQ imported (exams CGL/CHSL/CPO/MTS/GD, Reasoning subject, 21 chapters). Answer integrity double-checked: pass-1 letter validity (0 bad), pass-2 cross-match vs Pinnacle book hand-solved sol files (**0 mismatches**).

### 8.2 Notes & trade-offs
- JWT sign uses `jsonwebtoken` directly (not `@nestjs/jwt` service) because `@nestjs/jwt` types accept only string/Buffer payloads; module still registers JwtModule for `JwtService` in guards.
- Hindi for 815 rows: machine translation job `scripts/translate-hindi.mjs` (Gemini, rate-limit aware, resumable) → all output `translationStatus=AUTO_UNVERIFIED`; live pool entry requires admin approval (v3 §6.3 / v2 Rule 7).
- `explanationSource=HUMAN_VERIFIED` on imported rows — answers/solutions came from the book hand-solved set, not LLM.
- Global 60 req/min throttle is deliberately tight for dev; widen via `ThrottlerModule` config before load testing (Phase 9).

### 8.3 Next (Phase 2)
- Question CRUD admin API + Meilisearch + filters; guards on question-bank module; OpenAPI docs; unit tests for services (Phase 1 DoD test coverage is e2e-only so far).




---

## 9. v4 Amendments (2026-08-04) — Frontend & PYQ Search Overhaul

Spec saved to `docs/ssc-prep-hub-hermes-prompt-v4.md` (Sections 29–35). Adds a frontend UI overhaul + Hermes-driven PYQ ingestion on top of v1–v3.

### 9.1 §29 Rendering bug — ROOT CAUSE + FIX (verified live)
- **Root cause:** `frontend/postcss.config.*` was MISSING. Tailwind PostCSS plugin never ran, so `@tailwind base/components/utilities` passed through literally (524-byte CSS). Browser ignored them → whole site unstyled (browser-serif headings, blue links).
- **Fix:** created `frontend/postcss.config.mjs` `{tailwindcss:{},autoprefixer:{}}`, rebuilt, restarted :3000. CSS now 19,669 bytes; computed-style verify: H1=sans-serif, 0 blue links, bg-primary applied. **FIXED & confirmed.**

### 9.2 §30–33 Frontend design system & screens (P0-sequential)
- Design system: Inter/Manrope + Noto Sans Devanagari, brand color tokens, 8px grid, shadcn-style components, Framer Motion (in deps).
- Real-exam test-taking UI (§31), results/analysis (§32), discovery+PYQ library UI (§33) — wired to existing bank (831 verified PYQ / 818 seeded).
- Follow §35 order; ship incrementally, deploy after each step.

### 9.3 §34 PYQ auto-fetch — EXTENDS v3 §22 review-gate, NOT a bypass
- Admin-triggered job searches candidates (official ssc first, reputable secondary as candidates). Nothing auto-publishes; same review → ingestion pipeline as uploads.
- Never ingest competitor copyrighted explanations/proprietary content — only source paper/answer key (public commission material).
- SearchMiss demand signal + coverage dashboard per exam.

### 9.4 new open decisions this pass
1. Test-language lock (§31): comprehension locks at selection; others per user pick — spec as-written.
2. Pause per test type: mocks disallow, practice allow — admin-configurable field on TestTemplate (new column).
3. Proctoring (webcam, §31) — Phase-9+, not this pass.
4. Cut-off (§32) — admin-set or historically derived, real data, never placeholder.
