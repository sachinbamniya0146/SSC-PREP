# CI backend lint fix (session 22, 28 Oct 2026)

GitHub Actions "CI" has been RED on the Backend job since commit 6e2685e (pricing / coupons); Frontend lint + type-check + build are green on every
run, and "Deploy to Production" kept succeeding (it builds the image without running lint), so the site was not affected - but CI proved nothing.

Cause (read from the job's annotations, not guessed): `backend/src/admin/admin.controller.ts` line 627 (`updateCoupon`)
`const { code: _code, usesCount: _uses, ...rest } = body` -> `@typescript-eslint/no-unused-vars` ERROR twice (the lint config only
ignores unused ARGUMENTS starting with `_`, not variables). The remaining 11 findings are `no-explicit-any` WARNINGS (do not fail the job).

Fix: copy the body and `delete rest.code; delete rest.usesCount;` - same behaviour (code and usesCount can never be changed from the coupon edit).

Not verified: the real eslint run (sandbox cannot run it). Backend "Run tests" and "Build TypeScript" were SKIPPED in the red runs, so they have never been seen
in CI since 6e2685e; if the next run goes red at one of them, paste that step's log text.
