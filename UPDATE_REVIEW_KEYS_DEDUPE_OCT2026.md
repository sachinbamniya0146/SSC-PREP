# Update - right option of skipped questions, same question twice, question ID (28 Oct 2026, session 27)

Reported by Sachin with a screenshot of the review of a practice test: the solution opened, but no option was marked right and the panel had no "Answer: X".

## 1. Why it happened
In a practice test (sectional set, chapter test, random set - anything that is not a server-timed mock) the page scored only the ANSWERED questions (`/bank/attempt`) and saved only those to the history. A question the student skipped had no result on the page
(no right option to mark) and no record on the server, so the review showed "Your answer: -", "Correct: -" and an unmarked list; the solution text itself loaded because the student had met that question before.

## 2. What changed
- `test/page.tsx` (practice path): the history save (`POST /tests/attempts`) now also sends the skipped questions (no answer; an answered question whose scoring call failed keeps its chosen option and is scored by the server). After the save the page asks
  `POST /explanations/keys` once for the right options of the questions that have no result, and marks them in the review ("Correct: ..." line, green option, "Answer: X").
- `explanations.service.ts` / `.controller.ts`: new `POST /explanations/keys` (`getAnswerKeys`): a STUDENT gets the key only of a question he has a finished attempt record for (or a bank-practice set holding it); ADMIN / MODERATOR get all; at most 200 ids; junk input gives `{}`.
  `GET /explanations/questions/:id` now also returns `correctAnswer` (same gate). `hasAttempted` ignores a still RUNNING attempt (same hole that S24 closed in the bank / review gate: autosave stores a row for any question id, so a running mock could unlock explanations).
- `SolutionPanel.tsx`: when the page does not know the right option the panel shows "Answer: X" from the server and tells the page (`onCorrectKey`) so the option is marked too.
- `tests.service.ts` `saveAttempt`: weak topics are still fed with the answered questions only (skipped rows are stored, not turned into weak topics).
- Same question served twice: new `common/question-fingerprint.ts` (stem + figure + options in any order, normalised case / spaces / full-width / trailing full stop; a row with no content is never merged). Used when a set is PICKED: `sectional()`, `BankService.getSet()`, `DailyTestService.composeIds()`
  and the generic `paper()` / `sectionalExamForFamily()` mocks (also across sections). A small bank never blocks a set: if removing copies would leave too few questions the old pool is used. Nothing stored is deleted or edited; PYQ date-wise papers keep their own text-based de-dupe (unchanged on purpose).
- Question identity: the practice review row shows `Q#<number>` (the same number as on the exam screen and in error reports); the result page line shows exam, year, exam date, shift and `ID #<number>`.

## 3. Verified / not verified
Run: `results-sim` (ALL OK; section 5 is new: skipped row saved, weak topics unchanged, keys gate incl. running attempt / other student / admin / 200 cap / junk, explanation carries the key, sectional + getSet never serve the same question twice, tiny bank still serves),
`question-fingerprint.spec` (8 pass), `submit-sim`, `leaderboard-sim`, `plan-today-sim`, `withdrawal-sim`, tsc base-vs-new backend + frontend (only the sandbox's missing-types noise changes), minilint.
NOT run: eslint, jest, `next build`, real Postgres, a phone, `paper()` / `sectionalExamForFamily()` / `composeIds()` against a real bank (changed in the same way as the simulated ones, covered by the helper spec only).
If Actions goes red look first at `explanations.service.ts`, `SolutionPanel.tsx`, `test/page.tsx` (`fetchedKeys`), `question-fingerprint.ts`, `tests.service.ts` (`uniquePool`).

## 4. Known limits
- Results of a SERVER-TIMED mock already showed the right option (from `attemptDetail`); only the practice path was affected.
- Two rows that are the same question but written differently (typo, other wording) are not seen as the same: that needs the admin duplicate tool.
- A practice test from before this version has no skipped rows: its skipped questions still show no right option (nothing to unlock).
- PYQ papers: if the same question exists twice inside ONE paper with different options/typos it is still served twice (paper de-dupe is by stem only, unchanged).
