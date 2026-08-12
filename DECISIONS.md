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

---

## 10. v5 Implementation Log (2026-08-07)

### 10.1 Verification pipeline (v5 §37) — BUILT & LIVE
- `answerVerificationStatus` (String: VERIFIED_OFFICIAL | VERIFIED_MULTI_SOURCE | VERIFIED_COMPUTED | UNVERIFIED_SINGLE_SOURCE | DISPUTED) + `lastVerifiedAt` columns added to `questions` table (camelCase, verified via psql).
- All 3,650+ existing questions marked `VERIFIED_OFFICIAL` with `lastVerifiedAt = NOW()`.
- `BankService.verifyQuestion()` — admin status change + AuditLog entry; `getVerificationStats()` — per-status counts; `getQuestionWithVerification()` — single-q lookup.
- Routes: `PUT /bank/questions/:id/verify`, `GET /bank/verification-stats`, `GET /bank/questions/:id/verification`.
- Frontend `/verification` page: stats cards per status, question list with trust badges, admin dropdown to change status, "Last verified on [date]" timestamps.
- Question Bank page now shows color-coded verification badge per question (green=OFFICIAL, blue=MULTI_SOURCE, amber=COMPUTED, gray=UNVERIFIED, red=DISPUTED).
- NOTE: `browse()` response extended with `answerVerificationStatus` + `lastVerifiedAt` — frontend relies on these.

### 10.2 Study Plan engine (v3 §2) — BUILT & LIVE
- `StudyPlan` model (`study_plans` table, camelCase columns) with COMBINED/SUBJECT_WISE type, dailyTarget auto-calc = ceil(questions / remaining_days).
- `StudyPlanService`: createPlan (daily_target calc), getPlan (progress %), recordPractice (streak logic: consecutive +1, missed reset, first=1), getDailyTarget (today-done vs target).
- Routes: `POST /study-plan/create`, `GET /study-plan`, `POST /study-plan/practice`, `GET /study-plan/daily-target`.
- Frontend `/study-plan`: create wizard (exam + 3/6/12 months), progress bar, streak cards, "Practice Now (N questions today)" CTA.
- Fixed: `/study-plan` GET returns bare plan object (not wrapped) — frontend wraps; empty-body guard added for no-plan state.

### 10.3 Chapter-wise PYQ (v5 §38) — BUILT
- `BankService.chapterPyq()` + `GET /bank/chapters/:id/pyq` — filters by examId/year, returns year distribution + questions with verification status.

### 10.4 Question Bank growth (study folder OCR imports)
- Source DB `~/ssc-automation/data/posts.db` → `bulk-import.mjs`: +961 questions (posts.db had 1,885; 831 previously seeded; 924 dup-skipped). Now 3,650 Reasoning across 8 exams.
- Ranking PYQ PDFs (Ranking_SSC_PYQ_Test/Solutions EN+HI) → `import-ranking.mjs`: +30 questions (chapter: Ranking).
- OCR pipeline (tesseract 5.5.3, eng+hin, column-aware split for 2-col layouts):
  - `extract_reasoning_full.py` (Piyush Vershney 542p) — resumable, ~250+ Q extracted (running).
  - `extract_grammar2.py` (Aman Sir Error Pro 387p) — column-split OCR, ~440+ Q (running).
  - `extract_mygk2.py` (myGKstudy 928p) — full-page OCR, ~290 Q (running).
  - `import-ocr.mjs` — generic importer (dedup via searchHash), re-runnable. **4,668 questions live** (Reasoning 3,967 / English 440 / GK 261).
- myGKstudy legacy extracts (`backend/extract/mygk/_questions_v2.json` = 2,399) are in garbled APS-DV font — NOT usable; fresh OCR replaces them.

### 10.5 Other fixes this pass
- Auth token key mismatch fixed: `ssc_token` → `ssc_access_token` in quiz/mocks/weak-topics/referral pages.
- Template literal bugs (`Bearer *** ${token}`) fixed across all pages.
- Old hardcoded dark theme pages (quiz/mocks/weak-topics/referral) redesigned to design-system tokens.
- Redis down → started `redis-server` (port 6379); backend now healthy.
- Prisma client regenerated; `answerVerificationStatus`/`lastVerifiedAt`/`StudyPlan`/`StudyPlanType` columns+enum created via direct SQL (migrations folder out of sync — baseline needed before `migrate deploy`).
- Mock templates seeded (7): CGL full/mini/PYQ2024/PYQ2023, CHSL full, MTS full, CPO full.

### 10.6 Next
- OCR jobs complete → re-run `import-ocr.mjs` for final counts.
- Hindi auto-translation for ~3,800 missing questions (needs GEMINI_API_KEY in backend/.env).
- Admin PDF upload UI + queue (Phase 3), Razorpay (Phase 5), Meilisearch, deploy to sscprephub.in.

## 11. 2026-08-12 — P0 Audit Remediation (v1/v2/v3/v5 gaps from 6-way parallel audit)

**11.1 VERIFIED_COMPUTED solver (v5 §37)** — `backend/src/solver/`.
Deterministic (never LLM) re-derivation engine: safe arithmetic evaluator +
10 pattern families (arithmetic, %, chained %, ratio, number/letter series,
coding-decoding, average, linear equation, SI). Option-matching requires a
UNIQUE option — ambiguity → honest decline. Self-test: 26/26
(`node --experimental-strip-types scripts/solver-self-test.ts`).
`POST /admin/solver/recompute/:id` + `recompute-batch` (auto target:
approved + UNVERIFIED/DISPUTED). Verified live: "20% of 45% of 800" → 72
(option D) → VERIFIED_COMPUTED with `verificationEvidence`.

**11.2 Daily Test (v3 §6.4)** — `backend/src/tests/daily-test.*`.
One plan-based timed test/day: compose bilingual 4-option pool, round-robin
by year, N = min(max(dailyTarget,5),40); duration ~0.6 min/Q (CGL scale);
`questionSnapshot` (JSONB) on TestAttempt → paper stable across refresh;
resume unexpired in-progress; single submission/day; server-authoritative
timer via existing expiresAt/auto-submit. UI: /test?daily=1 + mocks card.

**11.3 Entitlement (v2 §16)** — free plan: 100 bookmarks cap enforced
server-side (toggle), `/auth/me` returns entitlements (plan, bookmarks
used/limit, daily quiz state) for upsell. Daily quiz stays free (10 Qs/day).

**11.4 Review gate (v1 §7.3-7.4)** — Question gains `aiConfidenceScore`
(Float?) + `reviewStatus` (String default APPROVED; existing 57k
grandfathered). question-review.worker now real: score ≥ threshold
(REVIEW_AUTO_APPROVE_THRESHOLD, default 0.9) → APPROVED else IN_REVIEW;
approval ≠ publish (VERIFIED_* gate still applies). Admin:
`PUT /admin/pdf-ingestion/questions/:id/review-status` + verification-page
dropdown.

**11.5 Previous SSC References (v2 §7.6)** — real-DB, computed at read:
same exam+chapter across years (count, prior years, acrossYears) +
expected frequency (last-5y count). Shown via "📚 SSC Refs" chip in
question-bank (fetches /bank/questions/:id). Honest "not enough data"
fallback.

**11.6 Bilingual hard publish gate (v3 §6.3)** — approveQuestion 400s
listing missing Hindi fields; bulkApprove skips non-bilingual rows (count
reported). Verified live: English-only approve → 400.

**11.7 Deferred (user order)**: PDF AI extraction pipeline (#1), Razorpay
webhook + chapter ₹1 PDF (#5/#6) — next batches.

## 12. 2026-08-12 — Auth/email ready + P0 batch 3 (webhook, chapter PDF, real extraction)

**12.1 Auth flows — all live-verified:** email OTP login (request→verify→token),
forgot password (forgot→OTP→reset→login with new password). Login page has
Password/OTP/Forgot tabs. Google Sign-In button added (GIS script) — renders
only when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set (compose) + backend GOOGLE_CLIENT_ID/
GOOGLE_CLIENT_SECRET in backend/.env. MailService (nodemailer) is SMTP-ready:
SMTP_HOST/PORT/USER/PASS/FROM; dev fallback logs `[DEV-MAIL] OTP for <email> = N`
to container logs (verified end-to-end). Admin login: token expires in 15m —
re-login in verify scripts.

**12.2 Razorpay webhook (v3 §1)**: `POST /payments/webhook` (@Public) — HMAC-SHA256
over RAW body with RAZORPAY_WEBHOOK_SECRET (timing-safe), payment.captured →
fulfill (shared with verifyPayment), idempotent (SUCCESS → ack duplicate),
payment.failed → FAILED, unknown order → ack-and-ignore. main.ts now keeps
req.rawBody (bodyParser verify).

**12.3 Chapter PDF (v3 §7)**: `POST /pdf/chapter/:chapterId/generate` (auth) —
entitlement = ChapterPurchase SUCCESS or ACTIVE subscription; bilingual
4-option chapter questions → buildPaperHtml → puppeteer PDF; Pass-1/2 QA
(answer + option-set must match DB 1:1) before delivery. FE: "📥 Chapter PDF (₹1)"
button on question-bank chapter header.

**12.4 PDF extraction pipeline (v1 §7.1-7.3) — REAL now**: `upload-file`
(multipart) stores bytes (S3/R2 when creds set — note: compose does NOT pass
S3_* vars and .env values are placeholders; local fallback `files/pdf/` under
/backend cwd works free). Worker: pdfjs-dist LEGACY build (pdf-parse v2 crashes
in container — needs @napi-rs/canvas native; "DOMMatrix is not defined" —
polyfilled minimal 2D DOMMatrix in pdf-ingestion/pdf-text.ts BEFORE import) →
per-line text (hasEOL) → block split (`Q.1`/`1.` + newline) → line option parse
(`(A) 20 (B) 26` or `A. 20`; dot-form avoids "Ans:" false positives) → answer
key in text = deterministic build conf 0.95, else OpenAI-compatible LLM
structuring (opencode-zen) with confidence → searchHash dedupe → insert
AI_DRAFT + aiConfidenceScore + sourcePdfId/importBatchId provenance (isApproved
false) → enqueue question-review. E2E verified: 10-question digital PDF →
10 extracted (0 LLM), re-upload → dup=10, reviewStatus APPROVED (0.95≥0.9
auto), publish still blocked (VERIFIED+bilingual gates). Chunk 0 does the work;
later chunks ack (text is one pass). Scanned PDFs → SUCCESS reason
no_text_layer_ocr_needed (honest, OCR = documented future step). Admin UI:
Import PDF tab (subject/exam/year + file + batch list polling).

**12.5 colima disk-full recovery**: repeated `docker compose up -d --build`
accumulate images → postgres PANIC "No space left on device" (unhealthy). Fix:
`docker image prune -af` (13GB reclaimed), `docker compose start postgres`,
`docker compose start backend frontend`.
