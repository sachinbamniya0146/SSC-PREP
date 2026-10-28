# Results & analysis audit (session 24, 28 Oct 2026, roadmap area E / "area 3"; G1 / G1b / G2 closed in session 25)

Question: does every number on the result screens reconcile, and can anybody see answers before the attempt is finished?
Method: read the code (`tests.service.ts`, `rank.service.ts`, `test-stats.service.ts`, `bank.service.ts`, `review.service.ts`,
`bookmarks.service.ts`, `search.service.ts`, `telegram.service.ts`, `results/[attemptId]/page.tsx`, `components/ResultsInsights.tsx`) and
run the REAL service files against an in-memory fake database: `scripts/audit/results-sim.cjs`.
Line numbers are for the tree AFTER session 24. Nothing here was seen in a real browser or on a real Postgres.

Session 25 note: G1, G1b and G2 are fixed for the auto-built PYQ papers and the year-wise tests (see `UPDATE_ATTEMPT_PAPER_OCT2026.md`); they stay open for attempts that have no stored question list.

Legend: **exists** = already correct (proved by the sim where it says so) - **FIXED S24** = was wrong, fixed and proved - **GAP** = known weakness, NOT fixed, the sim prints it as `GAP` -
**BY DESIGN** = intended today, Sachin may want to change it - **not simulated** = read in code only.

## 1. Score and totals

| Rule | Status | Where / proof |
|---|---|---|
| Score = right x marks - wrong x negative, marks / negative from the exam preset (not the question columns); a section without negative marking (MTS Session I) subtracts 0 | exists | `submitAttempt` L366-404, `common/marking.ts`; sim section 1 (Quant +2/0, Reasoning +3/-1 => 4) |
| Score rounded to 2 decimals (1/3-mark schemes) | exists | `submitAttempt` L404 |
| right + wrong + skipped = number of questions, on a normal submit | exists, **depends on the browser**: the test page sends EVERY question of the paper (`qs.map`, `test/page.tsx` L1152), nulls for skipped | sim: 2 + 2 + 0 = 4 |
| Same totals when the attempt EXPIRED / was abandoned / the offline submit was lost (server scores the autosaved rows only) | **FIXED S25 where a list is stored; GAP G1 otherwise** | S24: a normal mock stored no list of its questions, so unvisited questions were neither "skipped" nor in the review (sim: totals add up to 1 of 4). S25: PYQ papers (`pyq-...`, `pyq-k-...`) and year-wise tests store the list at start; submit counts every untouched question as skipped and writes a skipped row for it (sim: 1 + 0 + 3 = 4). S26: every template opened through the `/test?template=` page (generic full mocks too) stores the list (the page sends `fromPaper: true`). Still open: attempts started before S25 and the CGL sectional page (`tpl-cgl-pyq-2024`, `cglExam()` shuffles, so its list cannot be derived later) |
| Review lists every question of the paper | **FIXED S25 where a list is stored; GAP G1b otherwise** | `attemptDetail` still builds the review from `AttemptAnswer` rows, but submit now writes a skipped row for every untouched question of the stored list (sim: 4 rows, 3 skipped) |
| Review: sum of per-question marks = stored score; right / wrong / skipped rows = stored totals; marks + negative per row | exists | sim section 1 |
| "Out of" marks = the preset's total, not the stale `TestTemplate.totalMarks` | exists | `attemptDetail` (`schemeMaxMarks`); sim 10 vs stored 16 |
| Per-question marks in the review are resolved NOW (live preset), the score was resolved at submit time | partial, **not simulated** | If an admin edits the pattern after students finished, review marks and stored score can drift. Sectional attempts are safe (frozen plan) |
| Answer key corrected after the attempt: stored `isCorrect` and score are NOT re-scored, but the review shows the NEW key next to the OLD verdict (picked A, key now B, still "correct") | **GAP G3** | `question-edit.service.ts` L456 saves the old answer as a version and stops there; `attemptDetail` returns `correctAnswer` live and `isCorrect` stored. Needs Sachin's decision (re-score or freeze) |
| A score cannot exceed the paper's maximum | **FIXED S25 where a list is stored; GAP G2 otherwise** | S24: `saveAnswers` accepted ANY existing question id and `submitAttempt` added them all up (sim 19 marks on a 10-mark paper). S25: with a stored list autosave stores / submit scores only its questions (sim: 7 ids sent, 4 stored, score 10). Without a stored list the old behaviour remains (sim still prints 19) |
| A client cannot create a finished, ranked attempt without a server-timed start | **GAP G4** | `POST /tests/attempts` (`saveAttempt` L681) builds a SUBMITTED attempt from the client's answers at once (the practice flow of `test/page.tsx` L1362 and `cgl-test` still use it). For a mock template that row is a rankable first attempt: sim full marks in 0 s = rank #1. Do NOT block the route blindly; first make rank rows ignore attempts without `expiresAt` |
| Section-wise numbers on the result page | exists | `SubjectBars` / `SectionTimeCard` in `ResultsInsights.tsx` use `negativeMarks \|\| 0` (correct). The page also had a second, WRONG copy (`negativeMarks \|\| 0.5`) in `sectionMap` / `sections` that nothing read (tsc: "'sections' is declared but its value is never read"): **removed S24**, no visible change |
| `myAttempts`, analytics routes read `status: 'SUBMITTED'` only; `AUTO_SUBMITTED` (no code writes it yet) is ignored by `attemptDetail`, `myAttempts` and the analytics | note for the sweeper | Rank / stats already include `AUTO_SUBMITTED`. When the sweeper is built, make `attemptDetail`, `myAttempts` and Telegram accept it too |

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
and do not attach prizes to a leaderboard before G2 / G4 are closed.

## 4. What to build next (in this order, each with a simulation first)

1. **Question list per attempt - DONE in S25 (PYQ papers, year-wise tests) and S26 (every template of the `/test?template=` page)** (no migration: `TestAttempt.questionSnapshot Json?`). Still to do: the CGL sectional page (`cgl-test`, `cglExam()`) and the sectional practice pages; give them a stable composed list, then the remaining G1 / G2 gap lines turn into checks.
   It is also the prerequisite of the abandoned-attempt sweeper (it must score an attempt nobody finished).
2. **G4**: rank rows only from attempts that had a server-timed start (`expiresAt` not null); decide what `POST /tests/attempts` is still allowed to do for mock templates.
3. **G3**: Sachin decides: re-score attempts when the key is corrected (rank changes; students usually expect it), or freeze and show a note.
4. Then, and only then, the new result-screen UI (section-wise table, time per question vs topper, slowest 5, "what to do next") on top of numbers that reconcile.

## 5. Run it

`cd backend && tsx ../scripts/audit/results-sim.cjs .` - session-25 tree: ALL OK + 4 GAP lines (G1 / G2 without a list, G3, G4). Against the session-24 tree: 11 FAIL (the new session-25 checks). Against the session-23 tree: 25 FAIL (session-24 + session-25 checks) (hero rank 5 vs 2, topper 10 vs 5, stats / comparison with the admin
and retakes, key unlocked from a running attempt).
