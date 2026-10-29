# S46 - exam date = ONE format DD/MM/YYYY + admin can let one student withdraw earlier (30 Oct 2026)

Sachin: "examdate dalne ka sirf ek hi format, dd/mm/yyyy, mandatory ... turant pta chal jaye" and "refer and earn me admin kisi ko bhi 2 refer ke pehle ya 1 refer par hi paise nikalne ka option de sake".

## 1. Exam date: DD/MM/YYYY only
Rule lives in ONE file: `backend/src/common/exam-date-format.ts` (`parseExamDate`, `dmyToIso`, `isoToDmy`). Accepted: `12/09/2025` (2-digit day, 2-digit month, 4-digit year, `/`).
Rejected with a message that says what to write: `2025-09-12`, `12-09-2025`, `12.09.2025`, `12 Sep 2025`, `5/6/2025`, `12/09/25`, an Excel date value (`45912`), a date that does not exist (`31/04/2025`), a date in the future, a year outside 2000-2100.
Why not guess: `05/06/2025` is 5 June in India and 6 May in the US; the server never guesses, it refuses.
Inside the database the date is still `YYYY-MM-DD` (sorting, paper keys): nothing in existing data changes, no migration for this part.

Where it applies: Excel / CSV / TXT rows (`parseRow`), JSON / JSON paste / Word rows, single add (`/bank/admin/upload/single`, the add page now sends DD/MM/YYYY),
the edit-by-ID bulk sheet (`bank-template.ts buildUpdateBody`), the manual date box of Admin -> PYQ dates (`pyq-date.service.ts setManual`).
Exports (`toExportRow`, gap export, PYQ export) now write DD/MM/YYYY, so a downloaded file re-uploads as it is.
Excel template (PYQ + Practice): examDate column has a typing-time error rule (custom data validation, "stop") - anything but DD/MM/YYYY text is refused while typing; example row and instruction sheet say so.
Admin screens show DD/MM/YYYY (papers table, PYQ dates, duplicates, existing questions, upload preview, manage list). The manual date box is the same `DateField` as the other screens (type `12092025` -> `12/09/2025`, or pick from the calendar).

## 2. Refer & Earn: per-student "friends needed to withdraw"
Admin -> Refer & Earn -> (open a student) -> card **Withdrawal rule for this student**: `Allow now (0 friends)`, `Allow from 1 friend`, `Allow from 2 friends`, `Use programme rule`, optional note.
Also: **Release pending now** (skips the hold days for that student's pending commission; commissions flagged for review still need their own Approve).
The programme-wide number is still in Rules (`minPaidReferralsToWithdraw`, default 3); the student override wins for that one student (`ReferralWallet.withdrawMinFriends`, null = programme rule).
The student's own screen shows the effective number and the withdraw message. Minimum amount (Rules) and the one-open-request / balance locks still apply; a paused (suspended) wallet still cannot withdraw. Audit log: `REFERRAL_WITHDRAW_RULE_CHANGED`, `REFERRAL_PENDING_RELEASED_BY_ADMIN`.
Endpoints (admin): `POST /admin/referral-program/users/:userId/withdraw-rule {minFriends: 0..100|null, note?}`, `POST /admin/referral-program/users/:userId/release-pending`.
Migration `20261030100000_wallet_withdraw_rule_override` (additive, IF NOT EXISTS) - runs by itself at container start.

## Files
backend: common/exam-date-format.ts (+spec), bank/bank-upload.service.ts, bank/bank-template.ts, bank/practice-template.service.ts, bank/question-edit.service.ts (message), pyq-dates/pyq-date.service.ts, pyq-dates/pyq-export.service.ts,
referral/referral-config.ts, referral/referral.service.ts, referral/referral-admin.controller.ts, referral/withdraw-rule.spec.ts, prisma/schema.prisma + migration; specs: bank-upload-job.mixed, practice-template.mixed.
frontend: lib/exam-date.ts, admin/pyq-dates, admin/pyq-papers, admin/questions (add, manage, duplicates), components/ExistingQuestions, admin/uploads, admin/referrals/[userId].
scripts/audit/withdrawal-sim.cjs: scenarios R1-R7 (override).

## Run / NOT run
RUN: 30 new date checks + 4 override checks + all older specs through the shim (no regression vs the base tree), withdrawal-sim ALL OK incl. R1-R7, tsc error-diff against the base for backend and frontend (only environment errors from missing packages), the master-package checker on 1,139 rows (0 errors) and on bad dates (6 expected errors).
NOT run: real jest / eslint / `next build` / `prisma generate` / `prisma migrate` / Postgres, a real Excel (the typing-time rule was built from the OOXML spec and checked as XML only), a phone, the admin pages in a browser.
If Actions goes red look first at: `referral.service.ts` (`setWithdrawRule`, `releaseUserNow` - needs `prisma generate` to know the new wallet columns), `bank-upload.service.ts` (`normalizeExamDate` import of `exam-date-format`), `admin/referrals/[userId]/page.tsx`.
