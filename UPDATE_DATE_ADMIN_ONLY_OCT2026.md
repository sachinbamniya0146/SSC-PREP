# Update - exam date is admin-only, students see Year > Shift > Set (29 Oct 2026, session 36)

Sachin: "date wise sirf admin ko show ho, students ko sirf mock test year or shift wise dikhe".

## What the student sees now
`/mocks`: Year -> Shift 1 / Shift 2 / ... -> cards named `SSC CGL 2025 · Tier 1 · Shift 2 · Set 3`.
Several papers of the same exam + tier + year + shift are told apart by `Set n` (creation order, never renamed later).
The exam date is gone from: mock title + description, the `/mocks` payload, the result / review payload (`testTemplate` and every question),
bookmarks, `GET /tests` list, the question-bank browse payload (`paperCode` holds the date, so it is not sent either).

## What the admin still sees
`/admin/pyq-papers` (Date column), Date Mapping, edit-question page, exports - all read the date from the database itself.

## Existing mocks
~45 s after the new backend starts it renames every old mock ONCE (flag `pyq.mockTitles.studentSafe.v1` in app_settings). A mock the admin renamed by hand keeps its name.
Switch off: env `PYQ_RETITLE=off`. Run again: delete that app_settings row and restart.

## Files
backend: common/pyq-mock-title.ts (+spec), bank/pyq-mock-titles.ts (+spec), bank/pyq-mock-title.service.ts, bank.module.ts, pyq-paper-builder.ts (+spec), bank-upload.service.ts,
bank.service.ts, mocks.service.ts, tests.service.ts, bookmarks.service.ts. frontend: mocks/page.tsx, results/[attemptId]/page.tsx, bookmarks/page.tsx. No migration.

## Verified / not verified
Run: new specs (title 8, titles 7, builder 27), all older specs, 6 sims, shim tsc (no new errors), minilint.
NOT run: real tsc with real Prisma types (npm registry not reachable here), eslint, next build, a real database, a phone.
If Actions goes red look first at bank-upload.service.ts (rebuildKeyedPaper / upsertPyqMockForPaper) and tests.service.ts (listAvailable).
