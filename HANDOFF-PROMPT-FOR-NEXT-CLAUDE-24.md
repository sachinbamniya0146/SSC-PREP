# Handoff 24 - results reconciliation audit, one crowd for rank numbers, answer-key gate (28 Oct 2026)

Rules: `NEXT-CLAUDE-MASTER-PROMPT-V4.md` (Project docs). Start from Sachin's newest zip, ONE zip + `apply-fix.sh`, never ask him to run dev tools, say what was / was not run,
push in three separate blocks (commit, `git push`, `git status -sb`) and check GitHub yourself afterwards. **The next handoff number is 25** (V4 §1.6 still says 23 - ignore that).
Details of this session: `UPDATE_RESULTS_RECONCILE_OCT2026.md`. The audit with all tables: `AUDIT_RESULTS_ANALYSIS_OCT2026.md`.

## State at the start of S24 (read from GitHub, not guessed)
- S22 `cf2b21d` and S23 `df3f408` were pushed. CI was GREEN on both (Frontend + Backend: lint, tests, build) and the images built. So the red CI of S16-S21 is over.
- CI's "Run tests" runs nothing (`jest-e2e.json` + `--passWithNoTests`, both e2e specs disabled). Green CI = lint + type check + build. Unit specs run only through `scripts/audit/runspecs.cjs`.

## Delivered (S24, unverified by real CI until Sachin pushes)
- Audit of score / totals / peer numbers / answer visibility with a fake-database simulation: `scripts/audit/results-sim.cjs` (new tree ALL OK, 5 `GAP` lines; S23 tree 14 FAIL).
- One crowd for rank, percentile, topper, average, cut-off, toppers list: `tests/rank-rows.ts` used by `RankService`, `TestStatsService`, `attemptDetail`, `getComparisonWithToppers`.
  Other students are shown as "Ravi S." in the stats box; no user ids leave the server.
- Answer key: `getAttemptedQuestionIds` (bank browse / detail, review queue) no longer counts a RUNNING attempt.
- Study-plan board Chapters / Test / Weak tabs bilingual. Dead `sectionMap` block removed from the result page.

## Run / NOT run
Run: `results-sim`, `leaderboard-sim`, `plan-today-sim`, `submit-sim`, `withdrawal-sim`, pure specs via `runspecs` (no change), `tests.marking.spec` through a shim, tsc diff (stubbed types),
minilint. NOT run: eslint, jest, `next build`, real Postgres, browser / phone, the real HTTP route `GET /tests/stats/:id`.
If Actions is red look first at `tests/rank-rows.ts`, `tests/test-stats.service.ts`, `tests/tests.service.ts`, `study-plan/board/page.tsx`.

## Known limits / open GAPs (all in the audit, all printed by the sim)
1. **G1 / G1b** an expired or abandoned attempt has totals and a review for the autosaved rows only (no question list is stored for a normal mock).
2. **G2** autosave / submit accept any question id: a score can exceed the paper maximum (sim: 19 on a 10-mark paper).
3. **G3** answer key corrected after submit: stored score / `isCorrect` are not re-scored, the review shows the new key next to the old verdict.
4. **G4** `POST /tests/attempts` makes an instantly finished, rankable attempt from client answers (the practice flow still uses it; do not just block it).
5. BY DESIGN today: `GET /bank/chapters/:id/pyq`, `GET /bank/set` and the public PDF answer key reveal keys. So ranks are only as fair as the timer; no prizes before G2 / G4 are closed.
6. Rank numbers of OTHER students on the result page can be 60 s old (shared cache).
7. `AUTO_SUBMITTED` is ignored by `attemptDetail`, `myAttempts`, Telegram and the analytics (rank / stats already include it): fix together with the sweeper.
8. `tests.marking.spec` has one test that fails under the shim on the OLD tree too ("an exam without any preset keeps scoring with the question columns", 0.75 vs 1.5); real jest was not run.
9. `planPriceInr: 19` is still hard-coded (practice quota response + error message); plans are dynamic (`SubscriptionPlan`). Needs Sachin's answer which plan to quote.
10. S23 and S24 UI were never seen on a phone. Ask Sachin for a 360 px, light + dark check: dashboard premium pill, /premium table, board Aaj tab, board Chapters / Test / Weak in Hinglish, leaderboard, result page (rank + "Real stats" box).

## Next, in this order
1. Gate: look at Actions for the S24 push (`https://api.github.com/repos/sachinbamniya0146/SSC-PREP/actions/runs?per_page=6&event=push`, then `.../runs/<id>/jobs`). Red -> fix what the step says.
2. **Question list per attempt** (audit §4.1; `TestAttempt.questionSnapshot` exists, no migration): closes G1, G1b, G2 and is the prerequisite of the abandoned-attempt sweeper. Simulation first.
3. G4 (rank rows only from attempts with a server-timed start) and G3 (after Sachin decides: re-score or freeze).
4. Sweeper for abandoned timed attempts (after 2 and Sachin's answer), `AUTO_SUBMITTED` everywhere (limit 7).
5. Then the new result-screen UI. Then the other leftovers of handoff 22: question-paper view, calculator (verify which paper really has one), tab-switch count to the server, 360 px soft keyboard.
6. Withdrawals (handoff 19) known limits unchanged.

## OPEN / ASK Sachin
1. Free daily practice limit is 5 sets (env `FREE_DAILY_PRACTICE_LIMIT`). Raise it? To what?
2. Moderator on the leaderboard: hide (now) or show?
3. Abandoned timed attempts (time over, never submitted): auto-submit and count for rank? (default: yes, autosaved answers only, at least one answer)
4. Answer key corrected later: re-score old attempts (rank may change) or keep old scores and show a note?
5. Which plan should the free-limit text quote ("from Rs X")? (`planPriceInr: 19` today)
