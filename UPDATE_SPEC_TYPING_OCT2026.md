# Session 28 - spec typing fix (28 Oct 2026)

Problem: GitHub Actions "Build backend image" failed on the S27 commit. `npm run build` (nest build) compiles ALL `src/**/*.ts` including `*.spec.ts`.
`src/common/question-fingerprint.spec.ts` lines 30-31: `q('3', 'Pick', [{ imageUrl: '/o1.png' }, ...])` -> TS2353, because the helper's `options` type was inferred from its default `opt(...)` = `{ key: string; text: string }[]`.

Fix: `options: unknown[] = opt('a', 'b', 'c', 'd')`. Only the test helper changed; no runtime code, no migration.

Checked: tsc over the whole backend incl. spec files -> no error left in the new specs (only the "Cannot find name describe/it/expect" noise that the real build does not have), `question-fingerprint.spec` + `attempt-paper.spec` + `rank.util.spec` 20 pass under the shim, `results-sim` ALL OK.
NOT run: the real Docker build, eslint, jest.

Lesson: tsc comparisons must not filter out `*.spec.ts`.
