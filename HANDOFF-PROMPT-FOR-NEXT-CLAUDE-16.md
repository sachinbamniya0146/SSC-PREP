# Handoff 16 — PDF extraction removed, Refer & Earn v2, admin console, legal pages, celebration, vocab pin (28 Oct 2026)

Repo: SSC-PREP (NestJS 11, Next.js 14, Prisma 5.22/Postgres). Owner Sachin, Hinglish, Mac + Termux. Rules unchanged from handoff 14/15: start from his newest zip; deliver ONE zip + `apply-fix.sh` (md5 BASE CHECK, STOP on mismatch, handle deletions, Mac + Termux blocks); never ask him to run prisma/build/tsc/jest; state exactly what was/wasn't run; end with HANDOFF-17. Handoff-14 itself is not in the repo, so apply-fix.sh format was rebuilt: table of `path|baseMd5|newMd5`, phases check -> apply -> verify, re-run safe.

## Delivered: `SESSION15-refer-earn-admin-console.zip`
See `UPDATE_REFER_ADMIN_UI_OCT2026.md` for the full list. Key facts for the next session:
- PDF ingestion deleted; review-status endpoint now `PUT admin/questions/:id/review-status` (`bank/question-review-status.controller.ts`). Old pipeline tables remain in DB. `pdf-parse`/`openai` still in package.json.
- Referral v2: `backend/src/referral/{referral.service,referral-config,referral-config.service,referral-admin.controller,referral-public.controller}.ts`. `onPaidPurchase(userId,{id,amountInr,kind})` only credits `kind==='PLAN'`. Commission PENDING -> AVAILABLE after `holdDays` (10-min `setInterval` job), reversed by Cashfree REFUND webhook (`monetization.service.handleWebhook`) or admin. Rules live in `app_settings` key `referral.config`, edited at `/admin/referrals` -> Rules. Welcome discount chosen vs coupon in `monetization.service.createOrder` (cheaper wins, never stacked).
- Admin: `components/AdminShell.tsx` + `app/admin/layout.tsx` wrap every admin page; legacy pages keep their own headers but CSS in `globals.css` (`.admin-content ...`) flattens them. Home = `app/admin/page.tsx`, old page = `app/admin/uploads/page.tsx`. `GET /admin/overview`.
- Vocab: `vocab_word_progress.unlockedAt` pins every reachable word; gate (REVISION_PENDING / REMASTER_REQUIRED) is a hold, never a lock.
- `PurchaseCelebration.tsx` + `lib/confetti.ts`, used by `payment/success`.
- Legal: `terms|privacy|refund` pages with `LegalLayout`, `lib/site-config.ts`.
- Dashboard: daily goal (`gamification/me.todayAnswered`), revision/weak/vocab cards.

## Run / NOT run
- Run: tsc error-diff with stubs (no new real errors), in-memory Prisma logic tests (referral 57, config 18, vocab 14), confetti in Chromium, apply-fix simulated on pristine copy.
- NOT run: real tsc, nest/next build, jest, prisma generate, migrations on Postgres, Cashfree refund webhook, visual check of admin pages. First real compile = GitHub Actions "Build backend image".

## Known limits / ideas
- Legacy admin sub-pages still use their own old styling inside the new shell (flattened, not redesigned one by one).
- Suspended students still show in leaderboards; tombstone user counts in totals (from handoff 15).
- Commission is only on PLAN purchases; if he wants chapter/mock commission change `onPaidPurchase`.
- Legal text is a good-faith draft, not lawyer-reviewed.
- No jest specs were added for the referral logic (the fake-Prisma tests ran only in scratch); worth adding as `referral.service.spec.ts` once a real compile works.

## OPEN / ASK (one short message)
1. Did deploy go green? Test: signup with `?ref=CODE` -> buy plan -> commission Pending in `/referral` -> `/admin/referrals` Release due now -> Withdrawable.
2. Confirm legal items (refund window, entity name/address, grievance email).
3. Next: performance (Task 3 from handoff 14), exam timing mode, section-wise analysis; redesign remaining admin sub-pages one by one.
