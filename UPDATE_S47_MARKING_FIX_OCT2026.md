# S47 - "right answer shown wrong" fixed (30 Oct 2026)

## Cause
A practice set sent ONE request per question (`POST /bank/attempt`), up to 100 at once. The global rate limit was 60 requests / minute / IP, so most calls got HTTP 429. The page treated every failed call as "wrong". Students on shared Wi-Fi hit it even sooner.

## Fix
- `POST /bank/attempt/batch` scores the whole set in ONE request with the same marking rules as before (`attempt-batch.ts`, pure and unit-tested).
- The limit is now per STUDENT (300 / minute for a signed-in student, 60 / minute for an anonymous IP) - `common/throttle-key.ts`, `UserThrottlerGuard`. `THROTTLE_USER_LIMIT` env overrides it.
- `/test` scores in one batch with retries; a call that still fails is shown as "could not check" and never as wrong; the wrong-count is recounted from real results.
- `quiz.service.ts`: the review sends the plain answer letter, so the page compares keys correctly.
- Migration `20261030140000_normalize_correct_answer_keys`: trims / upper-cases stored answer keys ("a " -> "A"). Re-run safe.

## Checked (sandbox)
Specs `throttle-key`, `attempt-batch`; `batch-scoring-sim.cjs` ALL OK (100 answers, 429 burst, retries, no false "wrong").
