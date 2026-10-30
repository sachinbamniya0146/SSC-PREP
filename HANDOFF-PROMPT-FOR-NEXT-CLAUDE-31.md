# Handoff 31 - marking fix, test reserve, build-a-test, notifications (30 Oct 2026)

Rules: `NEXT-CLAUDE-MASTER-PROMPT-V4.md` (Project docs). Same delivery protocol: zip with `apply-fix.sh`, three push blocks, say what was / was NOT run, check Actions yourself. **Next handoff number is 32.**
Read first: `UPDATE_S47_MARKING_FIX_OCT2026.md`, `UPDATE_S48_TEST_BUILDER_NOTIFY_OCT2026.md`.

## What S47 / S48 changed
Batch scoring + per-user rate limit (the "right answer shown wrong" bug); `Question.testReserved` (50% of each topic kept for tests, hidden from students); `/build-test` (smart mock by PYQ weightage, custom test); `users.targetExamId`; back-button guard + resume popup; in-app notification inbox, smart nudges, admin audience send; phone left-drawer menu.

## Open / ideas (not done)
1. Nothing from S23 - S48 UI has been seen on a phone (`PHONE_CHECK_CHECKLIST_OCT2026.md`) - start there.
2. Admin screen for the reserve split (`TestReserveService.stats()` exists, no UI yet) and a way to release a reserved question by hand.
3. Dashboard banner / quick-start buttons from the target exam; nudge text does not yet name the target exam (`targetExamName` is always null in `nudge.service.ts`).
4. Smart mock as a premium-only feature? Currently free for everyone - ask the owner.
5. Exam timings were reviewed, not changed: compare `common/exam-presets.ts` with the newest notices when an exam changes.
6. Nudges are a 30-minute `setInterval` inside the API container (same pattern as auto-publish). If the API ever runs on many containers, dedupe keys keep it safe, but a single worker would be cleaner.
