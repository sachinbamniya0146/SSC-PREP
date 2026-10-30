# S48 - test reserve, smart mocks, custom tests, target exam, safe back button, notifications, phone menu (30 Oct 2026)

## 1. Half of the practice questions are kept for tests
- `Question.testReserved` (migration `20261030150000_test_reserve_and_target_exam`). floor(n / 2) of every topic (sub-topic, else topic, else chapter) is reserved, newest first; nothing is ever un-reserved, so re-running changes nothing.
- A background job (`TestReserveService`, every 10 min and 20 s after start; `TEST_RESERVE_DISABLED=1` switches it off) reserves new uploads too.
- Students NEVER see reserved questions in Practice, search, bank browse or sets (`STUDENT_PRACTICE_QUESTION_WHERE`). Practice shows only chapters / topics / sub-topics that have visible questions, with Hindi + English names and the count.

## 2. Build a test (`/build-test`)
- Smart mock for an exam: only topics that appear in that exam's PYQs, in the PYQ weightage (`test-blueprint.ts`). A GD mock never contains a topic GD never asked. Uses the exam pattern's real time, scaled to the number of questions.
- Custom test: the student picks chapters / topics and how many questions of each (max 100), and the minutes (5-300).
- Both use the reserved half first, never repeat a question, report a shortfall instead of hiding it. Server-timed attempt (`/tests/builder/start`).

## 3. Target exam
`users.targetExamId`, set in Profile ("Target exam"); Build-a-test, Smart mock and Practice start from it. Changeable any time.

## 4. Back button / pause / continue
Back inside a test no longer leaves: a dialog offers Continue, Submit, or Leave for now (the attempt keeps running on the server). `ResumeTestPrompt` (mounted in the layout) shows a front popup with Continue / Ignore for a running attempt (`/tests/attempts/active`, `/tests/attempts/:id/resume`).

## 5. Notifications (rebuilt)
Why it felt broken: reminders only worked through phone push (needs VAPID keys + the student pressing Enable, and "Not now" hid the prompt for ever); there was no inbox and no targeting.
- In-app inbox `/notifications` with unread badge in the student menu; works without phone push.
- Smart reminders every 30 min (`NudgeService`, `NUDGES_DISABLED=1` switches off): unfinished test (RESUME), save streak, weak-topic practice (every 2nd day), come-back after 3 / 6 / 9 ... idle days. Daily ones fire in the student's own reminder hour (IST). At most ONE phone push per student per run; every message is stored once per key (two containers are safe).
- Student switches: unfinished tests, streak, weak topics, admin news, reminder hour, pause 3 days.
- Admin `Call students` (`/admin/notifications`): audience = all / one target exam / stopped practising for N days / has weak topics, live count before sending, inbox + phone push. Links can only point inside the app.
- "Not now" on the phone-alert prompt now returns after 7 days.
- Tables: `user_notifications`, `notification_prefs` (migration `20261030170000_user_notifications`).

## 6. Phone menu
Phones get a "Menu" tab that opens a left drawer with the same items as the desktop left menu (feature flags respected). The bottom bar now shows on every menu page.

## Not changed on purpose
- Exam timings: `common/exam-presets.ts` already holds the official total time per exam (CGL T1 60 min, CGL T2 135, CHSL 60, and the other exams in that file) and per-section minutes where the notice fixes them. Smart mocks use them; no marks or times were changed silently.
- Refer & earn already has: per-referral commission (admin rules), hold days, "approve held earning", minimum paid friends to withdraw (global + per student), withdrawals with admin approve / reject / mark paid. Re-checked with `withdrawal-sim` (ALL OK).

## Checked in the sandbox (NOT the real build)
Specs: throttle-key, attempt-batch, test-blueprint, test-reserve, nudge-rules. Sims: batch-scoring, builder, notify, withdrawal, sidebar-boot. minilint TOTAL 0 (frontend). tsc base-vs-mod: backend 0 new errors; frontend only the "no react types in the sandbox" noise.
NOT run: jest, eslint, next build, prisma generate / migrate, Postgres, Redis, a real browser or phone. GitHub Actions is the real check.

## Env (optional)
`THROTTLE_USER_LIMIT`, `TEST_RESERVE_DISABLED=1`, `NUDGES_DISABLED=1`. Phone alerts need `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (+ `NEXT_PUBLIC_VAPID_PUBLIC_KEY` for the frontend build).
