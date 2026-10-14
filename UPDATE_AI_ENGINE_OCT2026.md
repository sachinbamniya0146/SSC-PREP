# UPDATE — AI Job Engine (Task A) — 15 Oct 2026

## Kya naya hai
- **Central AI Job Engine**: `ai_jobs` / `ai_job_items` / `ai_changes` tables + ek worker (PostgreSQL-backed queue, restart-safe: RUNNING jobs/items boot par PENDING).
  Note: BullMQ ki jagah DB queue li hai — restart par kuch lost nahi hota aur "queue-without-worker" bug possible hi nahi. Key add/ON/Test-pass hote hi `onKeysReady` se job turant resume.
- **Job types**: SOLUTION_GENERATE, HINDI_TRANSLATE, CHAPTER_TOPIC_CLASSIFY, ANSWER_KEY_VERIFY, PYQ_DATE_SHIFT (purana PYQ worker same, engine sirf progress/review mirror karta hai; date/tier likhne par ab AiChange log bhi banta hai -> Undo).
- **5-pass verification**: >=3/5 same answer par hi write; strict JSON schema; 3 pass agree hote hi baaki passes ruk jate hain (decision same rehta hai, calls kam). Hindi: 1 translate (Devanagari + numbers check) + verifier passes.
- **Safety**: admin ki existing value kabhi overwrite nahi (conflict -> review); chapter suggestion kabhi auto-apply nahi; purani value `ai_changes` me -> Undo (single / pura job, chunked).
- **Provider**: transient errors par backoff retry, per-request timeout, token cap, response size guard, har ghante model health check (3 baar fail = 30 min skip), optional OpenAI-compatible gateway fallback (`OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`), logs me key redact.
- **Screen**: `/admin/ai` (Admin page par "AI Jobs" button) — health badge, har key live, jobs progress/ETA/current Q + pass, review Accept/Reject, Undo, "AI System Check".

## Migration
`backend/prisma/migrations/20261015100000_ai_job_engine/migration.sql` (IF NOT EXISTS, re-run safe). deploy.sh me `prisma migrate deploy` chalta hai.

## Env (sab optional)
`AI_JOB_WORKER=off` (worker band), `AI_MODEL_HEALTH=off`, `OPENAI_BASE_URL/OPENAI_API_KEY/OPENAI_MODEL`. Badalne ke baad `docker compose up -d --force-recreate backend`.

## Deploy
`cd /opt/ssc-prep-hub && git fetch origin && git reset --hard origin/main && docker compose up -d --build`

## Tests (server par nahi, local/CI)
`cd backend && npm run test:unit` (jest, DB ke bina; mock OpenRouter server ke saath).
