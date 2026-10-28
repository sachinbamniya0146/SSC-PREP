# Handoff 29 - attempt lifecycle, rank, re-score, result screen, exam screen (29 Oct 2026)

Rules: `NEXT-CLAUDE-MASTER-PROMPT-V4.md` and `NEXT-CLAUDE-REMAINING-FEATURES-PROMPT` (Project docs). Start from Sachin's newest zip; small one-topic zips, each with `apply-fix.sh` (CHECK -> APPLY -> VERIFY), say what was / was NOT run, never ask him to run dev tools, push in three separate blocks (commit, `git push`, `git status -sb`), check GitHub Actions yourself afterwards. Spec files are compiled by the Docker build: type-check them too. **The next handoff number is 30.**
Details of this round: `UPDATE_RESULTS_LIFECYCLE_OCT2026.md` (read first), `AUDIT_RESULTS_ANALYSIS_OCT2026.md` (G1 - G4 table), `AUDIT_EXAM_SCREEN_OCT2026.md`, `PHONE_CHECK_CHECKLIST_OCT2026.md`.

## What S29 - S34 delivered (six zips)
- S29 CGL page stores its question list (`startAttempt(..., { sectionalFamily })`), abandoned-attempt sweeper (`AttemptSweeperService`, grace 6 h 10 min, `AUTO_SUBMITTED` counted everywhere, no XP / PDF for it).
- S30 rank rows only from attempts with `expiresAt` (practice attempts never rank). S31 admin re-score after an answer-key fix (+ audit log, migration `20261029120000_attempt_rescore`).
- S32 result page: notices + section-wise table. S33 exam page: question-paper view, tab-switch count on the server (migration `20261029130000_attempt_tab_switches`), no calculator (decision, see audit).
- S34 `PLAN_PRICE_INR`, shim fixes, docs.

## Decisions (28 Oct 2026)
Moderator hidden; abandoned attempts with >= 1 autosaved answer are auto-submitted and rank; key corrections = admin re-score + audit log; free limit stays 5 and the plan price is env-driven (his answer "4" was ambiguous: ask again if it matters).

## Run / NOT run
Run: all `scripts/audit` sims, the service-level and pure specs through the shim, tsc incl. spec files vs base (0 new errors), minilint. NOT run: eslint, jest, `next build`, prisma generate / migrate, Postgres, any browser or phone.
If Actions is red, look first at: `tests/tests.service.ts` (`finishAttempt`, `autoSubmitAttempt`, `recordTabSwitches`, `rescoreAttempt`, `startAttempt`, `sectional*`), `tests/attempt-sweeper.service.ts`, `tests/attempt-rescore.*`, the two migrations (a `prisma generate` problem would show as "Property tabSwitches / rescoredAt does not exist"), `test/page.tsx`, `cgl-test/page.tsx`, `results/[attemptId]/page.tsx`.

## Known limits / open
1. Attempts without a stored question list (older ones) keep the old G1 / G2 behaviour. 2. BY DESIGN rows of the audit (bank PYQ browse, public PDF answer key) still reveal keys: no prizes before they are decided.
3. Finished attempts without `expiresAt` no longer count for rank: Sachin can count them with the SQL in the UPDATE doc. 4. `EXPIRED` is never written; an abandoned attempt with no answer stays `IN_PROGRESS`.
5. Nothing from S23 - S34 UI has been seen on a phone: `PHONE_CHECK_CHECKLIST_OCT2026.md`. 6. The sweeper's first real run is 3 min after the next backend boot; look at the backend log line "attempt sweeper: looked N ...".
7. No staff screen shows `tabSwitches` yet (the field is in the review response). 8. CI "Run tests" still runs nothing; adding a real jest step (`npm run test:unit` style) would change CI: tell Sachin first, make it non-blocking for the deploy job.

## Next, in this order
0. Gate: Actions for the pushed zips (`https://api.github.com/repos/sachinbamniya0146/SSC-PREP/actions/runs?per_page=6&branch=main`, then `.../runs/<id>/jobs`; WebFetch caches 15 min: add a changing query parameter). CI and Deploy of each zip.
1. Sachin's phone screenshots (checklist) -> fix. 2. Optional CI jest step (ask first). 3. Staff view of tab switches / sweeper log if he wants it.
4. Separate task, do not mix: PYQ Excel / Questions Import work from the Project instructions.
