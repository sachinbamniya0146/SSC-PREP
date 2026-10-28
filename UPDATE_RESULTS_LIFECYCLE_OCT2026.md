# Sessions 29 - 34: attempt lifecycle, rank, re-score, result screen, exam screen (29 Oct 2026)

Built from `NEXT-CLAUDE-REMAINING-FEATURES-PROMPT` sections 4.1 - 4.8 on top of S28 (`321e21a`). Delivered as six small zips, in this order (each one applies on the tree the previous one leaves):

| Zip | Topic | Migration |
|---|---|---|
| `SESSION29-cgl-paper-list-and-sweeper` | 4.1 CGL page stores its question list; 4.2 abandoned-attempt sweeper, `AUTO_SUBMITTED` everywhere | none |
| `SESSION30-rank-timed-only` | 4.3 G4: only server-timed attempts rank | none |
| `SESSION31-key-rescore` | 4.4 G3: admin re-score after an answer-key fix | `20261029120000_attempt_rescore` (3 nullable columns) |
| `SESSION32-result-screen` | 4.5 result page: notices + section-wise table | none |
| `SESSION33-exam-screen` | 4.6 question-paper view, tab-switch count on the server | `20261029130000_attempt_tab_switches` (1 column, default 0) |
| `SESSION34-small-items-and-docs` | 4.8 plan price from env, shim/spec tooling, docs, handoff, phone checklist | none |

## Sachin's decisions (asked on 28 Oct 2026) and how they were used
1. Free-limit / plan price: the answer was "4", which does not say which of the two things it meant. **Interpretation: nothing changed in behaviour.** The free daily limit stays 5 (env `FREE_DAILY_PRACTICE_LIMIT`), the price quoted in the limit message comes from the new env `PLAN_PRICE_INR` (default 19, whole rupees, text only: the real charge comes from the plans table). If Sachin meant "limit 4" or "price 4", set the env value; no code change needed.
2. Moderator stays hidden on the leaderboards (unchanged).
3. Abandoned timed attempts are auto-submitted and count for rank, but only with at least one autosaved answer.
4. Answer key corrected later: admin re-score with an audit log, never automatic.

## 4.1 CGL sectional page (G1 / G1b / G2)
`cgl-test/page.tsx` now starts through `POST /tests/attempts/start` with `{ testTemplateId: "tpl-cgl-pyq-2024", sectional: "cgl" }`. The server composes the exam (`sectionalBlueprint` / `shapeSectionalExam`, the same shape as `GET /tests/sectional/cgl`), stores the 100 ids in `questionSnapshot` and returns the exam with the attempt. A refresh returns the SAME questions (`sectionalExamFromIds`), a question deleted since is left out. The page autosaves changed answers every 1.5 s (`PUT .../answers`) and submits with the real template id. If the start is refused (free limit, 400 / 403) the page shows the message; if it fails otherwise the page falls back to the old `GET /tests/sectional/cgl` (then the attempt is simply not server-timed and does not rank).
Sim: stored list of 100, resume = same questions even after the bank changed, abandoned attempt totals 1 + 0 + 99, foreign ids rejected, score capped at 200; ordinary templates unchanged.

## 4.2 Sweeper and `AUTO_SUBMITTED`
- `AttemptSweeperService` (`tests/attempt-sweeper.service.ts`): every 10 min (first run 3 min after boot) it looks at up to 50 `IN_PROGRESS` attempts whose deadline passed more than **6 h 10 min** ago (longer than the 6 h an OFFLINE student may still replay a queued submit, so the sweeper cannot take that result away) and that have at least one autosaved answer, oldest first. Each is scored from the stored answers through the same code as a manual submit (`finishAttempt(... 'auto')`): status `AUTO_SUBMITTED`, `submittedAt` = the deadline, untouched questions of the stored list = skipped. Claim by a conditional `UPDATE ... WHERE status = 'IN_PROGRESS'`: two sweepers or a late student submit never score twice.
- **No XP and no Telegram PDF** for an `AUTO_SUBMITTED` attempt (only a manual submit gives them).
- Kill-switch: env `ATTEMPT_SWEEPER=off`. Longer grace: env `ATTEMPT_SWEEP_GRACE_MIN` (never shorter than 370).
- `EXPIRED` is still never written. An abandoned attempt WITHOUT any answer stays `IN_PROGRESS` for ever and counts for nothing (nothing to score).
- `AUTO_SUBMITTED` is now treated as finished by `attemptDetail`, `myAttempts`, the analytics routes, Telegram, study-plan progress, weak topics and bank practice (`common/attempt-status.ts`).

## 4.3 G4 (rank only from server-timed attempts)
`rank-rows.ts` reads only attempts with `expiresAt` set. `POST /tests/attempts` (practice flow) still saves the attempt, but it never ranks and never moves the topper / average / cut-off; `RankCard` says "practice". **Old data:** finished attempts without `expiresAt` stop counting for ranks. Count them with
`SELECT COUNT(*) FROM test_attempts WHERE status IN ('SUBMITTED','AUTO_SUBMITTED') AND "expiresAt" IS NULL;` (and `... GROUP BY "testTemplateId"` for the templates where ranks may move). Nothing is deleted or rewritten.

## 4.4 G3 (answer key corrected later)
Editing `correctAnswer` of a question returns `keyChangedAttempts` (finished attempts with an answer for it). The admin edit page shows a banner and a "Re-score these attempts" button; the button calls `POST /admin/attempt-rescore/question/:id` repeatedly (200 attempts per call). Only the answers whose verdict flips are changed. The first score is kept in `scoreBeforeRescore`, `rescoredAt` and a note are stored, an `ATTEMPT_RESCORED` audit-log row is written per changed attempt, the rank cache is cleared. Before a re-score the review marks the question (`keyChanged`) instead of contradicting itself. Migration `20261029120000_attempt_rescore`: three nullable columns (`ADD COLUMN IF NOT EXISTS`).

## 4.5 Result screen
`components/ResultOverview.tsx`: notices (auto-submitted, score corrected with before -> after and the note, answer key changed and not re-scored yet, tab switches) and a section-wise table (right / wrong / skipped / marks / time, planned sections for sectional attempts, otherwise subjects; tapping a number filters the review below). The page keeps the existing hero, rank card, comparison, time analysis, topic analysis, filter chips, per-question review (own option, right option, explanation, topic) and the navigator. 360 px: narrower label columns for the topic bars, smaller header buttons, 12 px side padding. No new endpoint: the review response already carries the fields.

## 4.6 Exam screen
- Question-paper view (`components/ExamPaperView.tsx`, button "📄 Paper"): the questions of the open section on one scroll, 25 per page, same handlers as the one-question view. Default off.
- Tab switches: `TestAttempt.tabSwitches` (migration `20261029130000_attempt_tab_switches`), sent with the autosave and the submit, server keeps the highest value (cap 1000). Notice only, no penalty.
- Calculator: NOT added (not part of CGL / CHSL / MTS / CPO papers; only SSC JE Mains has one). See `AUDIT_EXAM_SCREEN_OCT2026.md`.
- Soft keyboard: the exam screen has no text field.

## 4.8
`planPriceInr` -> env `PLAN_PRICE_INR` (default 19). The one `tests.marking.spec` test that failed under the shim was a shim limit: `jestshim.cjs` ignored `beforeEach`, so the marking-scheme cache cleared there leaked from the CPO test into the next one. The shim now runs `beforeEach` / `afterEach`, `it.each`, `expect(...).rejects / resolves` and the `jest` fake clock; with `scripts/audit/nest-stubs.cjs` the service-level specs (`tests.marking`, `tests.entitlement`, `tests.sectional`) run too (all pass).

## Run / NOT run
Run (sandbox, per zip stage and on the final tree): `results-sim` (ALL OK, no open GAP; against the S28 tree the new checks FAIL), `submit-sim`, `leaderboard-sim`, `plan-today-sim`, `withdrawal-sim`, `autopublish-sim`, pure and service-level specs through the shim (`tests.marking` 7, `tests.entitlement` 7, `tests.sectional` 8, `attempt-sweeper` 4, `free-limits` 6, `marking` 43 ...), tsc over backend and frontend INCLUDING spec files (no new error against the base), `minilint` (backend 2 old `no-require-imports`, frontend 0).
NOT run: eslint, jest, `next build`, `prisma generate` / `migrate`, a real Postgres, a browser or phone. The CGL page, the paper view, the result page and the admin banner were type-checked but never rendered.
