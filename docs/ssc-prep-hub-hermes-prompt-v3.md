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
