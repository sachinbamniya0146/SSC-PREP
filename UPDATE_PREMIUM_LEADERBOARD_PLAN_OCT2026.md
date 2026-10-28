# Update - Premium card, leaderboard, study plan (28 Oct 2026, session 23)

## 1. Premium: small status pill + honest Free vs Premium table
- The big "Premium active" card on the dashboard is gone. `components/PremiumStatus.tsx` is a ~32 px pill in the hero actions row:
  `Free - See what Premium adds`, `Premium - N days left` (shows "Renew" in the last 7 days) or `Admin - full access`.
  The old card said "Plan" for the admin because an admin has no subscription row (an admin is always premium).
- `/premium` has a calm free-plan banner and `components/PlanCompare.tsx` (id `compare`) - a Free vs Premium table.
  Every number comes from `GET /payments/benefits` (new, logged-in, cached 5 min), which reads the SAME constants the server enforces
  (`backend/src/common/free-limits.ts`): free practice sets/day, 25 questions per set, 100 bookmarks, 2 tries per premium mock,
  chapter PDF price. bookmarks / auth / mocks / bank-practice / monetization now import those constants instead of repeating them.
- Free for everyone: all PYQ mocks, result analysis and rank, weak-topic practice and revision, study planner, daily test, leaderboard.
  Premium adds: unlimited practice sets, unlimited bookmarks, all chapter PDFs, unlimited tries on premium mocks, Telegram bot.
- The "5 sets" free limit is still `FREE_DAILY_PRACTICE_LIMIT` (env). Raising it is a one-line env change, no code.

## 2. Leaderboard shows no staff
- `common/rankable.ts` (`RANKABLE_USER = { isSuspended: false, role: 'STUDENT' }`) is used by the XP leaderboard, the dashboard rank
  and the per-test toppers / result rank. Admin and moderator accounts are never listed, never counted in a student's rank, and
  get no rank themselves ("staff" note on the page, rank card hidden). Their practice attempts do not push a student down.
- XP-board cache key is now `lb3` (old cached boards that contained the admin are not reused).

## 3. Study plan
- `GET /study-plan/today` now returns real progress: `answeredToday`, `chaptersDoneToday`, `streakDays`, a 7-day `week` strip with
  goal met per day, `goalDaysThisWeek`, `pace` (AHEAD / ON_TRACK / BEHIND / JUST_STARTED, an estimate from chapters covered vs the
  linear schedule that keeps the last ~20 % for revision) and `subjectProgress`. Pure helpers in `study-plan/study-plan-pace.util.ts`.
- `createPlan` bugs fixed: start date was saved as yesterday (IST midnight stored as UTC), "today" passed as a future target date,
  invalid dates were accepted. Now strict `YYYY-MM-DD`, a real calendar day after today and at most 3 years away; daily target
  25-100 in steps of 5 (was 5-200, 200 a day is not doable and exceeds a free student's 5 x 25).
- Board "Aaj" tab (`components/PlanToday.tsx`): days left, exam date with Change link, syllabus bar, pace chip, streak, a 3-item
  checklist (practice / revision / chapters) with real counts, 7-day chart (`role="img"` + text label), chapters for today,
  subject progress. Skeleton while loading, error + retry, the 1-second clock runs only on the 9 AM Test tab, tabs are 44 px.
- `/study-plan` is now the set-up page only: a student with a plan goes straight to the board; "Plan settings" / "Change" open it with
  `?edit=1` (prefilled, errors inline instead of `alert()`, chapter progress is kept).

## Files
Backend: common/free-limits.ts (+spec), common/rankable.ts, gamification.service, tests/rank.service, monetization (service +
controller), bookmarks / auth / mocks / bank-practice services (constants), study-plan.service, study-plan-v2.service,
study-plan-pace.util.ts (+spec). Frontend: PremiumStatus, PlanCompare, PlanToday, RankCard, dashboard, premium, leaderboard,
question-bank-practice, weak-practice, study-plan, study-plan/board. Audit: scripts/audit/leaderboard-sim.cjs, plan-today-sim.cjs.
No migration.

## Verified / not verified
Run: 22 pure specs, leaderboard-sim (new tree ALL OK; session-22 tree fails 19 checks), plan-today-sim (ALL OK), tsc diff
frontend + backend (no new errors; react / nest types stubbed), minilint (no new findings).
NOT run: eslint, jest, `next build`, prisma against a real Postgres, any page in a browser / on a phone. First real compile = GitHub Actions.
