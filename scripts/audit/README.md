# Sandbox audit helpers (not part of the build, not run by CI)

Written in session 17 because the Claude sandbox cannot reach the npm registry (403 by policy), so the real
`eslint`, `jest`, `prisma generate` and `next build` cannot run there. These helpers approximate the parts that matter.
They are an aid, NOT a replacement for the GitHub Actions run.

| File | What it does | How to run (needs `tsx` and a TypeScript install) |
|---|---|---|
| `minilint.cjs` | AST check for the error-level lint classes: `no-unused-expressions`, `prefer-const` (frontend), `rules-of-hooks` (hook after an early return / inside a condition), `ban-ts-comment`, `no-empty-object-type`, `no-require-imports` ... | `node scripts/audit/minilint.cjs backend/src backend` and `node scripts/audit/minilint.cjs frontend/src frontend` |
| `jestshim.cjs` + `runspecs.cjs` | Minimal `describe/it/expect` so the pure-logic `*.spec.ts` files run without jest | `cd backend && tsx ../scripts/audit/runspecs.cjs src/tests/rank.util.spec.ts src/support-chat/helpdesk-config.spec.ts src/features/features-config.spec.ts src/bank/auto-publish.util.spec.ts src/referral/withdrawal.util.spec.ts` |
| `withdrawal-sim.cjs` | Runs the real withdrawal code (`WithdrawalService`, `PayoutService`, `ReferralService` request / cancel) against an in-memory fake database and a fake Cashfree Payouts API: double clicks, two admins, student cancel vs admin reject, lost answers, 4xx / 5xx, status job, stats = table. `new` must print ALL OK; `old` run against the session-17 tree shows the 3 old money bugs | `cd backend && tsx ../scripts/audit/withdrawal-sim.cjs new .` (run from the backend folder of the tree you test, so tsx finds its tsconfig) |
| `autopublish-sim.cjs` | Runs the real `AutoPublishService.run()` against an in-memory fake database (paging past reviews that need a person, Undo is respected, 300 per run cap) | `tsx scripts/audit/autopublish-sim.cjs backend/src/bank/auto-publish.service.ts backend/src/bank/auto-publish.util.ts` |

Also useful: `tsc --noEmit --noUnusedLocals --noUnusedParameters` (any TypeScript 5/6) lists unused imports/variables even
when the packages are not installed - the backend lint rule `@typescript-eslint/no-unused-vars` is an ERROR in CI.
