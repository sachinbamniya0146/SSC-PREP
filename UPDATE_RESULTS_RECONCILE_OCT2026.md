# Update - results reconciliation, answer gate, board in Hindi/Hinglish (28 Oct 2026, session 24)

Audit first: `AUDIT_RESULTS_ANALYSIS_OCT2026.md` (tables + 5 known gaps). Proof: `scripts/audit/results-sim.cjs`.

## 0. CI
Read from GitHub before starting: `cf2b21d` (S22 lint fix) and `df3f408` (S23) - CI green on both, Frontend and Backend (lint, tests, build), Deploy built both images.
Note: CI's "Run tests" is `jest --config test/jest-e2e.json --passWithNoTests` and both e2e specs are `.disabled`, so it runs NO test. Green CI = lint + type check + build only.

## 1. One crowd for every peer number (rank, percentile, topper, average, cut-off)
The result page used to mix four groups of people (rank card: students' first attempts; hero rank / topper: every attempt of everybody incl. admin and retakes,
rank saved once and never refreshed; cut-off / average / toppers list: every attempt of everybody). Now all of them read `tests/rank-rows.ts` (`loadRankRows`):
first finished attempt of every active student, best first, cached 60 s.
- `attemptDetail`: rank / percentile computed live from that list (no more saving `attempt.rank`), `topper` = best student score.
- `TestStatsService.getStats(templateId, viewerId)`: average, P90 cut-off, top-5 from the same list; other students as "Ravi S.", the viewer's row has `isMe`, no `userId` in the response.
  The result page uses `isMe` instead of comparing user ids. Cache key `tests:stats2:` (old cached shape is not reused).
- `getComparisonWithToppers` (no screen uses it): same list, short names.
- `RankService` only delegates its row loading (behaviour unchanged; `leaderboard-sim` still ALL OK).

## 2. Answer key and running attempts
`getAttemptedQuestionIds` in `bank.service.ts` (bank browse, question detail) and `review.service.ts` (review queue) counted the autosaved rows of an attempt that was
still RUNNING. Autosave accepts any question id, so a student could unlock the key + explanation of any question during a mock. Both now ignore `IN_PROGRESS` attempts
(bookmarks already did). Instant-feedback practice (`bank.attempt`) writes SUBMITTED attempts, so it is not affected.

## 3. Study-plan board in Hindi / Hinglish
Chapters / Test / Weak tabs: tab labels, chapter summary chips, status chips, the "mark complete" button, test card (open / countdown text, start / resume), "revise now",
"all exams", strengthen link, last-test labels and the error fallbacks now follow the language switch (`tr(en, hinglish)`). The duplicate English line under "no test scheduled" is gone.
Server messages that already come as `{en, hi}` are shown in the chosen language.

## 4. Dead code removed
`results/[attemptId]/page.tsx` had `sectionMap` / `sections` (section scores with `negativeMarks || 0.5`) that nothing read (tsc TS6133 on the old tree). Removed. The section scores students see
(`SubjectBars`, `ResultsInsights.tsx`) were already correct.

## Files (15)
Backend: `tests/rank-rows.ts` (new), `tests/rank.service.ts`, `tests/test-stats.service.ts`, `tests/tests.controller.ts`, `tests/tests.service.ts`, `tests/tests.marking.spec.ts` (its fake prisma now has `findMany`), `bank/bank.service.ts`, `review/review.service.ts`.
Frontend: `app/results/[attemptId]/page.tsx`, `app/study-plan/board/page.tsx`.
Docs / audit: `AUDIT_RESULTS_ANALYSIS_OCT2026.md`, `UPDATE_RESULTS_RECONCILE_OCT2026.md`, `HANDOFF-PROMPT-FOR-NEXT-CLAUDE-24.md`, `scripts/audit/results-sim.cjs`, `scripts/audit/README.md`. No migration.

## Verified / not verified
Run: `results-sim` (new tree ALL OK + 5 GAP lines; session-23 tree 14 FAIL), `leaderboard-sim`, `plan-today-sim`, `submit-sim`, `withdrawal-sim` (all ALL OK), the pure specs via `runspecs`
(same PASS/FAIL counts as before the change), `tests.marking.spec.ts` through a shim (the one failing test fails identically on the old tree), tsc diff backend + frontend
(no new error; 5 old backend errors and the unused `sections` gone), minilint (no change).
NOT run: eslint, jest, `next build`, prisma against a real Postgres, any page in a browser or on a phone, the real `GET /tests/stats/:id` over HTTP.
If Actions goes red look first at `tests/rank-rows.ts`, `tests/test-stats.service.ts`, `tests/tests.service.ts` (`attemptDetail`, `getComparisonWithToppers`), `study-plan/board/page.tsx`.

## Known limits
- The five GAPs of the audit are open (question list per attempt, expired-attempt totals, score above maximum, key corrected later, `POST /tests/attempts`).
- Rank / topper on the result page can be up to 60 s old for OTHER students (the viewer's own place is always live).
- Old attempts keep their stored `rank` column (now unused); nothing reads it.
