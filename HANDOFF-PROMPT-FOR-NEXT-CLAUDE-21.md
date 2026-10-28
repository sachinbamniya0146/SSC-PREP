# Handoff 21 - area 1 finished except "Premium" (28 Oct 2026)

Rules as in `NEXT-CLAUDE-MASTER-PROMPT-V3.md` (Project docs): newest zip first, ONE zip + `apply-fix.sh`, never ask Sachin
to run dev tools, say what was / was not run, end with HANDOFF-22 (next number **22**).

## Delivered so far in this line
- Session 19 `SESSION19-student-sidebar.zip` - left menu (`UPDATE_STUDENT_SIDEBAR_OCT2026.md`, `HANDOFF-...-20.md`).
- Session 20 `SESSION20-page-headers.zip` - seven pages on the shared header (`UPDATE_PAGE_HEADERS_OCT2026.md`). Independent of 19 (different files); either order works.
Both frontend only. Neither was compiled by real eslint / next build: first real compile = GitHub Actions.
If red look first at: `StudentSidebar.tsx`, `lib/student-nav.ts` (server layout imports it: no "use client"), the seven pages above.

## Still open
1. **"Premium too big"**: waiting for Sachin's screenshot / which element (dashboard card `dashboard/page.tsx` ~L412,
   `/premium`, header menu item). Target: small calm badge, once, no layout push at 360 px.
2. **Area 2 - exam-real mock test.** Audit first (`app/test/page.tsx` is 2500 lines, `cgl-test`, `quiz`): palette colours
   + counts, section timers / locking, mark-for-review, clear response, per-question language switch, submit summary,
   keyboard shortcuts, `beforeunload`, server-side idempotent submit (second submit returns the finished result instead of
   400 "Attempt already submitted"), autosave retry indicator, resume after refresh / device change. Write the audit as a
   table (exists / partial / missing, file + line) before changing anything; then close gaps in small steps with a
   fake-Prisma simulation for the server parts (interleaved double submit).
3. Handoff 19 known limits (withdrawals) unchanged.

## OPEN / ASK (one short message to Sachin)
1. Did Actions go green for sessions 16-20? If red: paste the failing job log.
2. Did the migrations `20261029100000_helpdesk_state_rank` and `20261029110000_withdrawal_sanction_utr` apply?
3. Premium screenshot (which element is too big)?
4. OK to start area 2 (exam-real mock test audit) next?
