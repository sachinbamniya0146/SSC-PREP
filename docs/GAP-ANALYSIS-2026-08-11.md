# SSC Prep Hub — 5-Prompt Gap Analysis (2026-08-11)

Har prompt (v1–v5 + original brief) ke against current system ka audit.
✅ = done/working · ⚠️ = partial · ❌ = missing

---

## v1 (Core Platform Architecture)

| Requirement | Status | Notes |
|---|---|---|
| Auth: signup/login/OTP/google/refresh/logout/me | ✅ | `auth` controller 8 routes |
| JWT access + refresh (httpOnly) | ✅ | RefreshToken model |
| Admin RBAC (ADMIN/MODERATOR guards) | ⚠️ | Role on User, guards partial |
| **Single-session (1 web + 1 app)** | ⚠️ | DeviceSession model + users/:id/sessions route; force-logout enforcement nahi |
| Email OTP login | ⚠️ | otp/request+verify routes; real email delivery check karna |
| Razorpay payments + webhook + invoice | ❌ | Payment model hai, **controller/module nahi** |
| Subscriptions (plans, pause/refund/cancel/gift) | ❌ | Plan/Subscription models, **no API** |
| Coupons | ❌ | **Coupon model bhi nahi** |
| PDF upload wizard + AI extraction | ✅ | pdf-ingestion: upload/batches/chunks/retry/rollback/approve |
| Question bank 57,049 Qs bilingual | ✅ | EN+HI, verified |
| Search (Meilisearch, typo-tolerant) | ✅ | 57,049 indexed |
| Test engine (palette, timer, autosave, negative marking) | ⚠️ | test page (786 ln) hai; server-authoritative auto-submit/negative marking verify karna |
| Analytics (weak-topic, percentile) | ⚠️ | performance/chapter/drill routes; deep analytics nahi |
| Admin dashboard (revenue, subs, device history) | ⚠️ | admin page 333 ln; **revenue/subscription UI nahi** |
| Blog CMS | ❌ | — |
| Support tickets | ❌ | — |
| Notifications | ❌ | **Notification model nahi** |
| ErrorReport (Report Error) | ❌ | **ErrorReport/QuestionErrorReport model nahi** — v5 §37.4 ka core |
| AuditLog | ✅ | model + audit-log module |
| Realtime Socket.io (force-logout, live leaderboard) | ❌ | **kahin nahi** |
| PWA | ❌ | — |
| Flutter mobile app | ❌ | Phase 8 |
| Security: rate-limit, Helmet, CORS, DTO validation | ⚠️ | Redis rate-limit partial (auth/otp); DTOs hain |
| Health endpoint | ✅ | /health |
| Daily DB backups, Sentry, structured logs, CI/CD | ⚠️ | Docker compose; Sentry/CI nahi |

## v2 (PDF Pipeline + Daily Practice + Scale)

| Requirement | Status | Notes |
|---|---|---|
| Chunked resumable import (ImportBatch/ImportChunk) | ✅ | 39,526 Qs real import se |
| "Never skip a page" — every chunk SUCCESS/SKIPPED | ⚠️ | mech hai, admin-visible progress UI partial |
| Duplicate detection Stage 1 hash + Stage 2 embedding | ⚠️ | searchHash hai; **text-hash dedup galat nikla** (QID-based chahiye) |
| QuestionVersion (never overwrite) | ✅ | model hai; edit-time versioning check karna |
| ImportBatch rollback (soft-delete isActive) | ✅ | route hai |
| Explanation policy (PDF vs AI_GENERATED tagged) | ⚠️ | questions/:id/explain route; AI_GENERATED label/approval flow partial |
| "Previous SSC references" real-data computed | ❌ | — |
| Daily Practice: 10 free/day, streaks, XP, leaderboard | ⚠️ | DailyQuiz model + quiz/today/submit; streak/XP/leaderboard nahi |
| Premium gating (EntitlementGuard, server-side) | ❌ | MockAccess/PricePack models, guard nahi |
| PgBouncer, partitioning, read replicas, k6 load test | ❌ | scale-phase items |
| Admin import dashboard (progress, dedup log, retry-chunk) | ✅ | routes hain; UI partial |

## v3 (Personalization, Bilingual Mandate, Monetization)

| Requirement | Status | Notes |
|---|---|---|
| Chapter ₹1 PDF purchase (ChapterPurchase ledger) | ❌ | **model nahi** — payments ke saath aana chahiye |
| Personalized study plan (exam→duration→quota→roadmap) | ✅ | study-plan create/get/daily-target |
| Daily quota recompute + backlog redistribution | ⚠️ | daily-target route; redistribution verify |
| Reminder alarm (web push + app local notification) | ❌ | — |
| **Bilingual mandatory: EN+HI publish gate** | ✅ | questionTextHindi + translationStatus; UI side-by-side (user ke kaha no-toggle) |
| Practice vs Live test mode | ⚠️ | quiz vs tests; live-server timer/auto-submit verify |
| Daily Test (pattern-following) vs Daily Practice | ⚠️ | DailyQuiz hai; full ExamPattern daily test nahi |
| Subject-wise standalone practice | ✅ | bank/subjects + chapters |
| PYQ first-class module (exam/year/shift) | ✅ | bank/set + chapters/:id/pyq + badges |
| Book catalog (SourceBook) + coverage gap view | ⚠️ | SourcePdf hai; SourceBook/catalog UI nahi |

## v4 (Frontend & PYQ Search Overhaul)

| Requirement | Status | Notes |
|---|---|---|
| §29 CSS/rendering bug fix | ✅ | live site styled hai |
| §30 Design system (tokens, dark/light, shadcn, motion) | ⚠️ | styled hai; design tokens/motion formal nahi |
| §31 Exam test-taking UI (palette, timer, review, fullscreen) | ⚠️ | test page partial — palette/review refs hain |
| §32 Results & analysis page (rings, rank, percentile, topper-compare) | ❌ | **nahi** |
| §33 Discovery/search UI + PYQ library | ✅ | discover page |
| §34 Hermes auto-fetch PYQ + SearchMiss + coverage dashboard | ❌ | — |

## v5 (Zero-Error Engine — user ka core promise)

| Requirement | Status | Notes |
|---|---|---|
| answerVerificationStatus first-class field + publish gate | ✅ | VERIFIED_OFFICIAL 46.7k Qs; gate partial |
| VERIFIED_COMPUTED — independent re-derivation (Quant/Reasoning) | ❌ | solver nahi |
| VERIFIED_MULTI_SOURCE | ⚠️ | field exists; pipeline nahi |
| UNVERIFIED_SINGLE_SOURCE/DISPUTED routing to review | ⚠️ | status exists; review queue routing partial |
| **QuestionErrorReport + auto soft-suspend + rewards** | ❌ | **model nahi — zero-error promise ka live loop missing** |
| QuestionVersion audit trail + "last verified on" | ✅ | lastVerifiedAt field + QuestionVersion model |
| Chapter-wise PYQ practice | ✅ | bank/chapters/:id/pyq |
| Instant admin publishing (rich editor, socket broadcast) | ⚠️ | approve/bulk-approve routes; editor UI nahi, socket nahi |
| Topic weightage & trend analytics | ❌ | — |
| Shift normalization estimator | ❌ | — |
| Error-type classification (fast-wrong vs slow-wrong) | ❌ | — |
| Cutoff trends | ❌ | — |
| Verified-answer trust badge (UI) | ⚠️ | verification-stats + questions/:id/verification API; **UI badge nahi** |
| Accuracy commitment page + admin accuracy dashboard | ❌ | — |
| Multi-exam framework | ✅ | Exam model parameterized; 11 exams |

---

## Priority (world-best promise ke hisaab se)

**P0 (zero-error loop — abhi fix):**
1. ✅ `QuestionErrorReport` model + API + UI "Report Error" button → auto soft-suspend pas threshold + admin REJECT lifts suspension (v5 §37.4, v1 ErrorReport). Full E2E 6/6: auto-suspend on 3rd report, 409 dup, 403 student-block, admin resolve.
2. ✅ Verified-answer trust badge + "SSC official answer key se match kiya" har question par (v5 §40)
3. ✅ Server-side scoring + negative marking verified (bank/attempt: scoreDelta = correct?marks:−negativeMarks)

**P1 (world-class feature gaps):**
- ✅ Admin accuracy dashboard (verification-status bars + error-report queue with resolve) — v5 §42 (admin tab "✅ Accuracy")
- ✅ Test results & analysis (rings, rank, leaderboard, negative-marking) — v4 §32 already in test page
- ⚠️ Student results history page (per-test archive) — naya: `TestAttempt` model hai, UI nahi

**P2 (monetization — payments ke bina nahi):**
- Razorpay + Subscription + Coupon + ChapterPurchase — v1 §5, v3 §1

**P3 (scale/ops):**
- Socket.io realtime, PWA, Sentry, daily backups, CI; blog CMS, support tickets, notifications; Flutter app

**P4 (deep analytics):**
- Topic weightage, cutoff trends, error-type classification, shift-normalization estimator, VERIFIED_COMPUTED solver
