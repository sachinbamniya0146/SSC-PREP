# Payments / subscription overhaul — 24 Oct 2026

## Bugs fixed
1. Buying a plan while one was active DELETED the remaining days -> now stacks (new end = old end + duration). Same for admin grant, bulk grant, referral rewards (`monetization/subscription.util.ts`).
2. `fulfill()` marked payment SUCCESS *before* granting access; any error in between = money taken, nothing granted, never retried -> now one DB transaction (claim + grant + coupon + audit), rolled back together.
3. Missed webhook / closed tab = paid but not activated -> new reconciler (every 5 min, last 48h PENDING orders asked from Cashfree) + startup run.
4. 100%-off coupon threw "item is free" -> now activates the plan directly.
5. Coupon stored raw (lower-case via API) but consumed by exact match -> usage never counted; now canonical upper-case. Also one redemption per user.
6. `notify_url` was a relative URL when `BACKEND_PUBLIC_URL` unset -> Cashfree rejected the order; now only sent when https.
7. Amount verification (gateway amount must equal our order amount) on verify + webhook.
8. Webhook errors now return 5xx so Cashfree retries; Cashfree calls have a 20s timeout.
9. Fake auto-pay (only wrote audit log, nothing renewed) removed; honest message + real one-click `POST /payments/renew`.
10. Lapsed ACTIVE rows now flipped to EXPIRED (job + lazy); `mySubscription` returns daysLeft/expiringSoon; ADMIN = premium everywhere.
11. `invoiceUrl` pointed to a page that did not exist -> `/invoice/[id]` built.
12. payments table had no indexes -> migration `20261024100000_payment_indexes`.

## New
- `GET /payments/history`, `GET /payments/invoice/:id`, `POST /payments/renew`
- Frontend: rebuilt `/premium` (expiry banner, renew, order summary, free coupon), `/premium/history`, `/invoice/[id]` (print/PDF)
- Unit tests: `subscription.util.spec.ts`
