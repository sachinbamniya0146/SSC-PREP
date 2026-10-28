# Handoff 22 - exam screen audit + safe submit (28 Oct 2026)

Rules: `NEXT-CLAUDE-MASTER-PROMPT-V3.md` (Project docs). Start from Sachin's newest zip, ONE zip + `apply-fix.sh`, never ask him to run dev tools,
say what was / was not run, end with HANDOFF-23 (next number **23**).

## Delivered in this line (all unverified by real CI until Sachin reports Actions)
- S19 `SESSION19-student-sidebar` - left menu. S20 `SESSION20-page-headers` - seven pages on the shared header.
- S21 `SESSION21-exam-safe-submit` - `AUDIT_EXAM_SCREEN_OCT2026.md` (area 2 audit table), idempotent `submitAttempt`, exam-screen
  leave guard / tab-switch notice / autosave pill / language switch, `scripts/audit/submit-sim.cjs`. S21 needs S19 applied first.

## Run / NOT run (S21)
Run: submit-sim (21 checks new = ALL OK, old tree = the sequential-duplicate check FAILS), tsc diff frontend + backend, minilint.
NOT run: jest, eslint, `next build`, the exam page in a browser / on a phone. First real compile = Actions.
If red look first at `app/test/page.tsx` (new effects near L905-945, pill L2069, language switch L2182) and `tests.service.ts` (`submitAttempt`, `loadAttemptResult`).

## Still open
1. **Premium "too big"** - still needs Sachin's screenshot / which element.
2. Area 2 leftovers (see the audit table): question-paper view; calculator (check which papers really show one first); tab-switch
   count to the server; soft-keyboard check at 360 px on a real phone; **sweeper for expired IN_PROGRESS attempts** (decision needed:
   does an abandoned attempt get a result / count for rank?).
3. Area 3 next: results & analysis reconciliation (score = correct x marks - wrong x negative per template; totals = question count;
   answers never visible before the attempt is finished). Start with an audit of `results/[attemptId]/page.tsx` and
   `attemptDetail()` the same way (table + sim), not with new UI.
4. Handoff 19 known limits (withdrawals) unchanged.

## OPEN / ASK (one short message to Sachin)
1. Did Actions go green for sessions 16-21? If red paste the failing job log.
2. Premium screenshot.
3. Abandoned timed attempts: should an unsubmitted test whose time ran out be auto-submitted and counted for rank? (default: yes, but only
   the autosaved answers, and only if at least one answer exists)
4. OK to start area 3 (results & analysis audit)?
