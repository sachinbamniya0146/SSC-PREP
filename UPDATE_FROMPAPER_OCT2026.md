# Update - every /test?template= mock stores its paper (28 Oct 2026, session 26)

Follow-up of `UPDATE_ATTEMPT_PAPER_OCT2026.md` (S25 stored the question list only for `pyq-...` papers and year-wise tests).

## What changed
- `POST /tests/attempts/start` accepts `fromPaper: true`. The `/test?template=<id>` page sends it, because it just loaded its questions from `GET /tests/paper/<id>`.
  `startAttempt` then stores the question ids of `paper()` for ANY template (generic full mocks, previous-year mocks ...), same as it already did for `pyq-...` papers.
- A client that does not send the flag (the CGL sectional page `cgl-test`, which gets its exam from `cglExam()`) gets no list unless the template is an auto-built PYQ paper. `cglExam()` shuffles, so its list cannot be rebuilt later.
- A student who edits the request and drops the flag gets an attempt without a list (the S24 behaviour: foreign ids score). That is the same weakness as G4 and is not closed by this change.
- Files: `tests.controller.ts`, `tests.service.ts` (`startAttempt`, `paperIdsFor`), `attempt-paper.ts` (comment), `frontend/src/app/test/page.tsx` (one key in the start body), `results-sim.cjs`, audit doc.

## Verified / not verified
Run: `results-sim` (ALL OK, 4 GAP lines), `submit-sim`, `leaderboard-sim`, `plan-today-sim`, `attempt-paper.spec`, minilint. NOT run: eslint, jest, `next build`, real Postgres, a phone, `paper()` of a real generic mock.
If Actions goes red look first at `tests.service.ts` (`paperIdsFor`) and `test/page.tsx` (start body).

## Known limits
- An attempt started by an OLD cached page (before the new frontend is loaded) sends no flag: no list for that one attempt, as before.
- `paper()` of a generic mock runs one more time at start (the page already called it once): extra load of one request per new attempt.
