# SSC Prep Hub — Master Build Prompt for Hermes AI Agent (v5 — Zero-Error PYQ Engine, Instant Admin Publishing, World-Class Feature Set)

> Supersedes nothing — this **adds Sections 36–43** on top of v1–v4. This is the accuracy-and-completeness pass: Hermes actively finds every SSC (and other government exam) PYQ with correct answers and solutions, verifies every single one so nothing is ever wrong, organizes everything chapter-wise, gives the admin instant publish power, and adds the additional features that separate a "good" prep platform from the best one in the market.

---

## 36. Hermes's Own PYQ & Answer-Key Sourcing Mandate

Hermes does not wait passively for admin uploads to build PYQ coverage — it actively researches where every exam's real papers and official answers live, and treats sourcing quality as seriously as the platform's core trust promise. Concretely:

### 36.1 What Hermes should already know about where this data lives

- **The single most authoritative source for SSC is the Commission's own site (`ssc.gov.in`, historically also `ssc.nic.in`).** SSC publishes provisional and then final answer keys **together with the question paper(s)** after each exam. This is the ground truth for correct answers — when SSC's own final answer key exists for a paper, it always wins over any third-party source.
- **Important sourcing constraint to design around:** SSC's official answer-key/question-paper download is typically **gated behind individual candidate login** (registration ID + password) and only open for a **limited time window** after results (commonly a few weeks). It is not a permanently public, freely scrapable archive. This means Hermes cannot rely on "just fetch it from the official site" as an ongoing strategy — it has to combine official-source verification (where the platform or its users can supply it during the open window, or where it's been legitimately archived/mirrored) with a robust cross-verification strategy for the rest (Section 37).
- **Reputable secondary aggregators** (established SSC coaching/prep platforms that republish papers with solutions — the same category of sites as Testbook, Adda247/Career Power, PracticeMock, GetMyUni, Prepp, and similar) commonly capture and republish papers and answer keys during or shortly after that official window, often shift-wise and bilingual, going back many years. These are useful **candidate sources**, but Hermes must never treat any single one of them as automatically correct — they are known to occasionally disagree with each other or contain transcription errors, which is exactly why Section 37's verification pipeline exists.
- **SSC papers are objective, negative-marked, bilingual, and shift-normalized** — several shifts per exam day, with SSC applying a normalization formula across shifts before computing final scores. This matters for two features specifically: (a) the answer key for a given paper is shift-specific, so ingestion must never merge two shifts' answer keys, and (b) it's the basis for the "Normalized Score Estimator" feature in Section 40.

### 36.2 Ongoing sourcing operating procedure

1. On a schedule (and on-demand via the admin's Auto-Fetch trigger from v4 §34), Hermes searches for newly released SSC exam papers/answer keys across all covered exams (CGL, CHSL, CPO, MTS, GD, JE, Stenographer, Selection Post, and the paramilitary/police exams in scope).
2. For each exam-year-shift, Hermes gathers **as many independent candidate sources as it can find** (official SSC PDF if accessible within the window, plus multiple reputable coaching-platform reproductions) rather than stopping at the first hit — multiple sources are the input to Section 37's verification, not a redundant nice-to-have.
3. Everything found is logged into the same `SourcePdf` / `ImportBatch` model as manual uploads (v2 §7, v3 §22) — auto-fetched content goes through **the exact same review gate** as an admin upload. Auto-fetching more aggressively never means publishing more loosely.
4. **This same sourcing mandate extends to "other exams"** the platform may add later (Railway/RRB, Banking/IBPS, and similar government exams) — the pattern is identical: find that exam body's own official answer-key/notification source first, then cross-verify against multiple reputable secondary sources using the same pipeline, never a bespoke one-off process per exam.
5. Hermes logs, per exam, a **sourcing coverage report**: which years/shifts have an official-source-backed answer key vs. multi-source-cross-verified-only vs. still missing — visible to the admin (extends the coverage dashboard already specified in v4 §34).

---

## 37. Zero-Error Accuracy & Verification Pipeline (Core Requirement)

This is the platform's non-negotiable promise: **not a single published question, answer, or solution should be wrong.** That's only achievable with an explicit, layered verification system — not by asking the extraction AI to "please be accurate."

### 37.1 Verification status as a first-class field

Every `Question` gets an `answerVerificationStatus`, and **only certain statuses are eligible to ever reach `PUBLISHED`**:

| Status | Meaning | Publishable? |
|---|---|---|
| `VERIFIED_OFFICIAL` | Matches SSC's (or the relevant exam body's) own final answer key | Yes, highest trust |
| `VERIFIED_MULTI_SOURCE` | At least 2–3 independent reputable sources agree on the same correct answer, no official key available | Yes |
| `VERIFIED_COMPUTED` | For deterministic subjects (Quant, Reasoning) — an independent solver/re-derivation confirms the claimed answer (Section 37.2) | Yes |
| `UNVERIFIED_SINGLE_SOURCE` | Only one source has been found so far | **No — blocked from publish, routed to review** |
| `DISPUTED` | Sources disagree with each other | **No — blocked from publish, routed to priority review with all conflicting sources shown side by side** |

This status is separate from (and sits alongside) the `reviewStatus` field from v2 §7 — a question can be `AI_DRAFT`/content-structured but still `UNVERIFIED_SINGLE_SOURCE` on the answer itself, and both gates must clear before publish.

### 37.2 Independent answer re-derivation for deterministic subjects

For Quantitative Aptitude and (where formally structured, e.g., syllogisms/coding-decoding) Reasoning questions, don't just trust extracted text — **have the system independently compute or logically re-derive the answer** from the question and options, and compare that against the claimed correct answer:

- If the independent computation agrees with the extracted/claimed answer → strong confidence signal, contributes toward `VERIFIED_COMPUTED`.
- If it disagrees → **automatic `DISPUTED`, mandatory human review**, never silently trusting either side.
- This catches both source transcription errors (a coaching site mis-typed the answer) and OCR/extraction errors (the pipeline mis-read the option letter) — two different failure modes that both slip past simple cross-source agreement checks if the same original error propagated to multiple copies.

### 37.3 Solution/explanation accuracy

- Where a real step-by-step solution exists in a source, extract it as-is (v2 §7.6) and additionally validate that the solution's final stated answer matches the question's marked correct option — a mismatch between "the explanation concludes X" and "the marked correct answer is Y" is a strong error signal, auto-flagged.
- AI-generated explanations (when no source solution exists) are, per v2 §7.6, always labeled `AI_GENERATED` until admin-approved — and for Quant/Reasoning specifically, the generated step-by-step solution should itself be run through the same independent re-derivation check in 37.2 before being shown to students.

### 37.4 Post-publish quality loop (accuracy doesn't stop at import)

- The existing **Report Error** feature (v1 §"Answer Review") feeds a `QuestionErrorReport` queue. If a question accumulates reports past a configurable threshold, it is **automatically soft-suspended** (temporarily hidden from new test assignments, but attempt history referencing it is preserved) pending priority admin re-review — this protects the zero-error promise in production, not just at ingestion time.
- Every correction creates a `QuestionVersion` (v2 §7.5) with the reason logged — this becomes the audit trail behind the trust badge in Section 42.
- Reward users (coins/XP, per the existing gamification system) for reports that turn out to be genuine, verified errors — turns the user base into an active quality-control layer rather than a passive audience for mistakes.

---

## 38. Chapter-Wise PYQ Practice (Explicit Feature)

Beyond just tagging PYQs with chapter/topic metadata (already required by v1 §5's schema), ship it as its own first-class practice mode:

- **Browse path:** Exam → Subject → Chapter → "Practice PYQs from this chapter" — surfaces *only* real past-exam questions (never AI-generated or textbook-only questions) tagged to that chapter, pooled across every year and shift the platform has ingested for that exam.
- Each chapter's PYQ pool shows a quick stat header: total PYQs available, years covered, and a topic-frequency mini-chart (ties into the weightage-trend feature in Section 40) so a student instantly sees how important that chapter has historically been for that exam.
- Chapter PYQ sets are also what the pay-per-chapter PDF export (v3 §26) generates — so that feature and this one share the same underlying chapter-scoped question pool, not two separate implementations.
- Difficulty and year filters within a chapter (e.g., "only 2023–2025 papers," "only hard-difficulty") so revision can be targeted.

---

## 39. Instant Admin Publishing (Manual Add/Edit, Live Everywhere Immediately)

This is distinct from the bulk PDF pipeline — the admin needs a fast, direct path to add or fix a single question and see it live immediately on both web and app, without waiting on any AI/import job.

- **Rich single-question editor** in the admin dashboard: bilingual question stem (Hindi + English), options, correct answer, full explanation fields (per v2 §7.6's structure — step-by-step, shortcut, common mistakes, etc.), and all metadata (exam/subject/chapter/topic/subtopic/year/shift/difficulty/tags/marks/negative marks) in one form.
- **Answer key / correction mode:** the same editor doubles as the fix-a-mistake tool — admin opens any existing question (found via search or via the Section 37.4 error-report queue), edits the correct answer/explanation directly, and publishes the correction.
- **Instant propagation, not eventual consistency:** on save, the question (or correction) is immediately:
  1. Written to the primary DB with `answerVerificationStatus = VERIFIED_OFFICIAL` (an admin's direct entry/correction is treated as the highest-trust source by definition) and `reviewStatus = APPROVED`.
  2. Search index (Meilisearch) updated synchronously or near-real-time, not on the next scheduled reindex.
  3. Relevant Redis caches (question lists for that chapter/subject/filter combination) invalidated immediately.
  4. A lightweight Socket.io event broadcast (`question:updated`) so any client currently browsing that chapter/subject refreshes without needing a manual page reload — same real-time mechanism already used for the leaderboard and force-logout events (v1 §"Realtime", v3 §18).
- **Web and app both consume this instantly** because both hit the same API and the same cache/search layer — there's no separate "app sync job" to wait for, consistent with the sync strategy already defined in v3 §18.
- Every manual add/edit still writes to `AuditLog` (v1 §"Security") and creates a `QuestionVersion` (v2 §7.5) — instant publishing doesn't mean unaudited publishing.

---

## 40. Additional World-Class Features

On top of everything already specified across v1–v4, these push the platform ahead of typical competitors:

- **Topic Weightage & Trend Analytics:** for every exam-subject, a chart showing how many questions each chapter/topic has historically contributed per year — computed from the platform's own real ingested PYQ data (never guessed), directly informing both the study-plan engine (v3 §24) and student prioritization decisions.
- **Shift Normalization Score Estimator:** since SSC normalizes scores across multiple shifts of the same exam, offer an estimated-normalized-score calculator on mock/PYQ results (clearly labeled as an estimate, per the same non-overclaiming rule as v1 §9's selection-probability feature) so a student's raw score is contextualized the way it actually will be on the real exam.
- **Error-Type Classification (richer Wrong Question Notebook):** for every incorrect answer, auto-classify the likely error type using time-spent + answer-change patterns already captured by the test engine — e.g., very fast + wrong suggests a careless mistake, very slow + wrong suggests a conceptual gap, changed-answer-then-wrong suggests second-guessing — surfaced in the Wrong Question Notebook so revision targets the actual failure mode, not just "you got this wrong."
- **Cutoff Trends:** historical category-wise cutoff data per exam/year (admin-entered or ingested from official sources) shown alongside mock/PYQ results so students can gauge their standing against a real target, not just a percentile in a vacuum.
- **Verified-Answer Trust Badge:** every question visibly shows its verification status (Section 37.1) and, for `VERIFIED_OFFICIAL` questions, a small "Matches SSC's official answer key" badge — this is a genuine differentiator most competitor platforms don't surface, and it's honest rather than a marketing claim, since it's driven directly by the `answerVerificationStatus` field.
- **"Last verified on [date]"** timestamp per question, tied to its `QuestionVersion` history — visible transparency that reinforces the zero-error promise rather than just asserting it.

---

## 41. Multi-Exam Expansion Framework

The user's ask covers "SSC or other exams" — build the sourcing (§36), verification (§37), chapter-wise practice (§38), and admin publishing (§39) systems **exam-agnostic from the start**, not SSC-hardcoded, so adding Railways/RRB, Banking/IBPS, or any other government exam later is a configuration exercise (new `Exam` row, new `ExamSyllabusWeightage`, pointing the sourcing job at that exam body's official answer-key source) rather than a rebuild. This is consistent with v1 §5's schema already being exam-parameterized — this section just makes explicit that Sections 36–40 must be built the same way.

---

## 42. Trust & Transparency Layer (Tying It Together)

The "world's best, zero wrong answers" promise only means something if it's demonstrable, not just claimed:

- Public-facing (or at least student-facing) **accuracy commitment page**: explains the verification pipeline in plain language (official-source-first, multi-source cross-checking, independent re-computation for Quant/Reasoning, community error reporting) — this is a real trust-building asset once Sections 37 and 39 actually exist to back it up.
- **Admin accuracy dashboard:** % of published questions at each verification status, trend over time, open disputed-status count, average time-to-resolve error reports — makes "zero errors" a tracked, managed metric rather than a one-time claim.

---

## 43. Roadmap Placement

- §36 (sourcing mandate) and §37 (verification pipeline) → extend **Phase 3** (PDF Ingestion) — this is the most important upgrade to that phase; do not consider Phase 3 done without the verification-status gating in place.
- §38 (chapter-wise PYQ practice) → extends **Phase 2** (Question Bank Core) once chapter/topic tagging exists, and **Phase 4** (Test Engine) for the practice-mode UI itself.
- §39 (instant admin publishing) → extends **Phase 3**, since it's a second intake path alongside the PDF pipeline, sharing the same publish/cache/sync mechanics.
- §40 (extra features) → mostly **Phase 6** (Analytics & Gamification), consistent with where similar analytics-driven features already sit in v1 §12.
- §41 (multi-exam framework) is a design constraint applied throughout, not a separate phase.
- §42 (trust layer) → **Phase 9** (Hardening & Launch), once there's real verification data to report on.
