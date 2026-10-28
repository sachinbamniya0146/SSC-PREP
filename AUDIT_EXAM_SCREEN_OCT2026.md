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
| **Question-paper view (all questions of the open section on one scroll)** | **added S29** | `components/ExamPaperView.tsx`, opened by the "📄 Paper" button in the top bar, default OFF. It is only another way to look at the same state: every tap goes through the same handlers as the one-question view (`paperPick` / `paperClear` / `paperMark` in `test/page.tsx`), so the strict sectional timers, the lock of closed sections, the autosave and the offline queue are untouched. 25 questions per page, language switch, clock, "Review & Submit". Not seen on a real phone yet |
| On-screen calculator | **decided: NOT added (S29)** | SSC CGL / CHSL / MTS / CPO Tier-1 papers do not provide one; the on-screen scientific calculator SSC introduced (2023) is for the SSC JE Mains paper, which this app does not have. Sources: Adda247 "Is calculator allowed in SSC CGL?" ("calculators are not allowed"); PracticeMock "SSC JE Mains 2023: on-screen scientific calculator". Add one only together with a JE paper family |
| **Tab-switch count stored on the server** | **added S29** | `TestAttempt.tabSwitches` (additive migration `20261029130000_attempt_tab_switches`, `Int DEFAULT 0`). The exam page sends the count with a small autosave call (empty answer list) and with the final submit; the server keeps the HIGHEST number it was told (a refresh or a late request never lowers it), caps it at 1000, ignores junk, and only for a running attempt. The resumed attempt returns it, the page continues counting. The result page shows it to the student as a note; there is NO penalty. `attemptDetail` carries it, so a staff screen can show it later (no staff screen reads it yet) |
| Soft keyboard open at 360 px (option buttons stay reachable) | **no text field on the exam screen; NOT checked on a phone** | `test/page.tsx` has no `<input>` / `<textarea>` (answers are buttons), so the soft keyboard cannot open while answering. The question-report dialog (`ReportQuestion`) does have a text field: on the phone check list (`PHONE_CHECK_CHECKLIST_OCT2026.md`) |

## Findings worth knowing
- The client already treated a 400 "already submitted" as success (string match in `page.tsx` and `submit-queue.ts`), so students were
  not stuck before. The server now answers 200 with the same shape plus `alreadySubmitted: true`; the client path is unchanged
  (a `res.ok` goes to the normal success branch). Do not remove the string matches yet: an old cached client may still run.
- True simultaneous submits were already safe (claim). The simulation passes that on the old code too; only the sequential retry failed.
- `AttemptStatus` has `AUTO_SUBMITTED` and `EXPIRED`, but no code writes them: an attempt past its deadline stays `IN_PROGRESS`
  until the student (or the offline queue) submits, and is then scored from the autosaved answers. Fine today, but a student who
  never comes back leaves an `IN_PROGRESS` row (and counts nothing). The sweeper was built in session 29 (Sachin: an abandoned attempt with at least one autosaved answer is auto-submitted and counts for rank, after a grace of 6 h 10 min, see `UPDATE_RESULTS_LIFECYCLE_OCT2026.md`). `EXPIRED` is still never written.
