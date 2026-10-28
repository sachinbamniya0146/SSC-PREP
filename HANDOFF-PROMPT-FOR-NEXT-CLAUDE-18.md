# Handoff 18 - production-proof pass on session 16 (28 Oct 2026)

Repo: SSC-PREP (NestJS 11, Next.js 14, Prisma 5.22/Postgres). Owner Sachin, Hinglish, Termux + Mac. Rules unchanged
(`NEXT-CLAUDE-MASTER-PROMPT.md`): start from his newest zip, ONE zip + `apply-fix.sh` (md5 table, CHECK -> APPLY -> VERIFY,
STOP on mismatch), never ask him to run dev tools, say exactly what was / was not run, end with HANDOFF-19.

## Delivered: `SESSION17-production-proof.zip`
See `UPDATE_PRODUCTION_PROOF_OCT2026.md`. In short: Undo of an auto-publish decision is now respected (`autoReason='UNDONE'`
is skipped by the job), the job pages past reviews that need a person, `autoResolved` is cleared when a person decides,
announcement can be switched on without resending its text. Added `scripts/audit/` (sandbox helpers, see its README).

## Run / NOT run
- Run: 33 unit tests (4 spec files), fake-database simulation of the auto-publish job (fails on the old code, passes on the new),
  TypeScript unused-variable check of both trees, AST check of error-level lint classes, import/export resolution.
- NOT run: real eslint / jest / prisma generate / tsc / next build / migration / browser. The sandbox cannot reach npm
  (registry answers 403, "policy"), so do not waste time on `npm install` - say so and use `scripts/audit`.
  First real compile of session 16 + 17 = GitHub Actions.

## State of the code (what a 2nd full read of session 16 found)
Clean: help desk, rank, bookmarks, features, auto-publish rules, users.state, migration vs schema, socket events, API paths.
Known limits that were looked at and left alone on purpose:
- `startOrGetConversation` can create two OPEN tickets for one student if two requests race (no DB constraint; a partial
  unique index could fail the migration if old data already has two - check the data before adding one).
- Auto-publish `running` flag is per process. With two backend containers both can run; `resolve()` claims each review
  atomically, so nothing is decided twice, but both do the work.
- XP leaderboard rows still carry other students' `id`, `coins`, `streak` (only the name is shortened) - trim if privacy matters.
- Rank / leaderboard cached 60 s / 30 s; announcement closed-state is per browser.
- The mock-test screen already has: sectional timing (`section-plan`), offline submit queue (`submit-queue.ts`), drafts,
  palette states, "already submitted" treated as success. Missing from the roadmap list: tab-switch warning, `beforeunload`
  guard. So roadmap item 2 is mostly an audit + small additions, not a rebuild.

## OPEN / ASK (one short message to Sachin)
1. Did GitHub Actions go green for the session-16 commit (`dd53b87`)? If red: paste the failing job's log text.
2. Backend container started and migration `20261029100000_helpdesk_state_rank` applied?
3. What looked wrong when testing: result rank card, bookmark star + `/bookmarks`, `/help` ticket + `/admin/support-chat`, `/admin/features`, duplicates Auto-publish card?
4. Auto-publish stays ON with 24 h, or change the hours / switch off?
5. Next big area: results & analysis (roadmap 3), performance pass (5), admin quality of life (6) or retention (7)?
