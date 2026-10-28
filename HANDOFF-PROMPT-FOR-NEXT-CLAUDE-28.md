# Handoff 28 - CI fix for the S27 spec typing (28 Oct 2026)

Rules: `NEXT-CLAUDE-MASTER-PROMPT-V4.md` (Project docs). Start from Sachin's newest zip, ONE zip + `apply-fix.sh`, never ask him to run dev tools, say what was / was not run,
push in three separate blocks (commit, `git push`, `git status -sb`) and check GitHub yourself afterwards. **The next handoff number is 29.** Earlier handoffs: 24 - 27 (the OPEN / ASK list still stands).
Details: `UPDATE_ATTEMPT_PAPER_OCT2026.md` (S25), `UPDATE_FROMPAPER_OCT2026.md` (S26), `UPDATE_REVIEW_KEYS_DEDUPE_OCT2026.md` (S27), `UPDATE_SPEC_TYPING_OCT2026.md` (S28). Audit with all tables: `AUDIT_RESULTS_ANALYSIS_OCT2026.md`.

## What S28 fixed
S27 push (`run 40724297209`) failed in "Build backend image": `src/common/question-fingerprint.spec.ts(30-31)` TS2353 (`imageUrl` not in `{key,text}`). The Docker build runs `npm run build`, which compiles every `*.spec.ts`.
Fix: helper `q()` takes `options: unknown[]`. LESSON: my tsc diffs hid `*.spec.ts` lines. From now on type-check spec files too (only `describe/it/expect` "Cannot find name" noise is OK).

## State at the start of S26 (read from GitHub)
- S24 `2d24ff6` and S25 `3ad4271` were pushed by Sachin. CI success on both; Deploy of S24 success, Deploy of S25 was still running - look at it.
- CI's "Run tests" still runs nothing. Unit specs run only through `scripts/audit/runspecs.cjs`.

## Delivered (S25 green; S27 red until S28; S26 + S27 + S28 UI never seen on a phone)
- S27: practice-test review shows the right option of skipped questions (`POST /explanations/keys`, skipped rows saved), the explanation gate ignores running attempts, the same question is not served twice (`question-fingerprint.ts`), question ID line.
- S26: `POST /tests/attempts/start` takes `fromPaper`; the `/test?template=` page sends it, so every template it opens (generic mocks too) stores its list.
- `TestAttempt.questionSnapshot` now holds the paper's question ids for auto-built PYQ papers (`pyq-...`, `pyq-k-...`) and year-wise tests: `startAttempt` stores it (`paperIdsFor`), `saveAnswers` / `submitAttempt` use it,
  untouched questions become skipped rows, totals = question count. Closes G1 / G1b / G2 for those attempts. New `tests/attempt-paper.ts` + spec. `results-sim` extended (ALL OK, 4 GAP lines).

## Run / NOT run
Run: `results-sim`, tsc incl. spec files , `submit-sim`, `leaderboard-sim`, `plan-today-sim`, `withdrawal-sim`, `attempt-paper.spec`, other pure specs, `tests.marking.spec` via shim, tsc diff, minilint.
NOT run: eslint, jest, `next build`, real Postgres, browser / phone, `startAttempt` against a real PYQ `paper()`.
If Actions is red look first at `tests/tests.service.ts` (`startAttempt`, `paperIdsFor`, `saveAnswers`, `submitAttempt`) and `tests/attempt-paper.ts`.

## Known limits / open GAPs
1. G1 / G1b / G2 stay open for attempts WITHOUT a stored list: older attempts and the CGL sectional page (`cgl-test`, `tpl-cgl-pyq-2024`, `cglExam()` shuffles). Next: give `cglExam()` a stable list (store it at start), then turn these gap lines into checks.
2. G3 answer key corrected after submit (needs Sachin's decision: re-score or freeze). 3. G4 `POST /tests/attempts` makes an instantly finished, rankable attempt (the practice flow and `cgl-test` still use it; do not just block it).
4. BY DESIGN: bank PYQ browse, `GET /bank/set` and the public PDF answer key reveal keys. No prizes before G3 / G4 are closed.
5. Abandoned attempts stay `IN_PROGRESS` (no sweeper). `AUTO_SUBMITTED` is ignored by `attemptDetail`, `myAttempts`, Telegram and analytics (rank / stats include it): fix together with the sweeper.
6. `planPriceInr: 19` is hard-coded (needs Sachin's answer). 7. S23 + S24 UI never seen on a phone (360 px light + dark).
8. `tests.marking.spec` has one test that fails under the shim on the old tree too ("an exam without any preset keeps scoring with the question columns", 0.75 vs 1.5).

## Next, in this order
0. Sachin's screenshot report is handled by S27: ask him to look at a practice test review (skip a question, open it: option marked + "Answer: X") and at a sectional set for repeated questions.
1. Gate: Actions for the S27/S28 push (`https://api.github.com/repos/sachinbamniya0146/SSC-PREP/actions/runs?per_page=6&branch=main`, then `.../runs/<id>/jobs`). WebFetch caches 15 min - add a changing query parameter if the answer looks stale.
2. CGL sectional page list (see limit 1) - simulation first.
3. Sweeper for abandoned timed attempts (after Sachin's answer), `AUTO_SUBMITTED` everywhere. 4. G4, then G3. 5. New result-screen UI. 6. Handoff-22 leftovers: question-paper view, calculator, tab-switch count to the server, 360 px soft keyboard. 7. Withdrawals unchanged.

## OPEN / ASK Sachin (unchanged from handoff 24 unless he answered)
1. Free daily practice limit (5 today, env `FREE_DAILY_PRACTICE_LIMIT`): raise? 2. Moderator on the leaderboard: hide (now) or show? 3. Abandoned timed attempts: auto-submit and count for rank?
4. Answer key corrected later: re-score or keep the old score with a note? 5. Which plan should the free-limit text quote?
