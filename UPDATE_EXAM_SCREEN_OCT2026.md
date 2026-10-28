# Exam screen: safe submit + small CBT gaps (session 21, 28 Oct 2026)

Full audit table: `AUDIT_EXAM_SCREEN_OCT2026.md`. Needs session 19 applied first (shared `scripts/audit/README.md`).

## Backend
`TestsService.submitAttempt` (`backend/src/tests/tests.service.ts`): a submit for an attempt that is already `SUBMITTED` /
`AUTO_SUBMITTED` now returns the finished result (same shape as the first submit + `alreadySubmitted: true`, `expired` computed from
`submittedAt` vs `expiresAt`) instead of `400 Attempt already submitted`. Nothing is re-scored, no answer row is touched,
no XP / weak-topic / PDF hook runs again (they only run for the request that wins the claim). The repeat's answers are ignored.
No migration, no new field in the database.

## Frontend (`frontend/src/app/test/page.tsx`, server-timed exams only)
- `beforeunload` guard (not armed while submitting / going to results / waiting for internet).
- Soft tab-switch notice: counts leaving the tab for > 1.5 s, shows a dismissible banner for 8 s, no penalty, not sent anywhere.
- Autosave pill in the top bar: Saved / Saving / Not saved yet - retrying / Offline - kept on this device (text from `sm` up, icon on phones).
- Language switch (English / हिंदी / EN + हिं, the same remembered choice as the review screens) replaces the fixed "EN + हिंदी" badge;
  only shown when the question has Hindi; English-subject questions are never translated.

## Verified / NOT verified
Run: `scripts/audit/submit-sim.cjs` - real `TestsService` against a fake database with interleaved calls: 21 checks, ALL OK on the new code;
against the session-20 tree the "second submit does NOT throw" check FAILS (`Attempt already submitted`) as intended. tsc error-list diff
(frontend + backend): no new error, no new unused symbol (only the usual "react types missing" noise). minilint: no new finding.
NOT run: real jest / eslint / `next build`, the exam page in a browser (guard, banner, pill and language switch are untested on a real
device), a phone with the soft keyboard. If Actions is red look first at `page.tsx` (hooks added next to the other effects) and `tests.service.ts`.
