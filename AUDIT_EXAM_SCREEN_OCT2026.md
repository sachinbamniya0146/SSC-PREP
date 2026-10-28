# Exam-real mock test - audit (session 21, 28 Oct 2026, roadmap area 2)

Method: read `frontend/src/app/test/page.tsx` (2.5k lines), `lib/submit-queue.ts`, `backend/src/tests/tests.service.ts`
(`startAttempt`, `saveAnswers`, `submitAttempt`, `attemptRemaining`). Line numbers are for the tree AFTER session 21.
"Verified" = read in code (and for the server parts, run in `scripts/audit/submit-sim.cjs`). Nothing here was seen in a real browser.

| Real CBT behaviour | Status | Where |
|---|---|---|
| Instructions page before start | exists | `page.tsx` phase "instructions" ~L241, L1456 |
| Server-owned clock (client cannot extend time), skew-corrected timer | exists | `startAttempt` stamps `expiresAt`; client `skewRef` L690 / L841 |
| Strict sectional timers, section tabs, locking, per-section clock, scribe extra time | exists | `secClock` L341, `isSectionWritable` L855, tablist L2118, `scribe` L340 |
| Question palette with the 5 states + counts (not visited / not answered / answered / marked / answered+marked) | exists | `statusOf` L1051, palette drawer L385 / L2377 |
| Mark for review & next, Mark / Unmark, Clear response, Save & next | exists | `markAndNext` L1070, `clearAnswer` L1078 |
| Review-before-submit summary (answered / not answered / not visited / marked, per section, marks scheme) | exists | `reviewOpen` L2450 |
| Keyboard shortcuts + help overlay | exists | `onKey` L1008, help overlay L2421 |
| Fullscreen, zoom | exists | `toggleFullscreen` L1394 |
| Autosave of CHANGED answers only, cleared answer sent as null, retry on 5xx / 429 | exists | autosave effect (~L955-990) |
| Device draft mirror + offline submit queue + replay (even after closing the app) | exists | `saveDraft`, `queueSubmit`, `lib/submit-queue.ts` |
| Resume after refresh / relogin: same paper, answers, remaining time | exists | `startAttempt` returns the open attempt + answers (`resumed`), client hydrates L688-705 |
| Double-tap Submit guarded on the client | exists | `submittingRef` |
| Two submits at the same moment: only one scores, XP once | exists | conditional `updateMany` claim in `submitAttempt` |
| **Second (sequential) submit returns the finished result instead of 400 "Attempt already submitted"** | **was missing -> fixed (session 21)** | `submitAttempt` early return + `loadAttemptResult`; proof: `submit-sim.cjs` |
| **Warning when leaving the page by accident (back / refresh / close tab) during a timed exam** | **was missing -> added** | `beforeunload` effect ~L910 |
| **Soft tab-switch notice (count, no penalty)** | **was missing -> added** | `visibilitychange` effect, banner above the top bar |
| **Visible saved / saving / offline indicator** | **was missing -> added** | `saveState` pill in the top bar (L2069) |
| **Language switch during the exam** (the screen always showed English + Hindi stacked) | **was missing -> added** | `ReviewLangToggle` in the question header L2182, same remembered choice as the review screens; English-subject questions never get a toggle (they have no Hindi) |
| Question-paper view (all questions of a section on one scroll) | missing | not done (needs design) |
| On-screen calculator | not present | which SSC papers show one was NOT verified; do not add without checking the paper's notice |
| Tab-switch count stored on the server / shown to staff | not done | count lives on the page only (resets on refresh) |
| Soft keyboard open at 360 px (option buttons stay reachable) | NOT checked | needs a real phone |

## Findings worth knowing
- The client already treated a 400 "already submitted" as success (string match in `page.tsx` and `submit-queue.ts`), so students were
  not stuck before. The server now answers 200 with the same shape plus `alreadySubmitted: true`; the client path is unchanged
  (a `res.ok` goes to the normal success branch). Do not remove the string matches yet: an old cached client may still run.
- True simultaneous submits were already safe (claim). The simulation passes that on the old code too; only the sequential retry failed.
- `AttemptStatus` has `AUTO_SUBMITTED` and `EXPIRED`, but no code writes them: an attempt past its deadline stays `IN_PROGRESS`
  until the student (or the offline queue) submits, and is then scored from the autosaved answers. Fine today, but a student who
  never comes back leaves an `IN_PROGRESS` row (and counts nothing). A sweeper job that auto-submits expired attempts would
  give them a result and rank; not built (needs a decision: should an abandoned attempt count for rank?).
