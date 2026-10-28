# Handoff 17 — Help desk tickets, All-India + State rank, bookmarks, feature controller, duplicate auto-publish (28 Oct 2026)

Repo: SSC-PREP (NestJS 11, Next.js 14, Prisma 5.22/Postgres). Owner Sachin, Hinglish, Mac + Termux. Rules unchanged from handoff 14-16: start from his newest zip; deliver ONE zip + `apply-fix.sh` (md5 BASE CHECK table `path|baseMd5|newMd5`, phases check -> apply -> verify, STOP on mismatch, handle deletions, Mac + Termux blocks, re-run safe); never ask him to run prisma/build/tsc/jest; state exactly what was/wasn't run; end with HANDOFF-18.

## Delivered: `SESSION16-helpdesk-rank-features.zip`
See `UPDATE_HELPDESK_RANK_FEATURES_OCT2026.md`. Key facts:
- Rank: `backend/src/tests/{rank.util,rank.service,rank.controller}.ts`. One row per student = FIRST finished attempt; score desc, then faster; ties share a rank; retake = practice rank. `User.state` (list in `common/indian-states.ts` and `frontend/src/lib/states.ts` - keep both in sync). Result card = `components/RankCard.tsx`.
- `Question.paperQuestionNo` is the number printed in the real paper (shown as "Paper Q57"); `questionNo` is the global serial (error reports).
- Bookmarks: `bookmarks.service.ts` (`list` paged + facets, `ids`, `practiceSet`), client store `lib/bookmark-store.ts`, `components/BookmarkButton.tsx`. Answers of a bookmark are revealed only from FINISHED attempts / practice sets.
- Help desk: `support-chat/{support-chat.service,support-chat.controller,helpdesk-config}.ts`; student UI `components/HelpDeskPanel.tsx` (+ `SupportChatWidget`, `/help`); admin `app/admin/support-chat/page.tsx`. Settings in `app_settings` key `helpdesk.config`. Hourly auto-close job (`HELPDESK_JOBS=off`).
- Feature controller: `features/*` (`FeaturesService.assertEnabled(key)` for server-enforced flags: signup, purchases, helpDesk (new tickets), bookmarks (adding), leaderboard), client `lib/features.tsx` (`useFeatures().on(key)`, `FeatureOff`), `components/AnnouncementBar.tsx`, admin `/admin/features`. Adding a flag = one line in `features/features-config.ts` `FLAG_DEFS`.
- Auto-publish: `bank/auto-publish.{util,service,controller}.ts`, 15-min job (`AUTOPUBLISH_JOB=off`), key `autopublish.config`, DEFAULT ON / 24 h. Never force-publishes (Hindi gate kept). Question/option/answer differences always go to a human. Decisions are marked `autoResolved` + `autoReason` and shown as "🤖 Auto" with Undo.
- Migration `20261029100000_helpdesk_state_rank` (additive, IF NOT EXISTS, back-fills ticket timestamps).

## Run / NOT run
- Run: 31 unit specs (rank 8, help desk 8, feature flags 7, auto-publish 8 - pure logic), backend tsc error-diff with stubs (no new real errors), frontend type-check of changed files with stub typings, apply-fix simulated on a pristine copy.
- NOT run: real tsc, nest/next build, jest, prisma generate, migrations on Postgres, any browser/visual check, real socket chat. First real compile = GitHub Actions "Build backend image".

## Known limits / ideas
- Rank/leaderboard rows are cached 60 s / 30 s; a changed state shows after the cache expires (own state rank is computed fresh).
- Help desk has no e-mail / push notification to the student on a reply (only the live badge); no file attachments in tickets.
- `Payment.status` values shown to staff are raw ('SUCCESS' etc.).
- Legacy admin sub-pages still use old styling inside the shell. Legal text is a good-faith draft.
- Ideas: exam timing mode, section-wise analysis, performance pass (handoff 14 task 3), student reply push notification, per-state topper badges, more feature flags (mocks, sectional, year-wise).

## OPEN / ASK (one short message)
1. Did deploy go green? Test: result page -> rank card (choose state) -> bookmark a question -> `/bookmarks`; student `/help` -> ticket -> `/admin/support-chat` reply / internal note / resolve -> rate; `/admin/features` toggle + banner; duplicates page -> Auto-publish card -> Run now.
2. Auto-publish is ON with 24 h: keep it, change the hours, or switch it off?
3. Next: performance, exam timing mode, section-wise analysis, redesign remaining admin sub-pages?
