# Handoff 7 — Date-wise + Tier-wise PYQ mocks (26 Oct 2026)

## Shipped in this batch (verify first, then continue)
- `backend/src/common/pyq-paper-key.ts` (+spec): paper identity = examId|examTier|tierPaper(blank=PAPER_1)|examDate|shift. paperCode is a label only.
- `backend/src/common/excel-sheet.ts` (+spec): upload now picks sheet "Questions Import" > "Questions" > header-sniff > first. Fixes README-first templates. Used in worker (Function#toString), job service, readExcelRows fallback.
- `backend/src/bank/pyq-paper-builder.ts` (+spec, in-memory Prisma fake): buildKeyedPaper(). Template ids `pyq-k-<exam>-t1[-p2]-<yyyymmdd>-<s#|na>` (keep `pyq-` prefix on purpose: paywall/list/admin key off it). Hidden until built >= pattern target (fallback 100), switched on ONCE, never off; admin hide respected. Existing legacy `pyq-<slug>` mock for same exam+date+shift stays the mock (tier stamped only).
- Schema: Question.tierPaper, Question.paperQuestionNo (NOT questionNo = global unique serial), TestTemplate.examTier/tierPaper/targetQuestions. Migration `20261026120000_pyq_paper_datewise` (additive).
- Upload: optional columns examTier, tierPaper, questionNo; year may be blank if examDate given; derived paperCode when blank. Old 30-col files unchanged. Template downloads (xlsx/csv/tsv) have the new columns.
- Serving: tests.service shiftWisePyqPaper keyed branch (paper order by paperQuestionNo, cap 300 not 100); `paperQuestionNo` added to question payload, `questionNo` untouched.
- /mocks API returns examTier/tierPaper; student page has Tier tabs + Year > Month grouping.
- Admin API: GET `/bank/admin/upload/pyq-papers`, POST `.../pyq-papers/rebuild`, POST `.../pyq-papers/:id/publish-now`.

## NOT done yet (do next, in this order)
1. Admin UI page for the 3 endpoints (no frontend yet) — until then use API / curl.
2. Preview-before-commit (`papers[]`, `pending[]`) on upload; warnings for invalid tier text (currently silently undefined) and date-without-tier.
3. Backfill script `--dry-run` (paperCode regex via parsePaperCode, derived flag) — pyq-date worker does NOT call rebuild for rows lacking year/shift; use POST pyq-papers/rebuild after it.
4. year-wise page: tier step/param (tests.service yearWiseStart still tier-blind).
5. PAPER_LINKED duplicate mode; repeated questions across papers.
6. Question export/duplicate-compare/question-edit don't carry the 3 new fields; JSON/Word uploads don't read them.
7. Hardcoded 100 cap remains for LEGACY path only.

## Verification status (honest)
- Pure specs (key module, sheet picker, builder with fake Prisma, keyed dedupe): 55/55 passed via a mini jest shim — real `jest`, `prisma generate`, `tsc` full build were NOT run (no node_modules/network in sandbox). Run: `cd backend && npx prisma generate && npx tsc --noEmit && npm test`.
- Parser changes (bank-upload.service) and frontend page: syntax-checked only.
- Deploy: `git pull && docker compose up -d --build && npx prisma migrate deploy` (migration is mandatory).
