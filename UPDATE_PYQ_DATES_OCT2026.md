# Update — 8 Oct 2026 (PYQ date mapping + AI key usage log + PYQ Excel export) — MERGED with upload-status update

## Deploy
- New migration `20261007120000_pyq_date_mapping_and_ai_usage` (runs via `prisma migrate deploy`; every statement is `IF NOT EXISTS`, safe to re-run). No new env variable.
- Optional env: `PYQ_DATE_WORKER=off` switches the background worker off completely.

## What is new
1. **AI key usage log** (Admin → API Keys): per key last use (feature + model + time), per-feature counts (30 days), full log with filters.
   Features logged: PYQ_DATE_MAPPING, AI_EXPLANATION, QUESTION_HINDI_TRANSLATE, CHAPTER_SUGGEST, KEY_TEST. (Student's own key calls are logged as "Student own key".)
2. **PYQ date mapping** (Admin → `/admin/pyq-dates`): every PYQ (question with a year) without exam date is queued 5 min after upload.
   Per question: 5 passes = 5 different web searches -> evidence -> FREE OpenRouter model extracts the exam date.
   A pass counts only if the date is literally in the evidence AND its year matches the question's year (Tier 2 may be year+1).
   3 of 5 passes on one date -> `Question.examDate` set (+ `examTier` Tier 1/2); weaker -> "Admin check" with Accept / Reject / manual date.
   A paper (exam+year+shift) must have one date: a conflicting date goes to review. Shift-wise mock titles are refreshed with the date.
3. **PYQ Excel export** (Admin → `/admin/pyq-export`): exam / subject / chapter / exam>subject>chapter / tier / year / date wise,
   one workbook (sheet per group + Summary) or a ZIP with folders. Status log Excel at `/admin/pyq-dates`.

## Notes
- Search is done by the server (DuckDuckGo -> DuckDuckGo lite -> Bing, free). OpenRouter free models cannot browse and OpenRouter's web plugin is paid.
- Free OpenRouter keys have small daily limits; one question needs up to 5 AI calls. Add more keys for speed.
- Merge note: `schema.prisma` and `frontend/src/app/admin/page.tsx` were MERGED onto the upload-status update (kept `UploadBatch.status/queuedCount/...` and the live batch table).
