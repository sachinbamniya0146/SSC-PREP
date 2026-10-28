# UPDATE — Help desk tickets, All-India + State rank, Bookmarks, Feature controller, Auto-publish duplicates (28 Oct 2026)

Base: SESSION15 (Refer & Earn v2, admin console). Delivered as `SESSION16-helpdesk-rank-features.zip` + `apply-fix.sh`.

## 1. Rank: All-India + State (result page)
- New card on `/results/[attemptId]`: **All-India rank**, **State rank**, percentile, "Top x%", and the **toppers of this test** (India / My state tabs).
- Rule (server, `backend/src/tests/rank.util.ts`): only each student's **first finished attempt** counts. Higher score first; same score -> faster time first; equal score and time **share a rank**. A **retake** is shown as *practice rank* and never changes anybody's real rank (it also shows where the first attempt stands today).
- Suspended students are excluded everywhere (also from the XP leaderboard).
- The student chooses a **state** in Profile (or one tap on the result / leaderboard page). New column `users.state`; `PUT /users/me/profile {state}` ("" clears it); only the 36 listed states/UTs are accepted.
- Other students' names are shown shortened ("Rahul S."), yours in full.
- XP leaderboard (`/leaderboard`): **All India / My state** tabs; first-name-only masking.
- Endpoints: `GET /tests/attempts/:attemptId/rank`, `GET /tests/rank/leaderboard/:templateId?scope=state`, `GET /gamification/leaderboard?scope=state`.

## 2. Real paper question number
- Questions of a keyed PYQ paper now show **"Paper Q57"** (the number printed in the real exam paper) in the test screen, in the review and in Bookmarks. The global `Q#` serial (used when reporting an error) stays.
- The review list is sorted by the paper number when every question has one, and the old bug where the review printed the position of the *filtered* list as the question number is fixed.

## 3. Bookmarks (students can revise after the test)
- ★ on every question: **test screen**, **result review** (plus a "★ bookmarked" filter) and the question bank. Optimistic tap, rolled back with a message if the server refuses.
- `/bookmarks` rewritten: subject chips with counts, search (text / chapter / topic / question no.), "Wrong in my last test" filter, paging (the old 100-item cap is gone), your own last answer vs the correct one, link to that result, notes, **practice this subject**.
- Safety: the answer and solution of a bookmark are revealed **only after a finished test / practice set** that contained it - an attempt still running can never leak them.

## 4. Help desk (tickets)
- Student: floating button -> **Help desk** panel: searchable FAQ, one-tap ticket with a category and the page the student was on, live chat (socket + 15 s polling fallback), my tickets, **rating after resolve**, **reopen** (just write again within the reopen window). Full page: `/help`. The button is hidden on the live test screen.
- Admin `/admin/support-chat` (menu: **Help desk**): inbox with filters (status, category, priority, mine/unassigned, late, unread, search by name / email / #ticket), **longest-waiting first** with a reply-target flag (ok / due / late), stats strip (open, waiting, late, unassigned, solved 24 h, avg first reply, rating), **saved replies**, **internal notes** (never shown to the student, never on the live channel), **student 360** (plan, last payments, tests taken, state, where the student was), assign ("Take it"), priority / category, resolve / reopen. ADMIN edits settings: reply target, auto-close days, reopen days, saved replies.
- Rules: one open ticket per student; flood guard 8 messages/minute; a ticket where we replied and the student stayed silent is **auto-closed** (default 7 days, hourly job, `HELPDESK_JOBS=off` disables).
- Schema: ticketNo (short number the student quotes), category, priority, contextJson, firstResponseAt, resolvedAt, lastStudent/StaffMessageAt, rating, ratingNote, `support_messages.isInternal`. Old conversations are back-filled by the migration.

## 5. Feature controller (`/admin/features`, ADMIN only)
- On/off switches: New registrations, Buying plans (both **enforced by the server**), Help desk (new tickets, enforced), Bookmarks (adding, enforced), Leaderboard (enforced), Refer & Earn, State rank, Vocabulary, Study plan, Daily goal bar, Purchase celebration (these hide the screens/menus).
- **Announcement banner** (info / notice / important), optional link and automatic expiry; shown on all pages except the live test; a student can close it, a changed text shows again.
- Stored in `app_settings` (`features.config`), every change goes to the audit log (`FEATURES_CHANGED`). Public `GET /features` (cached 15 s on the server, the app re-reads every 2 min). Until it answers, every feature is treated as ON.

## 6. Duplicates: auto-publish after 24 h
- Card at the top of `/admin/questions/duplicates`. A duplicate nobody answered for **N hours (default 24)** is decided by safe rules, every 15 minutes (`AUTOPUBLISH_JOB=off` disables; max 300 per run):
  - same question in a **different paper** (shift / date / tier / year) -> **keep both**;
  - **identical** copy -> keep the existing one (students' bookmarks and history stay);
  - old copy not live -> publish the new one;
  - optional (off by default): "similar" copies whose only differences are solution / picture / paper question number -> keep the newer paper's copy;
  - **anything where the question text, options or answer differ -> a person decides, always.**
- It never force-publishes: a question still needs its Hindi version like before. Every automatic decision is marked **🤖 Auto** with the reason and can be undone from the Resolved tab. Settings, preview ("N ready now, M need you"), **Run now** and the last 20 runs are on the card.
- **It is ON by default with 24 h.** Switch it off on the card if you want to keep deciding everything yourself.

## Performance / polish
- Skeleton loaders instead of bare "Loading…" on rank, bookmarks, leaderboard, help desk; one shared poller for the feature flags; bookmark ids loaded once per tab.
- Mobile: floating help button sits above the bottom tab bar; announcement and help panels fit narrow screens.

## Deploy
- New migration (re-run safe, additive only): `20261029100000_helpdesk_state_rank` - runs automatically at container start (`prisma migrate deploy`).
- Optional env: `HELPDESK_JOBS=off`, `AUTOPUBLISH_JOB=off`.
- Push to `main` => GitHub Actions deploys. Manual: `cd /opt/ssc-prep-hub && ./deploy.sh`.

## What was / was not run
- Run: 31 unit specs for the new pure logic (rank, help desk rules, feature flags, auto-publish rules) with a small runner; backend `tsc` error-diff against the base (only the 2 stub-only `unref` messages the base already has for the same pattern); frontend type-check of every changed/new file with stub typings for react/next (no real errors in the new code); apply-fix.sh simulated on a pristine copy of the base.
- NOT run: real `tsc`, `nest build`, `next build`, jest, `prisma generate`, the migration on Postgres, the pages in a browser (no visual check, no real socket test). First real compile = GitHub Actions "Build backend image".
