# UPDATE — Refer & Earn withdrawals: sanction → pay (UTR), stats, double-click-proof money (28 Oct 2026)

Base: SESSION17 (production-proof). Delivered as `SESSION18-withdrawals.zip` + `apply-fix.sh`.

## What was wrong (found by reading + running the OLD code against a fake database)
Run `cd backend && tsx ../scripts/audit/withdrawal-sim.cjs old .` on the session-17 tree:
- **Reject twice / triple click** refunded the student **every time** (balance 500 expected, 900 found).
- Rejecting an already **FAILED** (already refunded) request refunded again.
- **Mark paid twice** counted the payout twice in the wallet.
- Cashfree auto-pay: the transfer id contained the clock, so two clicks = two real transfers; a timeout *after* Cashfree accepted the transfer refunded the student **and** the money still went out.
- Request → "PAID" immediately although Cashfree says "RECEIVED" (the bank has not paid yet).
- Nothing showed "sanctioned" vs "paid" separately; no UTR; no stats.

## What it does now
**Flow:** `Waiting → Approved (sanction) → Paid (UTR)`; side exits `Rejected` (from Waiting or Approved) and `Failed` (Cashfree). The student's balance was already reduced at request time; the only ways out are PAID (stays deducted) or REJECTED / FAILED (goes back, **exactly once**).

- **Every status change is a conditional update in one DB transaction with the wallet change** (`WHERE id AND status IN (...)`). Double click, two admins, student Cancel vs admin Reject, the background job — the second one gets "already ...". 
- **Admin → Refer & Earn → Withdrawals**: numbers on top — *Waiting for you*, *Sanctioned – still to pay*, *Paid* (+ today, last 30 days), *Sanctioned in total*, returned amount; payout mode (Manual / Cashfree); a red warning if wallet counters ≠ paid rows. Filters with counts, search (name, email, UPI, UTR), Copy UPI / account / IFSC buttons, ⚑ warning when the student's friends are flagged, CSV download, auto-refresh every minute.
- **Approve (sanction)** → nothing is sent. **Mark as paid** needs the **UTR** (6–40 chars; the same UTR cannot be used twice); the student sees it. **Reject / take back** needs a reason (shown to the student).
- **Cashfree (only when `CASHFREE_PAYOUT_CLIENT_ID/SECRET` are set; today they are not)**: `Send via Cashfree` → we first ask Cashfree whether this transfer id exists (never create twice), then create. Transfer id = `WD_<withdrawal id>` (never the clock). Result `SUCCESS` → Paid with Cashfree's UTR; `FAILED/REJECTED/REVERSED/...` → Failed + refund once; anything else stays **Sending**. A timeout / 5xx **never refunds** ("do NOT pay again, check status"). Only a clear 4xx (bad account...) counts as refused. Background job every 5 min (`WITHDRAWAL_POLL=off` disables) settles Sending rows; if Cashfree has never heard of a transfer after 10 min the row goes back to *Approved* so it can be sent again. Overrides for stuck rows: *Check status*, *Mark as paid (UTR)*, *Mark failed* (reason, refunds once).
- A student whose account or referral earnings are suspended cannot be sanctioned / sent (reject instead).
- **Student (/referral → Withdraw)**: totals (Waiting / Approved, coming / Paid to you) and a progress line per request: Requested → Approved → Paid with dates and the UTR; rejected shows the reason; a failed transfer shows a fixed sentence (never the gateway text). One request at a time and "never more than the balance" now hold under simultaneous taps (row lock `FOR UPDATE` on the wallet).
- Audit log: `WITHDRAWAL_APPROVED`, `WITHDRAWAL_PAID_MANUAL`, `WITHDRAWAL_PAID_AUTO`, `WITHDRAWAL_REJECTED`, `WITHDRAWAL_SENT_TO_GATEWAY`, `WITHDRAWAL_PAYOUT_FAILED`, `WITHDRAWAL_PAYOUT_UNCERTAIN`, `WITHDRAWAL_PAYOUT_NOT_FOUND`, `WITHDRAWAL_MARKED_FAILED` (old `WITHDRAWAL_APPROVED_MANUAL` is no longer written).

## Files
Backend: `referral/withdrawal.util.ts` (+`.spec.ts`), `withdrawal.service.ts`, `withdrawal-admin.controller.ts`, `dto/withdrawal.dto.ts`, `payout.service.ts` (rewritten), `referral.service.ts` (request / cancel / student list), `referral.module.ts`; old `admin/withdrawals*` routes removed from `admin.controller.ts` (same URLs, now in the new controller); `schema.prisma` + migration `20261029110000_withdrawal_sanction_utr` (additive: approvedAt, approvedById, paidAt, paidById, rejectedAt, paymentRef, gatewayStatus, lastCheckedAt; old rows back-filled).
Frontend: `admin/referrals/page.tsx`, `admin/referrals/[userId]/page.tsx`, `referral/page.tsx`.
Audit helper: `scripts/audit/withdrawal-sim.cjs`.

## Payments (read, not changed)
A payment is approved only on the server: `/payments/verify` asks Cashfree for the order status and checks the amount; the signed webhook and the reconciler do the same; `fulfill()` is one DB transaction and idempotent. The success page only sends the order id. Nothing a browser sends can grant a plan.

## Deploy
Migration runs by itself at container start. No new env needed. To switch on Cashfree auto-payout later: `CASHFREE_PAYOUT_CLIENT_ID`, `CASHFREE_PAYOUT_CLIENT_SECRET`, `CASHFREE_PAYOUT_ENV=PRODUCTION` (and whitelist the server IP in the Cashfree Payouts dashboard).

## Run / NOT run
- RUN: 24 unit tests for the new pure rules (shim runner); 46-check simulation of the REAL `WithdrawalService` + `PayoutService` + `ReferralService` against an in-memory database and a fake Cashfree (double clicks, two admins, student cancel vs reject, lost answers, 4xx / 5xx, status job, stats = table); the same kind of check on the OLD code fails 3 of 3; backend + frontend `tsc` error-diff against the base (only environment errors: missing packages / types, no unused symbols); minilint (0 new); `apply-fix.sh` tested on a pristine copy.
- NOT run: real eslint / jest / prisma generate / nest build / next build / migration on Postgres / browser / real Cashfree Payouts (no keys, sandbox has no npm and no route to Cashfree). The screens were not looked at in a browser. First real compile = GitHub Actions.
- Not verified against live Cashfree: the exact response of `GET /payout/transfers` and `POST /payout/transfers` was checked against Cashfree's published v2 docs, not against a live account. Do a ₹1 sandbox / live test before relying on auto-pay.
