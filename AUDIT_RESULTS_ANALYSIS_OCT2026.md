# Results & analysis audit (session 24, 28 Oct 2026, roadmap area E / "area 3"; G1 / G1b / G2 closed in session 25; G1 for the CGL page, G3, G4 and `AUTO_SUBMITTED` closed in session 29)

Question: does every number on the result screens reconcile, and can anybody see answers before the attempt is finished?
Method: read the code (`tests.service.ts`, `rank.service.ts`, `test-stats.service.ts`, `bank.service.ts`, `review.service.ts`,
`bookmarks.service.ts`, `search.service.ts`, `telegram.service.ts`, `results/[attemptId]/page.tsx`, `components/ResultsInsights.tsx`) and
run the REAL service files against an in-memory fake database: `scripts/audit/results-sim.cjs`.
Line numbers are for the tree AFTER session 24. Nothing here was seen in a real browser or on a real Postgres.

Session 27 note: the practice path (non-timed sets) used to leave skipped questions without a right option in the review; fixed, see `UPDATE_REVIEW_KEYS_DEDUPE_OCT2026.md`. The explanation gate also ignored `IN_PROGRESS` only in the bank / review services; `explanations.service.ts` has the same rule now.

Session 25 note: G1, G1b and G2 are fixed for the auto-built PYQ papers and the year-wise tests (see `UPDATE_ATTEMPT_PAPER_OCT2026.md`).

Session 29 note (see `UPDATE_RESULTS_LIFECYCLE_OCT2026.md`): the CGL sectional page now stores its question list at start (G1 / G1b / G2 closed for it); an abandoned timed attempt is scored from its autosaved answers by a sweeper (`AUTO_SUBMITTED`, counted everywhere); rank / topper / average only use attempts that had a server-timed start (G4); a corrected answer key can be applied to finished attempts by an admin re-score with an audit log (G3). Only attempts started before the list existed (no `questionSnapshot`) keep the old G1 / G2 behaviour; nothing can recreate their paper.

Legend: **exists** = already correct (proved by the sim where it says so) - **FIXED S24** = was wrong, fixed and proved - **GAP** = known weakness, NOT fixed, the sim prints it as `GAP` -
**BY DESIGN** = intended today, Sachin may want to change it - **not simulated** = read in code only.

## 1. Score and totals

| Rule | Status | Where / proof |
|---|---|---|
| Score = right x marks - wrong x negative, marks / negative from the exam preset (not the question columns); a section without negative marking (MTS Session I) subtracts 0 | exists | `submitAttempt` L366-404, `common/marking.ts`; sim section 1 (Quant +2/0, Reasoning +3/-1 => 4) |
| Score rounded to 2 decimals (1/3-mark schemes) | exists | `submitAttempt` L404 |
| right + wrong + skipped = number of questions, on a normal submit | exists, **depends on the browser**: the test page sends EVERY question of the paper (`qs.map`, `test/page.tsx` L1152), nulls for skipped | sim: 2 + 2 + 0 = 4 |
| Same totals when the attempt EXPIRED / was abandoned / the offline submit was lost (server scores the autosaved rows only) | **FIXED S25 / S26 / S29 where a list is stored; GAP G1 only for attempts started before** | S24: a normal mock stored no list of its questions, so unvisited questions were neither "skipped" nor in the review. S25: PYQ papers and year-wise tests store the list at start. S26: every template opened through `/test?template=` stores it. **S29: the CGL sectional page (`tpl-cgl-pyq-2024`) also starts through `POST /tests/attempts/start` with `sectional: "cgl"`: the server composes the exam, stores the 100 ids and a refresh returns the SAME questions** (sim: abandoned attempt totals 1 + 0 + 99). Still open: attempts started before these changes have no list and keep the old behaviour |
| Review lists every question of the paper | **FIXED S25 / S29 where a list is stored; GAP G1b otherwise** | `attemptDetail` builds the review from `AttemptAnswer` rows; submit writes a skipped row for every untouched question of the stored list. Attempts without a list: unchanged |
| Review: sum of per-question marks = stored score; right / wrong / skipped rows = stored totals; marks + negative per row | exists | sim section 1 |
| "Out of" marks = the preset's total, not the stale `TestTemplate.totalMarks` | exists | `attemptDetail` (`schemeMaxMarks`); sim 10 vs stored 16 |
| Per-question marks in the review are resolved NOW (live preset), the score was resolved at submit time | partial, **not simulated** | If an admin edits the pattern after students finished, review marks and stored score can drift. Sectional attempts are safe (frozen plan) |
| Answer key corrected after the attempt: stored `isCorrect` and score are NOT re-scored, but the review shows the NEW key next to the OLD verdict | **FIXED S29 (G3), by Sachin's decision: admin re-score + audit log** | Before a re-score the review flags the question (`keyChanged`) instead of contradicting itself. `question-edit.service.ts` answers with `keyChangedAttempts`; the admin edit page shows a banner and a "Re-score" button; `AttemptRescoreService` (`GET` preview / `POST` apply on `admin/attempt-rescore/question/:id`, batches of 200) changes only the answers whose verdict flips, keeps the first score in `scoreBeforeRescore`, writes a note and an `ATTEMPT_RESCORED` audit row, all in one transaction that only applies if the attempt is unchanged since it was read (two admins change it once), and clears the 60 s rank cache. A running attempt is never touched. Sim: all of that, plus "key put back + re-score" returns the first score |
| A score cannot exceed the paper's maximum | **FIXED S25 / S29 where a list is stored; GAP G2 otherwise** | With a stored list autosave stores / submit scores only its questions (sim: 7 ids sent, 4 stored, score 10; CGL: foreign ids rejected, score capped at 200). Without a stored list the old behaviour remains |
| A client cannot create a finished, ranked attempt without a server-timed start | **FIXED S29 (G4)** | `POST /tests/attempts` (`saveAttempt`) still saves the attempt (history, review, weak-topic stats work as before), but `rank-rows.ts` now only reads attempts with `expiresAt` set, so practice attempts never rank, never move the topper / average / cut-off, and the rank card says "practice" (`AttemptRank.practice`). Sim: full marks in 0 s is saved but not ranked; nobody else is pushed down; the same student's timed attempt ranks. **Effect on old data:** finished attempts that never had a server-timed start stop counting for ranks; see `UPDATE_RESULTS_LIFECYCLE_OCT2026.md` for the SQL that counts them |
| Section-wise numbers on the result page | exists | `SubjectBars` / `SectionTimeCard` in `ResultsInsights.tsx` use `negativeMarks \|\| 0` (correct). The page also had a second, WRONG copy (`negativeMarks \|\| 0.5`) in `sectionMap` / `sections` that nothing read (tsc: "'sections' is declared but its value is never read"): **removed S24**, no visible change |
| `myAttempts`, analytics routes, `attemptDetail`, Telegram, study-plan and weak-topic code now accept `AUTO_SUBMITTED` | **FIXED S29** | one helper: `common/attempt-status.ts` (`ATTEMPT_DONE`, `isAttemptDone`). XP and the Telegram PDF are only given for a manual submit |

## 2. Peer numbers on the result page (rank, percentile, topper, average, cut-off, toppers list)

Before: four different crowds on one screen.

| Number | Crowd before | Crowd now |
|---|---|---|
| Rank card (All-India / State) | first finished attempt of every active student | same (unchanged) |
| Hero rank + percentile (`attemptDetail`) | every SUBMITTED attempt of everybody (admin, moderator, retakes), saved on first view and never refreshed (`attempt.rank`) | **FIXED S24**: the rank card's list. Sim: was rank 5 / 20 %, card said 2 / 50 % |
| "Topper" bar (`attemptDetail.topper`) | max over every attempt, so an admin's 10 / 10 was the topper | **FIXED S24**: best student's first attempt (5) |
| Average, cut-off P90, "Real stats" toppers (`/tests/stats/:id`) | every attempt of everybody; full names and user ids of the top 5 sent to every student | **FIXED S24**: same list; other students "Ravi S.", only the viewer sees their own name (`isMe`), no user id in the response |
| `/tests/analytics/comparison/:id` (no screen uses it) | all attempts, full names | **FIXED S24**: same list, short names |

One list = `backend/src/tests/rank-rows.ts` (`loadRankRows`, 60 s cache per test). `RankService`, `TestStatsService`, `attemptDetail`
and `getComparisonWithToppers` all call it. A fresh submit is added to the viewer's own place immediately (the viewer is never read from the cache).
The Telegram result PDF prints `detail.rank`, so it now agrees with the screen too.
Side note: `TestAttemptStats` is still written by `getStats` but nothing reads it.

## 3. Can anybody see answers before the attempt is finished?

| Surface | Status | Where / proof |
|---|---|---|
| Review / `attemptDetail` of a running attempt | exists (refused) | guard in `attemptDetail`; sim |
| Submit response, `attemptRemaining`, resume | exists | they return the student's own picks and `isCorrect` only after submit; no key |
| Paper delivery (`paper`, `sectional`, `yearWiseStart`, daily test, study-plan test) | exists, read in code | `correctAnswer` is only read at L373 / L611 / L709 (scoring) and L911 (`attemptDetail`) in `tests.service.ts` |
| Result rank, toppers | exists | `RankService.forAttempt` refuses unfinished attempts |
| Bookmarks (`latestAnswers`) | exists | skips `IN_PROGRESS` (`bookmarks.service.ts` L284) |
| Search (public Meilisearch hits) | exists | key + explanations stripped (`search.service.ts` L217) |
| **Bank browse / question detail / review queue "attempted" gate** | **FIXED S24** | `getAttemptedQuestionIds` (`bank.service.ts` L86, `review.service.ts` L68) counted `AttemptAnswer` rows of a RUNNING attempt. Autosave accepts any question id, so a student could unlock the key of every question during a timed mock. Now `status != IN_PROGRESS`; sim: base unlocked q1, q2, q5, new unlocks none until the attempt is submitted |
| Chapter-wise PYQ practice (`GET /bank/chapters/:id/pyq`) and `GET /bank/set` | **BY DESIGN**, decision | return `correctAnswer` + explanation up front on purpose (the "Show answer" self-check, comment at `bank.controller.ts` L365). The same questions can sit in a running mock |
| Public PDF "paper" / "answerkey" of a published mock (`pdf-export.controller.ts` L58-L72) | **BY DESIGN**, decision | anybody can download the key of a published template |

Consequence for Sachin: until the two BY DESIGN rows change, the answer key of any PYQ question can be read by a logged-in student during a mock,
so a "rank" is only as fair as the honour system plus the timer. That is normal for PYQ-based mocks (the real keys are public anyway), but do not promise "cheat-proof" ranks
and do not attach prizes to a leaderboard before these two BY DESIGN rows are decided (G2 and G4 themselves are closed for new attempts since S29).

## 4. What was built after this audit (done) and what is still open

1. Question list per attempt - DONE: S25 (PYQ papers, year-wise), S26 (every template of `/test?template=`), S29 (CGL sectional page; sectional practice pages are not timed attempts).
2. Abandoned timed attempts - DONE in S29: `AttemptSweeperService` (details in `UPDATE_RESULTS_LIFECYCLE_OCT2026.md`).
3. G4 - DONE in S29. G3 - DONE in S29 (admin re-score).
4. New result-screen top part (notices, section-wise table with tap-to-filter) - DONE in S29.
5. Still open: attempts without a stored list (older ones); the two BY DESIGN rows of section 3; the sectional practice pages (`sectional()`) are practice, not exam attempts. Do not attach prizes to a leaderboard before the BY DESIGN rows are decided.

## 5. Run it

`cd backend && tsx ../scripts/audit/results-sim.cjs .` - session-29 tree: ALL OK and "no open gaps" (session-25 tree: ALL OK + 4 GAP lines; session-28 tree: the new session-29 checks FAIL). Against the session-24 tree: 11 FAIL (the new session-25 checks). Against the session-23 tree: 25 FAIL (session-24 + session-25 checks) (hero rank 5 vs 2, topper 10 vs 5, stats / comparison with the admin
and retakes, key unlocked from a running attempt).
