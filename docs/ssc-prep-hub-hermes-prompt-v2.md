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
