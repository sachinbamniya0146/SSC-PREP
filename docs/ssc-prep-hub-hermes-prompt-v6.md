# SSC Prep Hub — Master Prompt v4 (PYQ Pipeline, Test UI, Result Analytics & PDF QA)

**Read this together with v1 (core architecture), v2 (PDF import pipeline), v3 (personalization, bilingual mandate, alarms, monetization).** This document is additive. It does not repeat prior sections — it covers what's new this round: turning the already-imported PYQ zip into four distinct products, hardening the test-taking and result screens, and locking down PDF export accuracy.

## 0. Context for Hermes

A PYQ zip file was already handed over in an earlier session and used to build a set of mock tests. This round is not "start over" — it's: **re-derive more value from the same underlying question set**, fix anything that was cut corners on the first pass, and raise the UI to match the reference screenshots supplied (an existing SSC mock-test app used purely as a UX reference — replicate the *interaction patterns*, not any branding, copy, or visual identity from it).

## 1. Mandatory First Step — Re-Audit What Already Exists

Before adding anything new, Hermes must audit the tests already generated from the zip and produce a short report (counts, not prose) covering:

- Total questions currently in the bank, and how many came from the zip vs. other sources
- Any question appearing **more than once inside the same single test instance** (this is the bug to fix — see §4 for the rule)
- Questions missing `exam_year`, `shift_id`, or `topic` tags
- Any test where the timer duration doesn't match a real SSC shift's actual duration

Nothing gets silently corrected — every fix from this audit is logged the same way v2's duplicate/translation review queue works. Only after this report exists does Hermes move to the new work below.

## 2. Four Products From One Question Set

The same PYQ bank should power four distinct, independently-browsable products rather than only flat mock tests:

**a) Full Shift Papers.** Each real exam sitting reconstructed as its own Full Mock Test — correct question count, section composition, and **duration matching that specific shift**, not a generic template (SSC runs multiple shifts across multiple days per exam cycle, and shifts are not always identical). Tag with `exam_year`, `exam_type`, `shift_id`/`shift_date`.

**b) Master Question Bank.** Every question, deduplicated, as a filterable bank entry (by exam, subject, topic, year, difficulty) independent of which paper it originally came from.

**c) Sectional Tests.** Composed from the bank, grouped by subject/section (Quant, Reasoning, English, GA), pulling questions across multiple years.

**d) Chapter/Topic-wise Tests.** Composed from the bank, grouped by fine-grained topic (e.g. inside Quant: Arithmetic, Algebra, Geometry, Data Interpretation, etc.). This requires **topic-level tagging at ingest**, not just subject-level — every question needs both, since topic tags also drive the weak-area breakdown on the result screen (§6).

## 3. Year & Topic Labeling — Always Visible

Every question carries its source `exam_year` (and `shift_id` where applicable) and `topic` as first-class fields, not buried metadata. Surface both:

- During the test, in the question header/sidebar
- **Again on the post-submission review screen**, per question (§6) — this is new; don't only show it live and drop it after submit.

## 4. The Duplicate Rule (this is the part to get exactly right)

- **Within one test instance** (one Full Shift Paper, one Sectional Test, one Chapter Test) — the same question must never appear twice. Enforce this at composition time: when building a test, select distinct canonical question IDs only; if the same underlying question was imported from two source PDFs/zips, it must resolve to one canonical ID before composition, not two near-identical rows.
- **Across different products** — the same question is *allowed* and *expected* to reappear. A question can legitimately sit in its original year's Full Paper **and** in the relevant Chapter-wise test **and** in a Sectional test. That's intentional reuse of the bank, not a bug — don't dedupe across products, only within a single composed test.
- This means composition logic needs one dedup pass per test-build (scoped to that test's candidate pool), not a global "each question can only be used once ever" rule.
- Read questions carefully during verification — near-duplicate SSC questions (same underlying problem, slightly reworded, or same numbers with a different unit) are common in PYQ sets and must be caught by the same two-stage check from v2 §7 (exact-hash, then embedding-based near-duplicate), not just literal string matching.

## 5. Test-Taking Interface — Two Modes, Both Responsive

Extends v3 §4's Practice vs Live Test split with concrete UI requirements, desktop and mobile:

**Live Test mode** (Full Shift Papers, Sectional, and Daily Test from v3 §5):
- Header: exam name + year/shift label, `Question X of N`, server-authoritative countdown, marking-scheme badge (e.g. `+2.00 / −0.50`)
- Question palette / jump-to-question grid with distinct states: answered, not answered, marked for review, not visited — visible and tappable on mobile, and used as a persistent side panel (not a collapsed drawer) on desktop where the extra width is available
- Mark for Review, Clear Answer, Previous / Save & Next
- Submit flow requires a confirmation step showing counts (answered / not answered / marked for review / total) with a clear warning if anything is unanswered, and an explicit "keep working" escape hatch — never a single-tap accidental submit

**Practice / Topic mode** (Chapter-wise, casual Practice from v3 §5):
- Leaner single-question view, optional instant "Show Answer" and "AI Hint" affordances available immediately rather than only after submission
- AI Hint usage should be capped and the remaining count shown (e.g. a per-session or per-day quota) — needs a `hint_quota` field per user, not unlimited free-form calls to the AI backend
- Still keeps Previous/Next and a Submit action, just without the heavier live-exam chrome

**Desktop parity is not optional.** The mobile layout must not simply be centered and stretched on desktop — use the extra width for a persistent palette/sidebar, and keep the timer and submit action visible without scrolling on common desktop viewport heights.

## 6. Post-Submission Result & Analytics Screen — Enhanced

This is the screen to invest the most polish in, since it's what a user judges the platform by right after every attempt.

- **Score summary:** raw score / max, percentage, accuracy on attempted questions, and a color-coded correct/wrong/skipped bar
- **Rank & percentile card:** this needs an aggregation job, not a per-request calculation — maintain rolling stats per test (`TestAttemptStats: test_id, total_attempts, score_distribution`) recomputed on a schedule, and show the user's rank, percentile, and where toppers vs. most test-takers typically land for that specific paper
- **Instant diagnosis:** short personalized feedback text plus two sub-panels:
  - Topic breakdown, weakest-first, using the `topic` tags from §2/§3 — this is exactly why topic tagging at ingest is mandatory, not optional polish
  - Pacing analysis: average time per question, with a rushing/balanced/slow indicator, computed from per-question timestamps captured during the attempt (needs the Live Test mode to log a timestamp on every answer/navigation event, not just the final submit time)
- **Per-question review panel:** filterable tabs (All / Wrong / Skipped / Correct), each item showing its topic tag and year label (§3), time spent, the question with the correct answer highlighted, and an AI-generated explanation — reuse v2's "AI content is labeled until admin-approved" rule here too, don't treat result-screen AI explanations as exempt from that gate
- **Question navigator:** color-coded jump grid mirroring the live-test palette (correct/wrong/skipped), so review feels continuous with the test itself
- **Bilingual:** the entire result screen, including AI explanations, must respect the user's chosen language from v3 §3 — this is easy to forget since it's a "second screen," but the bilingual gate applies here just as much as during the test
- **What-to-do-next:** surface the next test in the relevant series and a shortcut to review mistakes; anything beyond that (e.g. unrelated content widgets) is out of scope unless separately requested — flag rather than silently add

## 7. Full Test PDF & Answer-Key PDF — Export + Mandatory 4-Pass QA

Two downloadable PDFs per test:

- **Test paper PDF** — bilingual, must render from the exact same canonical question data as the live test (never a separately maintained copy that can drift out of sync)
- **Answer key + solutions PDF** — correct option plus full explanation per question, also bilingual, also rendered from the same canonical data

Given the user's zero-tolerance requirement here, define the four QA passes explicitly rather than leaving "verify 4 times" vague:

1. **Automated field check** — the PDF's marked-correct option matches the database's `correct_index` for every question, no exceptions
2. **Automated structural check** — the PDF's option list for each question matches the live question's option list 1:1 in order and count (catches silent drift between what's shown live and what's printed)
3. **Human/admin spot-check** — a sampled review pass by an admin before a test's PDFs are marked publishable
4. **Pre-publish regression diff** — a final automated re-comparison against the canonical source immediately before the "publish" flag flips, so a last-minute data edit can't slip an unverified change into a PDF that already "passed" earlier

If any of the four fails, the export stays unpublished — this mirrors the review-queue pattern used everywhere else in this spec (v2's import queue, v3's translation queue). Nothing skips the queue because it's "just a PDF."

## 8. Other-Exam PYQs Found in the Same Zip

The zip also contains PYQ material for exams beyond SSC. Don't discard it and don't silently fold it into the SSC pool either.

- Catalog each non-SSC exam found (create the exam entity if it doesn't exist yet), and run it through the **same pipeline**: dedup (§4), bilingual gate (v3 §3), topic tagging (§2), and the 4-pass export QA (§7) — this content deserves the same quality bar, not a shortcut because it's outside the current focus.
- Default: keep these **cataloged but unpublished** (not visible to end users) until there's an explicit decision to launch that exam vertical — publishing a whole second exam line is a scope decision, not something to fall out of a data-cleanup pass by default.
- Report back what exams were found and roughly how much content exists for each, so that decision can actually be made with numbers in front of it.

## 9. Carry-Forward

Everything in v1–v3 stands unless explicitly amended above. This round's additions are: the four-product PYQ architecture (§2), the strict in-test-only duplicate rule (§4), the two-mode responsive test UI (§5), the enhanced result/analytics screen (§6), the 4-pass PDF QA gate (§7), and the handling plan for non-SSC content in the same zip (§8).
