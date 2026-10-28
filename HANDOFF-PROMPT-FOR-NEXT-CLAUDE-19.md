# Handoff 19 - withdrawals (sanction → pay, UTR, stats) done (28 Oct 2026)

Repo: SSC-PREP (NestJS 11, Next.js 14, Prisma 5.22/Postgres). Owner Sachin, Hinglish, Termux + Mac. Rules unchanged
(`NEXT-CLAUDE-MASTER-PROMPT-V2.md`): start from his newest zip, ONE zip + `apply-fix.sh` (md5 table, CHECK -> APPLY -> VERIFY,
STOP on mismatch), never ask him to run dev tools, say exactly what was / was not run, end with HANDOFF-20.

## Delivered: `SESSION18-withdrawals.zip`
See `UPDATE_WITHDRAWALS_OCT2026.md`. Short: withdraw flow is now Waiting → Approved (sanction) → Paid (UTR) / Rejected / Failed,
every change is one conditional update + wallet change in a transaction (refund exactly once), admin sees waiting / sanctioned /
paid numbers, student sees a progress line + UTR, Cashfree auto-pay is idempotent and never refunds on a timeout.
The session-17 code double-refunded on repeated Reject clicks (proved by `scripts/audit/withdrawal-sim.cjs old`).

## Run / NOT run
- Run: 24 specs (`withdrawal.util.spec.ts`), 46-check simulation (new code all pass, old code 3 of 3 fail), tsc error-diff, minilint, apply-fix on a pristine copy.
- NOT run: real eslint / jest / prisma generate / build / migration / browser / live Cashfree. First real compile = GitHub Actions.
  If red look first at: `withdrawal.service.ts` (Prisma `groupBy`, `orderBy ... nulls: 'first'`, `$queryRaw` in `referral.service.ts`), `withdrawal-admin.controller.ts`, `admin/referrals/page.tsx`.

## Known limits (left on purpose)
- Cashfree: a transfer can go SUCCESS and later REVERSED; the job only watches rows that are still "Sending", so a later reversal after PAID is not seen (admin would see it in the Cashfree dashboard). Add the Payouts webhook (`TRANSFER_REVERSED`) when auto-pay goes live - needs the signature scheme checked against a live account.
- No push / e-mail / Telegram to the student when a withdrawal is approved / paid (PushService has no per-user send yet).
- Money is stored as `Float` (existing). Everything is rounded to 2 decimals, sums are re-rounded, but a Decimal column would be the clean fix.
- The "ledger" check only compares wallet.totalWithdrawnInr with the PAID rows; a full ledger (earned − reversed − withdrawn = balance) is not built.
- `admin.controller.ts` has an unused injected `monetization` (existed before; not an ESLint error).

## OPEN / ASK (one short message to Sachin)
1. Did GitHub Actions go green for session 16, 17 and 18 commits? If red: paste the failing job's log text.
2. Did the migration `20261029110000_withdrawal_sanction_utr` apply (backend container started)?
3. Test once: student asks ₹100+ withdrawal → admin Approve → Mark as paid with a UTR → student sees the UTR. Anything odd?
4. "Premium ka bada dikhna" - which one: header Premium badge/button, dashboard banner or the /premium page? A screenshot makes it a 10-minute fix.
5. Student left-side menu like the admin sidebar: yes for desktop/tablet (phones keep the bottom tab bar)?
6. Next big area: exam-real mock test (roadmap A), results & analysis (B) or admin quality of life (F)?
