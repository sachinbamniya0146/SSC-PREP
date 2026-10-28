# Handoff 23 - premium pill, leaderboard without staff, study plan (28 Oct 2026)

Rules: `NEXT-CLAUDE-MASTER-PROMPT-V4.md` (Project docs). Start from Sachin's newest zip, ONE zip + `apply-fix.sh`, never ask him to run dev
tools, say what was / was not run, end with HANDOFF-24 (next number **24**). Details of this session: `UPDATE_PREMIUM_LEADERBOARD_PLAN_OCT2026.md`.

## Delivered (S23, unverified by real CI until Sachin reports Actions)
- Dashboard premium card -> `PremiumStatus` pill; `/premium` has the Free vs Premium table fed by `GET /payments/benefits`
  (constants in `backend/src/common/free-limits.ts`).
- Leaderboard / dashboard rank / test toppers exclude ADMIN + MODERATOR (`common/rankable.ts`); staff viewers get no rank.
- Study plan: `todayPlan` real progress (week strip, streak, pace, subject progress), `createPlan` date + target fixes, new Aaj tab
  (`components/PlanToday.tsx`), set-up page only at `/study-plan` (`?edit=1`).
- S23 has no dependency on S19-S22 files it does not touch; if the base files differ, apply-fix.sh prints STOP and changes nothing.

## Run / NOT run
Run: `runspecs` (22 PASS), `leaderboard-sim` (new ALL OK / old tree 19 FAIL), `plan-today-sim` (ALL OK), tsc diff (stubbed react / nest
types) frontend + backend, minilint.
NOT run: eslint, jest, `next build`, real Postgres, browser / phone. If Actions is red look first at `components/PlanToday.tsx`,
`study-plan/board/page.tsx`, `study-plan-v2.service.ts` (`todayPlan`), `monetization.service.ts` (`benefits`).

## Known limits
1. `planPriceInr: 19` is hard-coded in the practice quota response and its error message; plans / prices are really dynamic
   (`SubscriptionPlan`). Not changed - needs a decision which plan the "from Rs X" text should quote.
2. Moderators are hidden from the boards too (the rule is "students only"). Say so if moderators should be listed.
3. The pace chip is an estimate (linear schedule, last ~20 % reserved for revision) - the screen says "Estimate".
4. Old stored plans may carry `dailyTarget` up to 200; `todayPlan` clamps to 25-100 at read time, the DB value is not rewritten.
5. The streak on the board counts days with at least one answered question (IST) in the last 30 days; it is separate from the XP streak.
6. Chapters / Test / Weak tabs of the board still have some English-only strings (only the Aaj tab and set-up page were made bilingual).

## OPEN / ASK
1. Did Actions go green for S16-S23? If red paste the failing job log.
2. "More free material": the free daily limit is 5 practice sets (env `FREE_DAILY_PRACTICE_LIMIT`). Raise it? To what?
3. Moderators on the leaderboard: hide (now) or show?
4. Abandoned timed attempts (from handoff 22): auto-submit and count for rank?
