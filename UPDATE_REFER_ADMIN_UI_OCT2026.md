# UPDATE — Refer & Earn v2, Admin console, Legal pages, Purchase celebration, Vocab unlock fix (28 Oct 2026)

Base: SESSION14 (user suspend/delete). Delivered as `SESSION15-refer-earn-admin-console.zip` + `apply-fix.sh`.

## 1. PDF question-extraction system — REMOVED
- Deleted: `backend/src/pdf-ingestion/*`, `frontend/src/app/admin/pdf-studio/*`, `tools/ocrbin`, `tools/ocrhi`, `backend/scripts/ocr_preprocess.py`, `backend/scripts/import-ocr.mjs`, `scripts/self_source_pyqs.py`; poppler/tesseract/opencv dropped from `backend/Dockerfile`.
- The one endpoint other pages still needed (question review approve/reject) moved to `backend/src/bank/question-review-status.controller.ts` (`PUT admin/questions/:id/review-status`); `/verification` uses the new URL.
- Prisma models/tables of the old pipeline were left in the DB on purpose (no data loss, no destructive migration). `pdf-parse` / `openai` are still in `package.json` (lock file can't be regenerated offline) — harmless, remove later with `npm uninstall`.

## 2. Refer & Earn v2 (real, abuse-resistant)
- **Friend gets a welcome discount** on their FIRST plan (default 10%, max ₹150). It never stacks with a coupon: the cheaper of the two wins (server decides; premium page shows the same).
- **Referrer earns commission only on plan purchases**, on the amount actually paid (default 20%, 30% from the 10th paying friend).
- **Hold period** (default 7 days): commission shows as *Pending*, then becomes *Withdrawable* automatically (background job every 10 min; `REFERRAL_RELEASER=off` disables it).
- **Refunds**: a Cashfree refund webhook reverses the commission automatically; admin can also reverse manually (reason required). If money was already released the balance can go negative and blocks withdrawals until new earnings cover it.
- **Fraud flag**: same device used by referrer + friend => commission waits for admin approval ("Needs review" filter).
- **Rules**: self-referral, circular referral (A↔B), second code, code after first purchase are all blocked with a clear message. Names of friends are masked (Rahul S.).
- Sticky invite links: `?ref=CODE` is remembered 30 days and pre-fills signup; signup shows "Rahul invited you — 10% off".
- Withdrawals: min amount, min paying friends, one open request at a time, atomic balance deduction.
- **Admin → Referrals** (`/admin/referrals`): overview, Withdrawals, Commissions (approve / reverse / release now), All referrals, and **Rules** tab — every number above is editable there (stored in new table `app_settings`).
- Invoice / payment history show the referral discount line.

## 3. Admin console redesign
- New shell for every `/admin/*` page: sidebar (permission-aware), live badges, mobile drawer, theme toggle.
- **Big "User Management" button** at the top of the sidebar and a large card on the new admin home (`/admin`). Admin home also has KPIs, "Needs attention" queues, tool cards, new students, latest payments (new endpoint `GET /admin/overview`).
- The old admin page (plans + bulk upload) moved to `/admin/uploads` (title "Plans & Bulk Upload").
- Student header gets an "Admin console" / "Staff workspace" link for staff.

## 4. Student experience
- Dashboard: daily-goal progress bar (10/20/30/50, saved on device; today's answered count comes from `GET /gamification/me → todayAnswered`), streak-at-risk nudge, Revision queue / Weak topics / Vocabulary smart cards (real endpoints `/review/stats`, `/bank/weak-topics`), single Admin console link for admins (old PDF Studio link gone).
- **Purchase celebration**: after a successful payment a gift appears → tap (or wait 4.5 s) → cracker-blast confetti + plan card (name, valid until). Once per order; respects "reduce motion".
- **Vocabulary**: an unlock is now permanent (`vocab_word_progress.unlockedAt`). Failed revision / lapsed pass / reordering the word list can no longer re-lock a word; a pending revision is shown as a temporary "on hold" with a one-tap fix. Rewritten hub page.

## 5. Legal
- `/terms` (15 sections incl. Refer & Earn), `/privacy`, `/refund`, footer links, sitemap, required checkbox on signup. **Please read them once** — items to confirm: refund window (7 days, digital goods non-refundable after activation), governing law (India), grievance email (`NEXT_PUBLIC_SUPPORT_EMAIL` or admin@sscprephub.in), no legal-entity name/address yet.

## Deploy
- Migrations (re-run safe): `20261028180000_vocab_unlock_pin`, `20261028200000_referral_v2` — run automatically by the container start (`prisma migrate deploy`).
- Optional env: `NEXT_PUBLIC_SUPPORT_EMAIL`, `REFERRAL_RELEASER=off`.
- Push to `main` => GitHub Actions deploys. Manual: `cd /opt/ssc-prep-hub && ./deploy.sh`.

## What was run / NOT run
- RUN: tsc error-diff base vs modified (backend with stubbed externals, frontend with stubbed react/next) — no new real errors; 57 referral logic checks on an in-memory Prisma double (apply-code rules, hold→release, refund reversal, fraud hold, tiers, milestones, withdrawal rules, negative balance); 18 config/helper checks; 14 vocab unlock checks; confetti engine in headless Chromium (draw, self-clean, reduced-motion); apply-fix.sh simulated on a pristine copy.
- NOT run: real `tsc`/`nest build`/`next build`/jest/`prisma generate` (npm registry not reachable here), migrations on real Postgres, real Cashfree refund webhook, browser visual pass of admin pages. First real compile = GitHub Actions. If it fails look at: `referral.service.ts`, `monetization.service.ts`, `admin.controller.ts` (`overview`), `AdminShell.tsx`, `vocab.service.ts`.
