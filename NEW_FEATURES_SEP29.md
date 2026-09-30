# SSC Prep Hub — features added (Sep 29 2026)

## Deploy
1. `cd backend && npx prisma migrate deploy && npx prisma generate` (migration `20260929100000_vocab_revision_and_study_plan_v2`, additive, re-runnable)
2. Rebuild + push backend & frontend images, `docker compose -f docker-compose.prod.yml up -d`
3. `.env` on VPS: fill `S3_*` (R2) and set `MEDIA_PUBLIC_BASE=https://sscprephub.in`
4. Admin → Question upload → "Check image storage" must show ✅ before uploading image questions.

## What is new
| Area | Behaviour | Where |
|---|---|---|
| PYQ mocks | Excel column `examDate` (YYYY-MM-DD / DD-MM-YYYY); exam+year+date+shift => own real-paper mock (max 100 Qs). /mocks groups Year > Date > Shift | bank-upload.service, mocks.service, /mocks |
| Syllabus | Admin can download live syllabus Excel and re-import it (round trip) | GET /bank/admin/upload/syllabus-export, /admin/topics |
| Weak PYQ topic -> practice | Results page lists wrong topics; each starts a 25-Q Easy→Hard practice set | GET /bank/practice/from-attempt/:id |
| Practice | Free = 5 sets/day, ₹19 plan unlimited; weak-topic practice never uses quota; bilingual paywall | question-bank-practice.service |
| Vocab revision | 2 Qs per unlocked word, timed; wrong word must be re-scored 95%; new words blocked until revision done | /vocabulary/revision, vocab-revision.service |
| Pay-to-skip | ₹1, then ₹5, 10, 20, 50, 100 on consecutive skipped days (env VOCAB_SKIP_FEES); resets after a completed revision | monetization VOCAB_REVISION_SKIP |
| Word unlock | ₹2 per word, ₹100 unlock-all (with "read first" warning), all messages English + Hindi | monetization, /vocabulary/[slug] |
| Timers | Practice quiz + revision are countdown timers with auto-submit | vocab quiz/revision pages |
| Study plan | Mark chapters -> tomorrow 9 AM IST full-pattern test on only those chapters, live countdown, chapter <90% => WEAK (un-marked), >=90% => COMPLETE (also from any test / chapter practice) | study-plan-v2.service, /study-plan/board |
| Weak board | Exam-wise / subject-wise accuracy down to sub-topic with "strengthen" links | GET /study-plan/weak |
| Daily target | Chapters/day, practice Qs/day, PYQ mocks/week from exam date | GET /study-plan/today |
| Images | Bulk image upload, storage health check, permanent /api/v1/media URLs (private bucket ok), local-disk fallback, Daily Test no longer drops image questions | s3.service, media.controller, AdminImageTools |

## Not done / decide
- No 9 AM push/notification (no scheduler in the project) — the countdown shows in the app only.
- Code was written without `npm install` / a database, so it has NOT been compiled or run: run `npm run build` in backend and frontend first and fix any type error.
