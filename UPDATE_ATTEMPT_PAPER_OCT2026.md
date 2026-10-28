# Update - the attempt remembers its paper (28 Oct 2026, session 25)

Closes GAP G1, G1b and G2 of `AUDIT_RESULTS_ANALYSIS_OCT2026.md` for the auto-built PYQ papers and the year-wise tests. Proof: `scripts/audit/results-sim.cjs`. No migration
(`TestAttempt.questionSnapshot Json?` was already in the schema; it was only used by daily / study-plan tests).

## 0. CI of session 24
`2d24ff6` (S24): CI success (Frontend + Backend: lint, tests, build). Read from GitHub after Sachin's push.

## 1. What changed
- `tests/attempt-paper.ts` (new): `paperQuestionIds()` (flatten a composed paper), `readPaperSnapshot()` (read the stored list, null when there is none), `hasCanonicalPaper()` (which templates get a list).
- `startAttempt(userId, templateId, { scribe?, questionIds? })`: a NEW attempt stores the question ids of its paper in `questionSnapshot`:
  - given by the caller: `yearWiseStart` passes the exact questions it composed;
  - `SHIFT_WISE` templates with an id `pyq-...` / `pyq-k-...`: the list of `paper()` (the same call the test page makes);
  - every other template: no list (their questions come from other composers - generic full mock, `cglExam()`, sectional pages - and a guessed list could reject real answers).
  If the paper cannot be composed the attempt still starts, without a list. A resume (`resumed: true`) returns the old attempt untouched.
- `saveAnswers` (autosave): with a stored list, answers for ids outside it are not stored (counted in `rejected`).
- `submitAttempt`: with a stored list only its questions are scored (a foreign id in the payload or in old rows is ignored); `totalSkipped` also counts every question the student never touched,
  so right + wrong + skipped = question count even for an expired / abandoned attempt; a skipped row (no answer, not correct) is written for each of them, so the review lists the whole paper.
  A question that was deleted from the bank after the start is left out (its row could not be written: foreign key).
  `weakTopics.recordAnswers` still gets only the answers the student touched (unchanged).
- `yearWiseStart` passes its question ids to `startAttempt`.

## 2. What did NOT change
Attempts started before this version (no list) behave exactly as before. Score maths, ranks, the answer-key gate, the late-payload rule (an expired attempt scores the autosaved rows only) are unchanged.

## 3. Verified / not verified
Run: `results-sim` (new tree ALL OK, 4 GAP lines left; session-24 tree 11 FAIL; session-23 tree 25 FAIL), `submit-sim`, `leaderboard-sim`, `plan-today-sim`, `withdrawal-sim` (all ALL OK), the new `attempt-paper.spec.ts` (4 pass) and the other pure specs
via `runspecs`, `tests.marking.spec` through the shim (same 6 pass / 1 shim-only fail as the session-24 tree), tsc base-vs-new (no new error class; the 2 extra lines are the stubbed `PrismaService` of the sandbox), minilint (no change).
NOT run: eslint, jest, `next build`, prisma against a real Postgres, a browser or phone, `startAttempt` against a real `paper()` of a real PYQ template.
If Actions goes red look first at `tests/tests.service.ts` (`startAttempt`, `paperIdsFor`, `saveAnswers`, `submitAttempt`) and `tests/attempt-paper.ts`.

## 4. Known limits
- Open: generic full mocks, the CGL sectional page and attempts started before this version still have no list (sim prints `GAP G1` / `GAP G2` for them). Next step: hand the list from those composers to `startAttempt`.
- If an admin edits a PYQ paper (adds / removes questions) while a student's attempt runs, the attempt keeps the paper it started with; a student who reloads the page gets `paper()` of the NEW state, so a question added meanwhile cannot be answered (autosave rejects it) and a removed one scores nothing. Rare, and consistent with the stored list.
- An abandoned attempt is still `IN_PROGRESS` until somebody submits it (the sweeper is not built; it needs Sachin's answer on auto-submit and rank).
- Skipped rows now exist for untouched questions, so `deleteQuestionIds` (admin) will hide instead of delete a question that sat in a submitted PYQ paper.
