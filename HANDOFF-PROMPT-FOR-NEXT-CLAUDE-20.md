# Handoff 20 - student left-side menu done (28 Oct 2026)

Repo: SSC-PREP (NestJS 11, Next.js 14, Prisma 5.22/Postgres). Owner Sachin, Hinglish, Termux + Mac. Rules unchanged
(`NEXT-CLAUDE-MASTER-PROMPT-V3.md`, kept in the Project docs): start from his newest zip, ONE zip + `apply-fix.sh`
(md5 table, CHECK -> APPLY -> VERIFY, STOP on mismatch; template + generator are in the Project docs), never ask him to
run dev tools, say exactly what was / was not run, end with HANDOFF-21 (next number is **21**).

## Delivered: `SESSION19-student-sidebar.zip` (roadmap area 1, first half)
See `UPDATE_STUDENT_SIDEBAR_OCT2026.md`. Short: signed-in students get a collapsible left menu on tablet / desktop
(13 items, 3 groups, Hinglish aware, follows feature flags); phones (< 768 px) keep the bottom bar. A boot script in
`<head>` reserves the space before first paint so there is no jump. Test / quiz / result / admin screens never get it.
Frontend only: no backend, no migration.

## Run / NOT run
- Run: strict tsc of the new files with shims, tsc error-list diff (only the "packages not installed" noise), minilint
  (0), `scripts/audit/sidebar-boot-test.cjs` (24 cases + consistency, ALL OK), real SSR of `StudentSidebar` + `AppHeader`
  with the repo CSS (Tailwind 4 compile) screenshotted at 1280 / 820 / 768 / 360 px light + dark.
- NOT run: real eslint, `next build`, real browser on real pages, the phone bottom bar, keyboard walk-through.
  If Actions is red look first at: `StudentSidebar.tsx`, `lib/student-nav.ts` (imported by the server layout - it must stay
  free of "use client" and hooks), `app/layout.tsx`.

## Still open from V3 (nothing else was started)
1. **"Premium too big"** - needs Sachin's screenshot / which element. Candidates: dashboard card (`dashboard/page.tsx`
   ~L412), `/premium`, header "Premium plans" item. Target: small calm badge, shown once, no layout push at 360 px.
2. Seven student pages still draw their own small header (`bookmarks`, `help`, `leaderboard`, `review`, `study-plan`,
   `weak-topics`, `question-bank-practice`): move to `AppShell` / `ShellHeader` (finish area 1).
3. Area 2 (exam-real mock test audit) is the next big area; do the audit before touching `app/test/page.tsx` (2500 lines).
4. All "Known limits" of handoff 19 (withdrawals) are unchanged.

## OPEN / ASK (one short message to Sachin)
1. Did GitHub Actions go green for sessions 16, 17, 18 and 19? If red: paste the failing job's log text.
2. Did migrations `20261029100000_helpdesk_state_rank` and `20261029110000_withdrawal_sanction_utr` apply?
3. Sidebar: open `/dashboard` on a laptop and on a tablet / narrow window - is the menu OK? Screenshot of "Premium" that is too big?
4. Next: finish area 1 (own headers), then exam-real mock test (area 2) - OK?
