# SSC-PREP — Staff Access (Department) Update

Admin ab kisi bhi registered student ki EMAIL par alag-alag department ka access de sakta hai:

| Department | Kya kar sakta hai |
|---|---|
| QUESTIONS (📘) | PYQ / main question bank upload, question manager, chapters/topics/syllabus, coverage, PDF studio |
| PRACTICE (📗) | Sirf practice-only questions upload; sirf apne uploads dekh/delete/publish kar sakta hai |
| VOCABULARY (📖) | Vocabulary words + vocab questions upload/edit, template download |
| SUPPORT (💬) | Student support chat + question error reports |

Admin = sab kuch. Staff ko sirf wahi dikhta hai jo diya gaya.

## Deploy steps
1. Is zip ki files ko repo me SAME PATH par overlay karein (git push).
2. Server par:
   ```bash
   cd ~/SSC-PREP   # repo folder
   git pull
   docker compose exec backend npx prisma migrate deploy   # ya rebuild ke saath auto-run ho to skip
   docker compose up -d --build
   ```
3. Migration `20260928100000_add_staff_permissions` purane MODERATOR accounts ko 4 permissions de deta hai
   (unka access pehle jaisa hi rahega); baad me /admin/staff se kam kar sakte hain.
4. Test: Admin login -> /admin/staff -> student email daal ke Check -> department tick -> "Access dein".
   Student ke phone par app kholte hi (ya 1 minute me) "Staff Tools" dikhne lagenge.

## New files
- backend/src/staff/staff.module.ts, staff.controller.ts, staff.service.ts, dto/staff.dto.ts
- backend/src/common/decorators/department.decorator.ts
- backend/prisma/migrations/20260928100000_add_staff_permissions/migration.sql
- frontend/src/app/admin/staff/page.tsx
- frontend/src/lib/permissions.ts
- frontend/src/components/SessionSync.tsx

## Changed files
Backend: prisma/schema.prisma, app.module.ts, common/guards/roles.guard.ts, common/decorators/current-user.decorator.ts,
bank/bank-upload.controller.ts, bank/bank-admin.controller.ts, bank/bank.controller.ts, vocab/vocab-admin.controller.ts,
vocab/vocab-upload.service.ts, admin/admin.controller.ts, admin/admin-help.controller.ts, pdf-export/pdf-export.controller.ts,
pdf-ingestion/pdf-ingestion.controller.ts, search/search.controller.ts, ai-explanation/ai-explanation.controller.ts,
support-chat/support-chat.controller.ts + .service.ts, report-error/report-error.controller.ts + .service.ts,
chat/chat.gateway.ts, auth/auth.service.ts, users/users.service.ts
Frontend: app/admin/page.tsx, app/admin/vocab/page.tsx, app/dashboard/page.tsx, app/layout.tsx

## Bugs / gaps fixed in this update
1. SECURITY: role JWT me stale rehta tha — hataye gaye admin/moderator ka access token expiry tak chalta tha. Ab RolesGuard DB se live role+permission check karta hai (10s cache).
2. Naya promote hua staff re-login tak student UI dekhta tha aur har /admin page /dashboard par bounce karta tha. Ab SessionSync role ko server se refresh karta hai.
3. Koi bhi MODERATOR sab kuch (vocab, support chat, PDF, delete) kar sakta tha — ab department-wise.
4. Staff dusre staff ke upload batches delete/publish kar sakta tha — ab non-admin sirf apne batches.
5. Support chat sockets/report threads: ab sirf ADMIN ya SUPPORT-permission wale moderator.
6. Audit log ab sirf ADMIN ko (usme sabke actions hote hain).
7. admin.controller me `throw new Error` (500, message gayab) -> proper 400/404 messages.
8. Vocabulary: Excel template download missing tha -> add. Same file me repeat question duplicate ban jata tha -> fixed. Vocab uploads ab audit log me.
9. Staff dashboard par ab sirf unke departments ke cards.

## Note
Yahan node_modules/network nahi tha, isliye full build nahi chala paya — sirf syntax check hua.
Push se pehle chalayein:  `cd backend && npx prisma generate && npm run typecheck`  aur  `cd frontend && npm run build`.
