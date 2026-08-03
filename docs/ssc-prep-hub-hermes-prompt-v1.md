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
