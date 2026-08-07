# SSC PREP HUB — MASTER BUILD PLAN (Consolidated v1+v2+v3)

> Consolidated 2026-08-03 from the complete spec set. Source files:
> - `ssc-prep-hub-hermes-prompt-v1.md` — **engineering-grade core spec** (full): product, tech stack pinned, fixes to original brief, architecture, DB schema, auth/sessions, PDF pipeline, test engine, analytics, admin, security/perf/reliability, phased roadmap, DoD
> - `ORIGINAL-BRIEF.md` — the raw user brief (feature checklist, v1 source)
> - `ssc-prep-hub-hermes-prompt-v2.md` — full rewrite of §7 (PDF pipeline at scale) + §§15–20 (Daily Practice, Premium Gating, Scale, Sync, Admin Import Dashboard, Quality Bar)
> - `ssc-prep-hub-hermes-prompt-v3.md` — amends v1 pricing (₹1/chapter micropayment) + adds personalized study-plan, bilingual mandate, quiz modes, Daily Test, PYQ module, subject-wise practice, book catalog
> Conflict precedence: v3 > v2 > v1 > raw brief. Where v2/v3 conflict with v1 they win (logged in DECISIONS.md §6). The phased roadmap in v1 §12 governs execution order; v3 features land in the phase where they naturally fit (study-plan → Phase 6, micropayment → Phase 5, bilingual gate → Phase 3).

---

# PART A — v1 (CORE SPEC, FULL — source of truth for stack/architecture/roadmap/DoD)

# SSC Prep Hub — Master Build Prompt for Hermes AI Agent

> This is a rewritten, engineering-grade version of the original brief. It keeps every feature you asked for, but fixes contradictions, adds the missing technical detail an AI agent needs to actually build this without guessing, and adds explicit quality gates so "zero bugs" and "production ready" are enforceable instead of just aspirational words.

---

## 0. How to Use This Prompt (Read First)

You are **Hermes**, acting as a senior full-stack engineer, system architect, database architect, security engineer, DevOps engineer, and AI engineer combined. You are building **SSC Prep Hub**, a production SaaS exam-prep platform.

**Operating rules for you, the agent:**

1. **Never silently invent business rules.** If a requirement is ambiguous (pricing, grading rules, refund policy, etc.), state your assumption explicitly in a comment or a `DECISIONS.md` file and proceed — do not block on it, but do not hide it either.
2. **No hardcoded secrets, credentials, or admin accounts.** Every credential, key, and config value comes from environment variables (`.env`, validated with a schema, e.g. `zod` or `class-validator`). Ship a `.env.example` with every service.
3. **No placeholder logic pretending to be real.** If a feature is out of scope for the current phase, do not fake it — mark it clearly as `// TODO(phase-2): not implemented` and make sure calling code fails safely (proper error, not silent no-op).
4. **Build in phases, not one giant drop.** "Zero bugs across the entire platform in one pass" is not achievable for a system this size. Deliver in the phased roadmap defined in Section 12. Each phase must be independently runnable, tested, and demoable before the next begins.
5. **Every phase ends with a checklist pass** (Section 13, Definition of Done) before you consider it complete.
6. **Explain trade-offs.** When you choose between two valid approaches (e.g., NestJS module boundaries, queue vs. cron), briefly say why.

---

## 1. Product Summary

**Name:** SSC Prep Hub
**Domain:** sscprephub.in
**Tagline:** "India's Most Advanced SSC Practice Platform"

An exam-preparation platform for SSC (Staff Selection Commission) and related competitive exams (CGL, CHSL, CPO, MTS, GD, JE, Stenographer, Selection Post, Delhi Police, CISF, CRPF, BSF, CAPF), covering Reasoning, English, General Awareness, Quantitative Aptitude, Computer, Current Affairs, and Static GK.

Core differentiators vs. Testbook / Oliveboard / Adda247 / PracticeMock / ixamBee:
- Modern, fast UI (sub-1s route transitions, no framework bloat)
- **No manually hardcoded question bank** — questions are ingested from admin-uploaded PDFs through an AI extraction pipeline with a human-review safety net (see Section 7)
- Deep analytics (weak-topic detection, predicted score, percentile modeling)
- Real SSC-exam-accurate test-taking UI (palette, timer, negative marking, auto-submit)
- Single active session per platform (1 web + 1 app) with visibility into device history

---

## 2. Tech Stack (Pinned & Justified)

| Layer | Choice | Notes |
|---|---|---|
| Web frontend | Next.js (App Router, latest stable), React, TypeScript (strict mode) | SSR/ISR for SEO on blog + landing pages; CSR for the test-taking app shell |
| Styling/UI | Tailwind CSS, shadcn/ui, Framer Motion | Design tokens defined once, dark/light/system theme via CSS variables |
| Client state/data | Redux Toolkit (session, test-attempt state), TanStack React Query (server cache) | Don't duplicate server state into Redux — Query owns server data, Redux owns local/UI/test-runner state |
| PWA | next-pwa or native App Router service worker | Offline shell + cached question packs for offline practice |
| Backend | Node.js LTS, NestJS (modular monolith to start — see Section 4) | TypeScript strict, DI-based, testable modules |
| ORM/DB | PostgreSQL (primary), Prisma ORM | All schema changes via Prisma Migrate, never manual SQL in prod |
| Cache/session | Redis | Session store, rate-limit counters, leaderboard sorted sets, BullMQ backing store |
| Queue | BullMQ (Redis-backed) | PDF parsing jobs, email jobs, report generation, analytics recomputation |
| Auth | JWT access token (short-lived, 15 min) + refresh token (httpOnly cookie, rotated) | Email/password, Email OTP, Google OAuth |
| Payments | Razorpay | Signed webhooks, idempotent webhook handler, invoice PDF generation |
| Object storage | AWS S3 (+ Cloudflare CDN in front) | PDFs, question images, generated PDFs (answer keys, certificates) |
| Search | Meilisearch | Question/topic/paper/year/shift search, typo-tolerant |
| Realtime | Socket.io (with Redis adapter for horizontal scaling) | Live tests, live leaderboard |
| Mobile | Flutter (Android, iOS, tablet, desktop, web) | Single codebase, shares REST/WS API with the web client |
| Observability | Sentry (errors), OpenTelemetry + Prometheus/Grafana (metrics/traces), pino (structured logs) | **Not in the original brief — required for "production ready."** |
| Testing | Jest + Supertest (backend unit/integration), Playwright (E2E web), Flutter integration_test (mobile) | **Not in the original brief — required for "zero bugs" to mean anything.** |
| CI/CD | GitHub Actions → Docker build → registry → deploy | Lint, typecheck, test, build must all pass before merge to `main` |
| Infra | Docker Compose (dev), Docker + Nginx reverse proxy (prod), managed Postgres/Redis recommended over self-hosting at scale | |
| Analytics | Custom event pipeline (Postgres/ClickHouse for aggregates) + Google Analytics + Microsoft Clarity | Custom analytics needs its own event schema — see Section 9 |

---

## 3. Fixes & Clarifications to the Original Brief

The original spec had a few internal contradictions and gaps. Resolve them as follows unless the product owner says otherwise:

1. **Pricing conflict:** "Monthly ₹19" and "24 Months ₹199" look like placeholder/typo figures (₹19/month is below sustainable unit economics for this feature set). Implement the **subscription plan model as fully configurable** (admin can create/edit plans, durations, and prices from the dashboard) rather than hardcoding either figure. Flag this to the product owner in `DECISIONS.md`.
2. **"AI extracts everything automatically, zero manual typing":** Full automation with zero errors is not realistic for OCR + math/Hindi text + table extraction. Implement AI extraction **with a mandatory human-review queue** — every AI-parsed question gets a confidence score; anything below a threshold (configurable, default 90%) is routed to admin for manual correction before it goes live. This is what makes the question bank actually trustworthy, and it's what "production ready" requires.
3. **"1 Web session + 1 App session, enforced":** Define exactly what "logout from previous session" means technically: on new login, invalidate the previous session's refresh token server-side (Redis-backed session registry keyed by `userId` + `platform`), and push a Socket.io `force-logout` event to the old session if it's connected, else it dies on next token refresh attempt. Store device fingerprint, IP, user-agent, approximate location (IP geolocation) per session for the admin's device-history view.
4. **"Zero bugs" / "no shortcuts":** Treated as a quality bar, not a literal claim. Enforced via: mandatory tests for all business logic, typed API contracts (OpenAPI generated from NestJS decorators, shared types with frontend), CI gates, and staged rollout (staging → canary → full prod) rather than a promise that no bug will ever exist.
5. **Missing but required for real production use:** environment separation (dev/staging/prod configs), backup & disaster recovery policy (Section 11), data retention policy for audit logs, GDPR/DPDP-style user data export & deletion (India's DPDP Act 2023 applies here — required for a platform storing PII and payment data), and monitoring/alerting (Section 11).
6. **AI Doubt Solver / Adaptive Mock / Smart Recommendations:** These need to explicitly call out which LLM/provider powers them (configurable via env, e.g., Anthropic API), with rate limiting and cost controls per user tier, since these are the features most likely to blow up an unbounded cloud bill if unguarded.

---

## 4. System Architecture

Start as a **modular monolith** in NestJS (not microservices) — it's faster to build correctly, easier to keep transactionally consistent (payments + subscriptions + question bank), and can be split into services later once real traffic patterns are known. Enforce module boundaries as if they were services (no reaching into another module's Prisma models directly — go through its service layer).

```
apps/
  web/                # Next.js app
  admin/              # Next.js admin dashboard (separate app, shared design system)
  api/                # NestJS backend
  mobile/             # Flutter app
packages/
  ui/                 # shared shadcn/ui-based component library (web + admin)
  types/              # shared TypeScript types / generated OpenAPI client
  config/             # shared eslint/tsconfig/tailwind config
infra/
  docker/
  nginx/
  github-actions/
```

Backend module boundaries (NestJS modules):
`auth`, `users`, `sessions-devices`, `subscriptions`, `payments`, `question-bank`, `pdf-ingestion`, `tests-engine`, `analytics`, `notifications`, `search`, `blog-cms`, `support-tickets`, `admin`, `audit-log`.

---

## 5. Database Schema (Core Entities)

Design in Prisma. Minimum required models — expand as needed, but do not ship without these:

- `User` (id, email, passwordHash nullable [for OAuth-only users], name, role enum[STUDENT, ADMIN, MODERATOR], emailVerifiedAt, createdAt, ...)
- `Session` (id, userId, platform enum[WEB, APP], refreshTokenHash, deviceFingerprint, ip, userAgent, location, createdAt, revokedAt)
- `SubscriptionPlan` (id, name, durationMonths, priceInPaise, isActive) — admin-editable, not hardcoded
- `Subscription` (id, userId, planId, status enum[ACTIVE, PAUSED, EXPIRED, CANCELLED, REFUNDED], startedAt, expiresAt)
- `Payment` (id, userId, razorpayOrderId, razorpayPaymentId, amountInPaise, status, invoiceUrl, createdAt)
- `Coupon` (id, code, discountType, discountValue, maxUses, expiresAt)
- `Exam` (id, name) — CGL, CHSL, etc.
- `Subject`, `Chapter`, `Topic`, `SubTopic` (self-referential hierarchy or explicit FK chain)
- `SourcePdf` (id, s3Key, uploadedByAdminId, subject, examId, year, shift, status enum[PROCESSING, NEEDS_REVIEW, PUBLISHED, FAILED])
- `Question` (id, sourcePdfId nullable, examId, subjectId, chapterId, topicId, subTopicId, questionText, questionTextHi, options[Json], correctOptionIndex, explanation, difficulty enum, language enum, year, shift, paperCode, marks, negativeMarks, questionType, tags[String[]], images[String[]] (S3 keys), aiConfidenceScore, reviewStatus enum[AI_DRAFT, IN_REVIEW, APPROVED, REJECTED], reviewedByAdminId)
- `TestTemplate` (id, type enum[CHAPTER, TOPIC, SUBJECT, MINI_MOCK, FULL_MOCK, PYQ, SHIFT_WISE, YEAR_WISE, CUSTOM, WEAK_TOPIC, SPEED, REVISION, RANDOM], config[Json])
- `TestAttempt` (id, userId, testTemplateId, startedAt, submittedAt, autoSubmitted bool, status)
- `AttemptAnswer` (id, attemptId, questionId, selectedOptionIndex nullable, isMarkedForReview, isVisited, timeSpentSeconds)
- `Bookmark`, `Note` (userId, questionId, content)
- `ErrorReport` (id, questionId, userId, description, status)
- `Notification` (id, userId, type, payload, readAt)
- `AuditLog` (id, actorId, action, entityType, entityId, diff[Json], createdAt) — **required for admin actions on payments/questions/users**
- `BlogPost`, `SupportTicket`

Every table with money uses **integer paise**, never floats. Every table touched by GDPR/DPDP export/delete requests must be enumerated in a `DATA_INVENTORY.md`.

---

## 6. Authentication & Session Management

- Signup: email + password (bcrypt/argon2 hashed) or Google OAuth.
- Email OTP for login and verification (6-digit, 10-min expiry, rate-limited to 5 attempts).
- Forgot password: signed, short-lived reset token emailed, single use.
- Access token: JWT, 15 min expiry. Refresh token: httpOnly + secure + sameSite cookie on web, secure storage (Keychain/Keystore) on Flutter, 30-day expiry, rotated on every refresh, revocable server-side via the `Session` table.
- Single-session enforcement per Section 3.3.
- Admin RBAC: `ADMIN` and `MODERATOR` roles at minimum, enforced via NestJS guards + decorators (`@Roles('ADMIN')`), never via frontend-only checks.

---

## 7. PDF → Question Bank Pipeline (AI Ingestion)

This is the platform's core differentiator and its highest-risk component. Build it as an explicit pipeline with human-in-the-loop review, not a black box:

1. **Upload:** Admin uploads PDF via a wizard, providing metadata up front (Subject, Book Name, Publisher, Language, Exam, Year, Shift). File goes to S3; `SourcePdf` row created with status `PROCESSING`; a BullMQ job is enqueued.
2. **Extraction worker:** OCR (for scanned pages) + text extraction, layout analysis to segment question/options/answer/explanation blocks, math (LaTeX/MathML) and table detection, Hindi + English text handling.
3. **Structuring:** An LLM-based extraction step maps raw segmented content into the `Question` schema fields (subject/chapter/topic/subtopic tagging, difficulty estimation, tag generation) and emits an `aiConfidenceScore` per question.
4. **Review gate:** Questions below the confidence threshold (or all questions, admin-configurable) land in an admin review queue (`reviewStatus = IN_REVIEW`) with a side-by-side UI: original PDF page image vs. extracted structured question, inline edit, approve/reject.
5. **Publish:** Approved questions become `APPROVED` and are immediately searchable (Meilisearch index update) and available to the test engine. Rejected ones are logged with a reason for future model improvement.
6. **Failure handling:** If extraction fails outright (corrupt PDF, unsupported layout), `SourcePdf.status = FAILED` with a visible error and retry option — never a silent drop.

This pipeline must have its own test suite with sample PDFs (text-based and scanned) as fixtures.

---

## 8. Real Exam-Accurate Test Engine

- Question palette with status colors: Not Visited / Visited-Not Answered / Answered / Marked / Marked-and-Answered.
- Server-authoritative timer: client shows a countdown, but submission validity and auto-submit are enforced server-side against `TestAttempt.startedAt + template duration`, so client clock manipulation can't extend time.
- Autosave: every answer change is persisted (debounced) via an API call, not just at submit — protects against browser crash/network loss.
- Network recovery: on reconnect, client re-fetches attempt state from server as source of truth.
- Fullscreen mode + tab-switch detection (log tab-switch events; policy on how many warnings before auto-submit is admin-configurable, not silently punitive).
- On submit: compute score server-side only (never trust client-submitted score), including negative marking per question, then generate result + rank + percentile (percentile computed against other attempts on the same `TestTemplate`, recomputed asynchronously as more people attempt it).

---

## 9. Analytics Engine

Two layers:

1. **Product analytics** (GA + Clarity): standard event tracking for UX/funnel analysis.
2. **Learning analytics** (custom, core to the product): per-user weak subject/topic/chapter detection (rolling accuracy per topic), strong-area detection, a study-plan generator, a heuristic (not overclaimed as guaranteed) "estimated SSC score" and "selection probability" band based on historical cutoffs data (must be clearly labeled as an estimate, not a promise, for compliance/trust reasons), topic heatmaps, and progress/accuracy/attempt-trend graphs.

Compute expensive aggregates (heatmaps, trends) via scheduled BullMQ jobs into pre-aggregated tables, not on-the-fly on every dashboard load.

---

## 10. Admin Dashboard

Revenue (today/monthly/yearly), subscription counts (active/expired/inactive), daily logins, tests attempted today, total questions solved, average score, payment history, coupons, notification/email composer, PDF upload + review queue, question CRUD, analytics, device/session monitoring, support tickets, blog CMS, audit log viewer. All destructive or financial actions (refund, subscription cancel, question deletion) go through the `AuditLog`.

---

## 11. Security, Performance, Reliability (Required, Not Optional)

**Security:** rate limiting (per-IP and per-user, Redis-backed), Helmet, strict CORS, CSRF protection on cookie-based flows, parameterized queries only (Prisma handles this — no raw string SQL), input validation on every endpoint (`class-validator` DTOs), encryption at rest for sensitive fields, signed + verified Razorpay webhooks with replay protection, audit logs for admin actions, dependency vulnerability scanning in CI.

**Performance:** lazy loading, image optimization (Next/Image + S3/CDN), Redis caching for hot reads (question lists, leaderboards), gzip/brotli compression, DB indexes on every foreign key and every filter column (subject/chapter/topic/exam/year/shift), connection pooling (PgBouncer at scale).

**Reliability (missing from the original brief, required for real production use):**
- Automated daily DB backups with tested restore procedure.
- Staging environment mirroring prod for pre-release validation.
- Health check endpoints (`/health`) wired into deploy pipeline and uptime monitoring.
- Error tracking (Sentry) with alerting on error-rate spikes.
- Structured logs with request correlation IDs.
- Documented rollback procedure in CI/CD.

---

## 12. Phased Delivery Roadmap

Do not attempt to deliver everything simultaneously. Build and fully harden each phase before moving on:

- **Phase 1 — Foundation:** Monorepo scaffold, DB schema + migrations, auth (email/password + OTP + Google), RBAC, session/device management, base Next.js app shell with theming, CI pipeline with lint/typecheck/test gates.
- **Phase 2 — Question Bank Core:** Subject/chapter/topic/subtopic hierarchy, manual question CRUD (admin), search (Meilisearch), filters, bookmarks/notes — this gives you a working core before the AI pipeline is layered on.
- **Phase 3 — PDF Ingestion Pipeline:** Upload wizard, OCR/extraction worker, review queue, publish flow, per Section 7.
- **Phase 4 — Test Engine:** All test types, palette UI, timer, autosave, scoring, result page, PDF downloads (answer key, report, certificate).
- **Phase 5 — Payments & Subscriptions:** Razorpay integration, plans, coupons, invoices, admin subscription controls.
- **Phase 6 — Analytics & Gamification:** Learning analytics, dashboards, leaderboard, streaks, XP/badges, daily challenge.
- **Phase 7 — Extras:** AI doubt solver, voice search, blog/CMS, notifications, support tickets, referral/affiliate.
- **Phase 8 — Mobile (Flutter):** Build against the now-stable REST/WS API contract; sync logic reuses the same session/device rules as web.
- **Phase 9 — Hardening & Launch:** Load testing, security audit, DR drill, monitoring dashboards, staged rollout.

---

## 13. Definition of Done (Per Phase)

A phase is not complete until:
- [ ] All endpoints have DTO validation and OpenAPI docs generated
- [ ] Unit tests cover business logic (services), integration tests cover controllers
- [ ] No `any` types, no disabled ESLint rules without a comment explaining why
- [ ] Migrations are reversible and reviewed
- [ ] Feature works end-to-end in a Playwright test for the primary user flow
- [ ] Errors are logged with context, never swallowed
- [ ] Secrets/config confirmed to come from env, not code
- [ ] `DECISIONS.md` updated with any assumptions made this phase

---

## 14. What to Output First

Start with **Phase 1** only. Deliver: monorepo structure, Prisma schema for auth/users/sessions, working auth endpoints with tests, and the Next.js app shell with dark/light/system theming. Stop and summarize what was built, what was assumed (via `DECISIONS.md`), and what's next — do not proceed to Phase 2 without confirmation.


---

# PART B — v2 (PDF IMPORT @ SCALE + SYNC + PREMIUM + ADMIN + QUALITY, FULL)

# SSC Prep Hub — Master Build Prompt for Hermes AI Agent (v2)

> This version supersedes `ssc-prep-hub-hermes-prompt.md` (v1). It folds in your new PDF Import & Question Bank spec, fixes the parts of it that would break at real scale or invite hallucinated content, and adds the sections it was missing (Daily Practice, Premium Gating, Scale Architecture, Sync Strategy, Admin Import Dashboard, Quality Bar). Sections 0–6, 8, 10–14 are unchanged from v1 and summarized here for context; **Section 7 is fully rewritten** and **Sections 15–20 are new**.

---

## 0. Operating Rules for Hermes (unchanged from v1)

1. Never silently invent business rules — log assumptions in `DECISIONS.md`, don't block on them.
2. No hardcoded secrets/credentials — everything from validated env config.
3. No fake placeholder logic — unimplemented scope is marked `TODO(phase-n)` and fails safely, never silently no-ops.
4. Build in phases (Section 12); each phase is independently runnable, tested, demoable.
5. Every phase passes the Definition of Done (Section 13) before moving on.
6. Explain trade-offs when choosing between valid approaches.

**New rule for this version:**

7. **Never let the AI pipeline present a guess as a verified fact.** Anything the extraction/enrichment/explanation AI generates that isn't literally present in the source PDF (inferred chapter/topic, generated explanation, "expected exam frequency," "previous SSC references," etc.) must be visibly tagged as AI-generated/unverified until a human admin approves it. This is a trust-and-legal issue, not a style preference — students are making exam-prep decisions off this data.

---

## 1–6, 8, 10–14. (Unchanged — see v1)

Product summary, tech stack, architecture, DB schema core, auth/sessions, test engine, admin dashboard, security/performance/reliability, phased roadmap, and Definition of Done all carry over from v1 without changes. Section 9 (Analytics) and Section 7 (PDF pipeline) are extended below — read those as replacements, not additions, where they overlap.

---

## 7. PDF → Question Bank Pipeline (Rewritten, Full Spec)

### 7.1 Source-of-truth principle

The question database is generated **only** from admin-uploaded PDFs. No hand-written or scraped questions. Every `Question` row traces back to a `SourcePdf` (or, for AI-generated explanations, to an `AIGeneration` record — see 7.6) so provenance is always auditable.

### 7.2 "Read every page, skip nothing" — implemented as resumable chunked processing, not a single blocking job

A literal "process the whole PDF in one shot" job breaks at real scale (a 20,000-question PDF can be thousands of pages). Instead:

- On upload, the PDF is split into **page-range chunks** (e.g., 25 pages per chunk) as separate BullMQ jobs, all children of one `ImportBatch` record.
- Each chunk job is independently retryable. If chunk 40/200 fails (corrupt page, OCR timeout), only that chunk retries — the other 199 are unaffected and already committed.
- `ImportBatch` tracks `totalChunks`, `completedChunks`, `failedChunks`, giving the admin a real progress bar instead of a spinner.
- **Guarantee, made concrete:** every page is assigned to exactly one chunk; the batch is not marked `COMPLETE` until every chunk reports `SUCCESS` or is explicitly marked `SKIPPED_BY_ADMIN` with a reason. This is how "never skip a page" becomes something you can actually verify, instead of a promise with no mechanism behind it.
- No artificial cap on question count per PDF or per batch — the cap that matters is *chunk concurrency* (how many chunks process in parallel, tunable via env, defaults to worker pool size), not total question count.

### 7.3 Per-page detection pipeline

For every page, in order:
1. Page-type classification (question page / answer-key page / instructions / blank / index) — skips only truly content-free pages, and logs *why* a page was classified as skippable.
2. OCR (only if the page is a scanned image; skip OCR for already-selectable text to save cost/time).
3. Language detection per text block (Hindi / English / mixed) — questions with mixed script are kept mixed, not forced into one language field.
4. Layout segmentation: question stem, options (A–D or A–E), answer key reference, explanation block, table regions, image regions, math regions (rendered to LaTeX where possible, otherwise kept as an image crop with the surrounding text as alt-context).
5. Metadata extraction per question: chapter, topic, sub-topic, exam name, year, shift, paper code, difficulty (if stated), marks, negative marks — using the batch-level metadata (Subject/Exam/Year/Shift/Language/Book/Publisher provided by the admin at upload) as defaults, overridden per-question only when the page clearly states something different.

### 7.4 Duplicate detection (concrete algorithm, not just a field list)

Two-stage, because exact-match alone misses paraphrases and near-match alone is too slow at scale:

- **Stage 1 — fast exact/near-exact:** normalize question text (strip whitespace/punctuation/case), hash it, and compare against a hash index scoped by `(examId, subjectId, year, shift, paperCode)`. Combined with options-set comparison. This is cheap and catches true duplicates (same PDF re-uploaded, or the same paper appearing in two source books).
- **Stage 2 — near-duplicate:** for questions that pass Stage 1 (no exact hash hit), compute a text embedding and compare against existing questions in the same topic via approximate nearest-neighbor search (e.g., pgvector). Above a similarity threshold (tunable, default 0.92) → flagged as `POSSIBLE_DUPLICATE`, routed to the review queue with the candidate match shown side-by-side, **not auto-rejected** — a human decides, because two genuinely different SSC papers legitimately reuse near-identical questions across years.
- Every duplicate decision (auto-skip on Stage 1, or admin decision on Stage 2) is logged with the reason and the matched question ID, so the import history is explainable.

### 7.5 Versioning — "never overwrite, maintain history"

- Every admin edit to a `Question` creates a `QuestionVersion` row (previous state snapshot) rather than mutating in place silently — the live `Question` row updates, but you can diff/revert.
- `ImportBatch` supports **rollback**: rolling back a batch soft-deletes (sets `isActive = false`, not a hard delete) every `Question` whose origin was that batch, preserving history and any bookmarks/notes/attempts that already reference those questions (attempts keep referencing the historical version — you never break a student's past result by rolling back a later import).
- Re-running an import on the same PDF (or a corrected re-upload) is treated as a **new `ImportBatch`** that goes through duplicate detection against the existing bank — it merges, it does not blindly re-insert.

### 7.6 Explanation generation policy (the riskiest part of the original spec — tightened)

If a PDF already contains an explanation, extract it as-is (tagged `source: PDF`).

If it doesn't, generate one via LLM, but with explicit guardrails:

- Generated fields: correct answer restatement, step-by-step solution, a shortcut/trick where applicable, common mistakes, a memory aid, an alternative method, related concepts — all fine to generate, tagged `source: AI_GENERATED`, shown to students with a small "AI-generated explanation" label until an admin has approved it (approval flips the label off).
- **"Previous SSC References" and "Expected Exam Frequency" are NOT generated by the LLM guessing.** These must be computed from real data: frequency = actual count of similar/duplicate topic questions already in the DB across imported years/shifts; "previous references" = an actual query against the `Question` table for the same topic in prior years, with real question IDs linked — never a fabricated citation. If there isn't enough real data yet, show "Not enough data yet" instead of inventing a number.
- Rate-limit and cost-cap LLM explanation generation per import batch (configurable), since a 20,000-question PDF with no explanations could otherwise trigger 20,000 uncontrolled LLM calls — batch and queue these as their own job type, separate from extraction, so a slow explanation backlog never blocks questions from being usable (a question can go live without its explanation and have the explanation backfilled).

### 7.7 Enrichment when metadata is incomplete

If chapter/topic/difficulty aren't stated in the PDF, infer them — tagged `AI_INFERRED`, same review-queue treatment as everything else AI-touched. Difficulty inference should be seeded from real signal where available (e.g., historical attempt data for similar questions) rather than pure LLM guess, and re-calibrated over time as real attempt data accumulates for that question.

---

## 15. Daily Practice Mode

- Every registered user (free tier included) gets **10 free questions/day**, resetting at midnight IST (server-authoritative, not client clock).
- Selection algorithm: weighted-random across subjects the user hasn't practiced recently, excluding questions attempted in the last N days (configurable) to avoid repeats, with topic rotation tracked per user (`DailyPracticeHistory` table) so it isn't purely random every day.
- Timer per question (soft, informational for free daily practice — not exam-strict like a real test attempt).
- Instant explanation shown right after each answer (not batched at the end).
- Daily score, streak counter (`currentStreak`, `longestStreak`, `lastPracticeDate` on `User` or a `StreakLog` table), XP and coins awarded per correct answer with streak multipliers, leaderboard entry (daily + all-time boards, Redis sorted sets), and a "revise this" suggestion for any topic missed that day.
- Daily Practice attempts feed the same analytics pipeline as full tests (Section 9), just tagged with a different `TestTemplate.type = DAILY_PRACTICE` so they contribute to weak-topic detection too.

## 16. Premium Gating & Entitlements

- A single `EntitlementGuard` (NestJS) checks subscription status on every gated route — never a frontend-only check.
- Free tier: Daily Practice (10/day), basic bookmarks, limited analytics (current streak + today's score only).
- Premium tier (active `Subscription`): unlimited tests of every type (chapter/topic/subject/mini-mock/full-mock/PYQ/shift-wise/year-wise/custom/weak-topic/speed/revision/random), full analytics suite, Wrong Question Notebook, AI recommendations, PDF downloads.
- Expired-subscription behavior: user keeps read access to their own past results/history (never lock a student out of their own historical data) but loses access to starting new premium tests — this must be an explicit, tested state, not an edge case discovered in production.

## 17. Scale & Performance Architecture

Design target: **100,000+ registered users, 20,000+ concurrent, millions of questions, millions of test attempts.** Concrete measures, not just buzzwords:

- **DB:** connection pooling via PgBouncer; read replicas for analytics/reporting queries so they never compete with live test-taking writes; table partitioning by month for high-growth tables (`TestAttempt`, `AttemptAnswer`, `AuditLog`, analytics event tables); index every FK and every filter column used by the Filters UI (subject/chapter/topic/exam/year/shift/difficulty/language).
- **Cache:** Redis for hot reads — question lists per filter combo, leaderboard sorted sets, session registry, rate-limit counters — with explicit TTLs and cache-invalidation on question edits/approvals.
- **Search:** Meilisearch sized and sharded for the target question volume; reindex incrementally on question approve/edit, not full reindex per change.
- **Queues:** BullMQ workers horizontally scaled independently from the API (separate deployable), so a PDF import spike never starves live test-taking traffic.
- **Realtime:** Socket.io with the Redis adapter so WS state (live leaderboard, force-logout events) works correctly across multiple API instances, not just one.
- **CDN:** all static assets, question images, and generated PDFs served through Cloudflare CDN, not through the API origin.
- **Load testing is a deliverable, not an afterthought:** ship a k6 (or Artillery) test plan simulating the 20,000-concurrent target against the test-taking flow specifically (start test → answer → autosave → submit), run it in Phase 9 (Hardening & Launch), and record actual p95/p99 latency and error-rate results — "designed to support 20,000 concurrent users" only means something once it's been load-tested against that number.

## 18. Web ↔ Flutter Sync Strategy

"Everything syncs instantly" is refined into two real mechanisms, because they're not the same problem:

- **Truly real-time** (leaderboard position, force-logout, live-test broadcasts): pushed via Socket.io to both platforms.
- **Everything else** (bookmarks, notes, progress, subscriptions, payments, test attempts, wrong-question notebook): standard REST writes with optimistic local UI updates, reconciled against server as source of truth on next fetch. For offline-capable actions (Flutter offline mode, PWA offline practice), queue writes locally and sync on reconnect using **last-write-wins with server timestamps** for simple fields, and an explicit conflict surface (not silent overwrite) for anything where losing data would matter (e.g., a note written offline on two devices) — flag conflicting notes for the user to pick rather than silently discarding one.
- Both platforms consume the **same versioned REST/WS API contract** (OpenAPI-generated client) — no platform-specific backend logic forks.

## 19. Admin PDF Import Dashboard

- Single/bulk PDF upload with per-file metadata form (Subject, Book, Publisher, Language, Exam, Year, Shift).
- Import queue view: per-`ImportBatch` progress bar (chunks completed/failed/total, per Section 7.2), live status.
- Duplicate detection log: Stage 1 auto-skips and Stage 2 flagged-for-review items, both visible and filterable.
- Error log per batch (which chunk/page failed and why), with a **retry-chunk** action (not just retry-whole-file).
- OCR status per page/chunk.
- Import history: every batch ever run, who ran it, outcome, with a **rollback** action (Section 7.5).
- Preview: side-by-side original PDF page vs. extracted structured question before publish.
- Manual edit, approve, reject actions on individual questions, with bulk-approve for high-confidence batches (still logged to `AuditLog`).
- Search across imported questions by any metadata field, including "show me everything from `ImportBatch #X`."

## 20. Quality Bar, Made Measurable

"No bugs, no performance issues, enterprise-grade" is enforced via the Definition of Done (Section 13) plus these concrete, testable targets — set them explicitly so "premium/polished/enterprise-grade" isn't just a vibe:

- Core Web Vitals: LCP < 2.5s, INP < 200ms, CLS < 0.1 on the main student-facing routes (home, test list, test-taking, results).
- API latency budget: p95 < 300ms for reads, p95 < 500ms for writes, under the Section 17 load-test scenario.
- Zero `console.error`/unhandled promise rejections in Playwright E2E runs across the primary flows (signup → practice → test attempt → result → subscribe).
- Every admin-destructive action (delete question, cancel subscription, refund, rollback import) requires confirmation + is reversible or explicitly logged as irreversible with a warning.
- No broken links / dead routes: verified via an automated crawl step in CI against the staging build before each release.

---

## Next Step

Sections 7 and 15–20 above are ready to hand to Hermes alongside v1's Sections 1–6, 8, 10–14. Recommended: still start execution at **Phase 1** per v1 Section 14 — the PDF pipeline (Phase 3) now has a much more concrete spec to build against once you get there, but auth/DB/shell still comes first.


---

# PART C — v3 (PERSONALIZATION + BILINGUAL MANDATE + MICROPAYMENT, FULL)

# SSC Prep Hub — Master Prompt v3 (Personalization, Bilingual Mandate & Monetization Extension)

**Read this together with:** `ssc-prep-hub-hermes-prompt.md` (v1 — core platform architecture) and `ssc-prep-hub-hermes-prompt-v2.md` (v2 — PDF import & question bank pipeline). This document does not repeat what v1/v2 already specify (schema conventions, CI gates, observability, phased roadmap, PDF-import chunking/dedup mechanics) — it adds the features requested in this round and explicitly flags where it **amends** v1/v2 decisions (mainly pricing).

## 0. What's new in this pass

1. Personalized study-plan engine (exam selection → duration → daily quota → roadmap)
2. Daily reminder/alarm system (web + app)
3. Mandatory Hindi + English bilingual content for every SSC exam, not just some
4. Real-time quiz engine hardened into two explicit modes (live vs practice)
5. Daily Test as a feature distinct from casual Daily Practice
6. PYQ (Previous Year Questions) as a first-class, exam-tagged module
7. Subject-wise standalone practice mode (opt out of the combined roadmap)
8. Book-catalog search + stronger duplicate-awareness for PDF imports (coverage gap analysis)
9. Test-PDF generation with a chapter-level ₹1 micropayment (amends the v1 pricing model — new revenue stream alongside the existing subscription, not a replacement)

## 1. Amendment to Pricing Model (v1 §Monetization)

v1 defined subscription tiers gating quiz/session access. This round adds a **second, independent revenue stream**: downloadable test PDFs, priced **per chapter, ₹1 each, one-time**.

Rules Hermes must enforce server-side (never trust the client):

- A chapter is "purchased" once per `(user_id, exam_id, chapter_id)` — record it in a `ChapterPurchase` ledger (`user_id, exam_id, subject_id, chapter_id, amount_paise, payment_ref, purchased_at`).
- Before charging, check the ledger. If already purchased, generate the PDF for free — **never charge twice for the same chapter.**
- Payment must go through a real gateway (Razorpay/UPI is the sane default for an India-only SSC audience) with a **webhook-confirmed** payment before the purchase row is written. Do not mark "purchased" on a client-side success callback alone — that's forgeable.
- Subscription tier and chapter-PDF purchases are independent: a free-tier user can still buy individual chapter PDFs. Whether a paid subscriber gets chapter PDFs bundled free is an open product decision (see §9), not an assumption to bake in silently.

## 2. Personalized Study-Plan Onboarding

New first-run (and re-runnable) flow. Persist as a `StudyPlan` row per user — a user may hold more than one active plan if prepping for multiple exams in parallel; allow this rather than forcing a single plan.

**Step 1 — Which exam(s):** Ask which SSC exam the user is targeting — CGL, CHSL, MTS, GD Constable, CPO, Steno, JE, Selection Post, or "General/All." This drives which question pool and which `ExamPattern` (sections, marks, duration, negative marking) apply everywhere downstream: quizzes, PYQ sets, and generated test PDFs.

**Step 2 — Combined or subject-wise:** Ask whether the user wants one merged roadmap across all subjects for that exam, or wants to run subjects independently (e.g. only Quant). Support both concurrently — a user can have a combined plan *and* dip into standalone subject practice without it disturbing the combined plan's quota (see §6).

**Step 3 — Prep duration:** 3 / 6 / 12 months, or a custom day count. Store as `start_date` + `target_date`, not just a label, so it survives the user pausing and resuming.

**Step 4 — Daily quota calculation:**

```
remaining_days = target_date - today
pool_size      = count(published, non-retired questions for exam_id[, subject_id])
daily_target   = ceil(pool_size / remaining_days)
```

Recompute `remaining_days` and `daily_target` **daily**, not just once at plan creation. A missed day should redistribute the backlog across the remaining days rather than silently vanishing or piling up unbounded. Cap the daily maximum (admin-configurable, sane default e.g. 3× the original daily_target) so a long absence doesn't produce an impossible single-day catch-up — carry the excess forward instead of dropping it.

**Step 5 — Subject weighting inside a combined plan:** Don't split the daily quota evenly across subjects by default — weight it by each exam's actual syllabus/marks distribution. This needs an admin-maintained `ExamSubjectWeight(exam_id, subject_id, weight_pct)` table, seeded from the syllabus and editable later, rather than a hardcoded split.

**Step 6 — Reminder alarm:** Let the user pick a daily time. Web: browser push notification via service worker (needs subscription + permission handling, with a documented fallback — e.g. an in-app banner — for browsers/PWA states where push isn't available). App: native local notification/alarm, respecting OS-level do-not-disturb and Android battery-optimization exemptions so it's actually reliable. Store the reminder as `(user_id, plan_id, local_time, timezone, days_of_week)`, not a raw UTC timestamp — a raw UTC value drifts across DST/travel.

**Step 7 — Confirm & generate roadmap:** Materialize a day-by-day (or week-by-week — Hermes should pick one and document the choice) breakdown showing question count per day, with PYQ mock checkpoints marked (see §7).

## 3. Bilingual Content — Now Mandatory, Not Partial

v2 already required bilingual storage for imported questions; this round makes it a **hard publish gate for every exam**, not an aspiration:

- `Question` must carry `text_en`, `text_hi`, `options_en[]`, `options_hi[]`, `explanation_en`, `explanation_hi`. A question **cannot leave the human-review queue and become "published"** unless both language variants are present and pass the same validation (no empty fields, option-count parity between languages, correct-answer index matching in both).
- If the PDF import pipeline (v2 §7) only extracts one language, the missing one is machine-translated but flagged `translation_status: auto_unverified` — the same treatment v2 already gives AI-generated explanations. It doesn't enter the live pool until an admin approves the translation.
- UI: a persistent language toggle, not a per-question one — switching mid-test re-renders the current questions in the new language without losing test state or the running timer.
- This applies uniformly across **every** SSC exam on the platform. There is no Hindi-only or English-only exam tier.

## 4. Real-Time Quiz Engine — Practice vs Live Test Mode

Split what v2 called "real-time" into two explicit modes so Hermes doesn't conflate them:

- **Practice mode:** untimed or self-timed, instant per-question feedback allowed, no anti-cheat, free pause/resume.
- **Live/Daily Test mode:** fixed duration matching the real exam's `ExamPattern`; server-authoritative countdown (the client clock is never trusted — the server timestamps the start and computes remaining time on each request); auto-submit at zero; tab-switch/blur events logged (log-only vs. attempt-invalidating is an open decision, see §9); single attempt per test instance.
- Both modes feed the same scoring/analytics pipeline so results drive the same weak-area detection the roadmap uses.

## 5. Daily Test vs Daily Practice — Distinct Features

v2 introduced Daily Practice (streaks, XP, rotation). This round adds **Daily Test** as a separate, roadmap-driven feature:

- **Daily Practice** — casual, gamified, pulls loosely from due/weak-area questions, no fixed exam pattern.
- **Daily Test** — the day's `daily_target` questions from §2, delivered in Live Test mode, following the real `ExamPattern` for the user's chosen exam once enough questions have accumulated for a full-pattern test (a shorter proportional test otherwise).
- A missed Daily Test folds into the backlog redistribution described in §2 Step 4 rather than being discarded.

## 6. Subject-wise Standalone Practice

- A user with a combined plan can still open any individual subject and practice freely.
- Admin-configurable toggle: does standalone subject practice **count against** the combined plan's daily quota, or is it fully separate? Default to **separate** — don't let ad-hoc practice quietly finish someone's roadmap early or throw off the pacing (confirmable in §9).
- A user who wants *only* subject-wise prep, with no combined roadmap at all, skips §2 Step 2's combined option entirely and gets an independent per-subject quota/roadmap instead.

## 7. PYQ (Previous Year Questions) as a First-Class Module

- Every imported question carries `exam_year`, `exam_shift` (where applicable), and `exam_type` metadata at ingest time — add this field to v2's import pipeline if it isn't already there.
- Dedicated "Attempt PYQ" surface, filtered to the user's chosen exam, so they can attempt real past papers standalone, outside the roadmap.
- The roadmap (§2 Step 7) also schedules periodic **PYQ mock checkpoints** (e.g. monthly) built entirely from real PYQ sets following the exam's actual `ExamPattern`, distinct from the day-to-day, pool-derived Daily Test.

## 8. PDF Book Catalog Search & Import Coverage

Extends v2 §7 (PDF import pipeline):

- Maintain a lightweight `SourceBook(title, publisher, edition, subject, exam, year)` catalog for every PDF an admin has ever imported, searchable from the admin panel. This is bookkeeping for *what's already been ingested* — not open web book discovery. If the intent is actually to search the internet for new reference books, that's a materially different (and larger) feature; flag it in §9 rather than assuming.
- **Coverage gap view:** for each `(exam, subject, chapter)`, show current question count against a configurable target. This is what tells an admin which chapters need a new source PDF — the direct answer to "which questions haven't been uploaded yet."
- Reinforce v2's duplicate detection at every new import: exact-hash pass, then embedding-based near-duplicate pass, across the **entire existing bank for that exam+subject**, not just within the current PDF. A second book covering the same chapter must not re-insert questions the first book already contributed. Duplicates get logged with a pointer to the original — never silently dropped without a record.

## 9. Open Product Decisions

Hermes should get explicit answers to these before building, not assume:

- Do chapter-PDF purchases apply per user account only, or can a purchase be shared/gifted?
- Does a paid subscriber get chapter-PDFs bundled free, or is it always à la carte?
- Does standalone subject practice count against the combined roadmap's daily quota (default proposed in §6: no)?
- Is "SSC books search" meant as internal catalog search only (§8), or should the platform search the open web for reference books?
- Tab-switch/blur detection in Live Test mode (§4): log-only, or should it auto-invalidate the attempt?

---

*This v3 is written as a self-contained extension: it assumes v1 and v2 stand as-is except where explicitly amended above (§1). If you'd rather have one single fully-merged master document instead of three files, share the actual v1/v2 text and it can be consolidated.*


---

# PART D — RAW ORIGINAL BRIEF (feature checklist reference)

# SSC Prep Hub — Master Build Prompt v1 (Core Platform Architecture)

> Original base spec (2026-08-03). This is the full v1. v2 (`ssc-prep-hub-hermes-prompt-v2.md`) rewrites §7 and adds §§15–20; v3 (`ssc-prep-hub-hermes-prompt-v3.md`) amends pricing and adds personalization/bilingual/PYQ features. Read all three together, or use `SSC-PREP-HUB-MASTER-PLAN.md`.

---

You are a Senior Full Stack Engineer, UI/UX Designer, System Architect, Database Architect, Security Engineer, Mobile App Developer, DevOps Engineer, AI Engineer, Performance Optimization Expert and Product Designer.

Your task is to build a production-ready SSC exam preparation platform similar to Testbook, Oliveboard, Adda247, PracticeMock and ixamBee but with a more modern UI, faster performance, better analytics and cleaner architecture.

=====================================================

PROJECT NAME

=====================================================

SSC Prep Hub

Domain:
sscprephub.in

Tagline:

India's Most Advanced SSC Practice Platform

=====================================================

GOAL

=====================================================

Create a Premium SSC Preparation Website + Mobile App.

The platform must be capable of handling lakhs of users.

No placeholder code.

No dummy pages.

Everything should be production ready.

Use best coding standards.

Zero bugs.

No shortcuts.

Follow scalable architecture.

=====================================================

TECH STACK

=====================================================

Frontend

Next.js Latest

React Latest

TypeScript

Tailwind CSS

Shadcn UI

Framer Motion

React Query

Redux Toolkit

PWA Support

Backend

Node.js

NestJS

PostgreSQL

Prisma ORM

Redis

BullMQ Queue

Authentication

JWT

Refresh Token

Email OTP Login

Google Login

Password Reset

Email Verification

Admin RBAC

Payment

Razorpay

Webhook Verification

Invoice Generation

Subscription Management

Storage

AWS S3

Cloudflare CDN

Database

PostgreSQL

Search

Meilisearch

Analytics

Custom Analytics

Google Analytics

Microsoft Clarity

Realtime

Socket.io

Deployment

Docker

Nginx

GitHub Actions

CI/CD

=====================================================

MOBILE APP

=====================================================

Build Flutter App

Android

iOS

Tablet

Desktop

Web

Everything must sync.

=====================================================

THEME

=====================================================

Modern

Premium

Minimal

Fast

Dark Mode

Light Mode

System Theme

Smooth animations

=====================================================

AUTHENTICATION

=====================================================

Email Login

Email Signup

OTP Verification

Forgot Password

Remember Login

Single Device Login

If user logs in on Web

Logout from previous Web Session

If logs in App

Previous App logout

Maximum

1 Web Session

1 App Session

Admin can see active devices

Device History

IP Address

Browser

Location

=====================================================

ADMIN ACCOUNT

=====================================================

Admin account must be configurable securely through environment variables or the admin dashboard (do not hardcode credentials).

Admin features:

Dashboard

Revenue

Today's Revenue

Monthly Revenue

Yearly Revenue

Subscriptions

Expired Users

Active Users

Inactive Users

Daily Logins

Tests Attempted Today

Total Questions Solved

Average Score

Payment History

Coupons

Notifications

Emails

PDF Upload

Question Approval

Question Editing

Analytics

=====================================================

SUBSCRIPTIONS

=====================================================

Monthly

₹19

24 Months

₹199

Admin can

Pause Subscription

Refund

Cancel

Gift Subscription

Coupon Codes

Referral

=====================================================

PAYMENT

=====================================================

Razorpay Integration

Webhook

Invoice PDF

GST Ready

Success Page

Failure Page

Retry Payment

=====================================================

QUESTION BANK

=====================================================

The platform must NOT hardcode questions.

Instead

Ask Admin to upload PDFs.

The system must have an Upload PDF Wizard.

When PDF is uploaded

AI should extract:

Subject

Chapter

Topic

Sub Topic

Question

Options

Correct Answer

Explanation

Difficulty

Language

Exam Name

Year

Shift

Paper Code

Marks

Negative Marks

Question Type

Tags

Images

Tables

Math Equations

Hindi Text

English Text

OCR

Formatting

Everything automatically.

=====================================================

SUPPORTED SUBJECTS

=====================================================

Reasoning

English

General Awareness

Quantitative Aptitude

Computer

Current Affairs

Static GK

=====================================================

SUPPORTED EXAMS

=====================================================

SSC CGL

SSC CHSL

SSC CPO

SSC MTS

SSC GD

SSC JE

SSC Stenographer

SSC Selection Post

Delhi Police

CISF

CRPF

BSF

CAPF

Other SSC Exams

=====================================================

FILTERS

=====================================================

Questions by

Subject

Chapter

Topic

Sub Topic

Exam

Year

Shift

Difficulty

Attempted

Unattempted

Correct

Incorrect

Bookmarked

Language

=====================================================

PYQ FEATURES

=====================================================

Every question should display:

Exam Name

Year

Shift

Paper

Subject

Chapter

Topic

Marks

Negative Marks

Difficulty

Source PDF

Explanation

Related Questions

Bookmark

Notes

=====================================================

TEST TYPES

=====================================================

Chapter Test

Topic Test

Subject Test

Mini Mock

Full Mock

Previous Year Paper

Shift Wise Paper

Year Wise Paper

Custom Test

Weak Topic Test

Speed Test

Revision Test

Random Test

=====================================================

REAL SSC TEST EXPERIENCE

=====================================================

Exactly like SSC Exam

Question Palette

Visited

Answered

Marked

Marked for Review

Time Left

Question Navigation

Calculator

Instructions

Submit Confirmation

Auto Submit

=====================================================

TEST TIMER

=====================================================

Pause Prevention

Tab Switch Warning

Fullscreen Mode

Auto Save

Network Recovery

=====================================================

RESULT PAGE

=====================================================

Instant Result

Rank

Percentile

Score

Attempted

Correct

Wrong

Skipped

Negative Marks

Accuracy

Speed

Average Time

Question Review

=====================================================

ADVANCED ANALYTICS

=====================================================

AI should analyse

Weak Subject

Weak Topic

Weak Chapter

Strong Areas

Revision Suggestions

Daily Targets

Study Plan

Estimated SSC Score

Probability of Selection

Topic Heatmap

Progress Graph

Accuracy Graph

Attempt Trend

=====================================================

ANSWER REVIEW

=====================================================

Each Question

Correct Answer

Your Answer

Explanation

Video Link

Source

PDF Page Number

Bookmark

Report Error

=====================================================

DOWNLOAD FEATURES

=====================================================

Answer Key PDF

Question Paper PDF

Attempt Report PDF

Performance Report PDF

Certificate PDF

=====================================================

SEARCH

=====================================================

Global Search

Search Question

Search Topic

Search Year

Search Shift

Search Paper

=====================================================

DASHBOARD

=====================================================

Today's Progress

Weekly Progress

Monthly Progress

Study Streak

Daily Goal

Achievements

Leaderboard

=====================================================

BOOKMARKS

=====================================================

Favourite Questions

Favourite Tests

Favourite Topics

=====================================================

NOTES

=====================================================

Student Notes

Highlight

Personal Comments

=====================================================

NOTIFICATIONS

=====================================================

Push Notifications

Email Notifications

Payment Reminder

Test Reminder

=====================================================

BLOG

=====================================================

SSC News

Result Updates

Vacancies

Answer Keys

Preparation Tips

=====================================================

SEO

=====================================================

Complete SEO

Schema

Sitemap

Robots

Fast Loading

Core Web Vitals

=====================================================

SECURITY

=====================================================

Rate Limiting

Helmet

XSS Protection

CSRF

SQL Injection Prevention

Encryption

Audit Logs

=====================================================

PERFORMANCE

=====================================================

Lazy Loading

Image Optimization

Caching

Redis

CDN

Compression

=====================================================

ADMIN PDF IMPORT

=====================================================

The admin must upload SSC PDFs.

The system should automatically ask for:

Subject

Book Name

Publisher

Language

Exam

Year

Shift

Then import all questions.

No manual typing.

=====================================================

IMPORTANT

=====================================================

The website must ask the admin to upload PDF files because the entire question bank will come from uploaded PDFs.

Do not hardcode SSC questions.

Instead create an AI-powered PDF parser that converts uploaded PDFs into a structured database.

=====================================================

EXTRA PREMIUM FEATURES

=====================================================

AI Doubt Solver

Voice Search

Text to Speech

Dark Mode

Light Mode

Offline App

PWA

Daily Challenge

Study Calendar

Leaderboard

Referral

Achievements

Badges

Coins

XP

Daily Login Rewards

Revision Planner

Bookmarks

Question Discussion

Report Error

Announcements

Exam Calendar

Vacancy Tracker

Current Affairs

PDF Reader

Revision Mode

Wrong Question Notebook

Adaptive AI Mock Test

Smart Recommendations

Weak Topic Booster

Live Test

All India Rank

Realtime Leaderboard

Multi Language

Hindi

English

Admin CMS

Support Ticket

Feedback

Coupon System

Affiliate System

Email Templates

Backup System

Restore System

Export Database

Import Database

=====================================================

FINAL GOAL

=====================================================

Build the best SSC Exam Preparation Platform in India with zero bugs, premium UI, scalable backend, AI-powered PDF import, advanced analytics, secure payment system, responsive website, Flutter mobile app, and production-ready deployment.


---

# PART E — REALITY SYNC (Build Status as of 2026-08-04)

> This section is the ground-truth bridge between the spec (Parts A-D) and the actual repository.
> Anything in Parts A-D that is not reflected here is **planned, not built** — never assume a
> spec'd feature exists because it's written down. Verify before claiming.

## E.1 What Is Actually Built (verified against repo)

| Area | Status | Evidence |
|---|---|---|
| Monorepo shell (backend/frontend/docker-compose) | DONE | 2 commits: shell + auth hardening |
| Auth: email/password, OTP, Google OAuth, refresh rotation, RBAC, single-device, rate-limit | DONE | backend/src/auth, sessions, CI gates |
| Bilingual question schema (text_en/hi, options parity, translation_status) | DONE | Prisma schema + translation pipeline |
| Question bank seed | DONE | 18 verified PYQs seeded, book pipeline separate |
| Referral (10 PAID → 30d free sub) | DONE | backend/src/referral |
| Analytics (weak/strong → 25Q drill + 10Q test) | DONE | backend/src/analytics, quiz |
| DailyQuiz | DONE | backend/src/quiz |
| Mocks gating (₹10/15d) | DONE | backend/src/bank? (verify) |
| PDF → JSON extraction pipeline | DONE (separate repo: ~/ssc-automation) | 17 chapters, 5081 seedable questions extracted |
| Question bank DB (posts.db) + idempotent loader | DONE | 859 verified Analogy rows, 0 dups, rerun-safe |
| Real-time test engine, payments, Flutter app, Meilisearch, analytics dashboards | NOT BUILT | spec only — later phases |

## E.2 Question Bank Pipeline (ssc-automation) — Current Numbers

- **Source:** Pinnacle 7200 TCS MCQ Chapter-wise Reasoning (English) — 53.8 MB PDF, 17 chapters, **5081 seedable questions**. Book contains NO answer keys (verified page-by-page scan) → answers are derived + verified manually, never OCR'd.
- **Extraction:** 23 JSON files (figure-based chapters like Mirror/Water Image are image-only, not seedable as text).
- **Chapter coverage (text chapters, questions):**
  Analogy 1268 · Series 774 · Coding_and_Decoding 734 · Odd_One_Out 589 · Mathematical_Operations 371 · Statement_and_Conclusion 330 · Word_Arrangement 203 · Sitting_Arrangement 177 · Blood_Relation 162 · Missing_Number 159 · Arithmetic_Reasoning 114 · Miscellaneous 49 · Cube_and_Dice 45 · Direction 43 · Age 38 · Calendar 20 · Venn_Diagram 5
- **Solved and verified so far:** Analogy **859 / 1268** (batches b1-b7). All other chapters: 0.
- **Remaining:** ~4200 questions across 16 chapters — this is the long-tail grind; posting is 1-question-at-a-time on the SSC WhatsApp channel.

## E.3 Verification and Quality Policy (world-best bar, enforced)

1. **Never load a guess as an answer.** Any solution whose rule/relation isn't verified is SKIPPED (stays missing), never guessed. 12 guess-entries removed from b5 and DB in 2026-08-04 cleanup.
2. **Every numeric solution is rule-checked** (relation must reproduce the given pair(s) exactly, then match exactly one option).
3. **Every word/letter solution is semantic-checked** against actual option letters — 3 wrong letters caught and fixed in the b7 review pass.
4. **Loader is idempotent** — re-runs add 0 rows; verified by double-run test.
5. **DB is deduped** — 2549 duplicate rows removed; (topic, book_q) unique enforced.
6. **Topic field uses em-dash:** `Reasoning — Analogy` — query with LIKE '%Analogy', never exact =.

## E.4 Operating Notes (gotchas that cost time)

- Batch print in terminal gets compressed to "1 lines" for big batches → always dump to /tmp file and read that.
- Loader unpack format is the 4-tuple (ans, expl, trick, diff); older 2-tuple files break silently — fixed b5 via regex.
- Java: no system Java — use Android Studio JBR for Android work.
- SSC morning login reminder: cron e135b68213f7, daily 08:00, script ~/.hermes/scripts/ssc_login_reminder.sh.

## E.5 Next Actions (ordered)

1. Finish Analogy: solve + verify remaining ~410 (batches b8+).
2. Stand up a per-chapter solve pipeline for the other 16 chapters (Series, Coding, Odd One Out first — biggest pools).
3. Decide the "no question missed" policy concretely: every book_q must end in either solved+verified or documented-skip(reason) — a question is never silently absent.
4. Then re-focus on ssc-prep-hub Phase 2 remaining scope (payments, test engine) per Parts A-D.

---
