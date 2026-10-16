# UPDATE A2 — 24x7 Self-healing AI (ZIP 1, pehle apply karo)

## Kya naya
- Boot report + watchdog (stuck item 12 min → requeue/FAIL), wedged worker release, deep `GET /api/v1/health` (db/redis/ai; 503 sirf DB down par), compose healthcheck, deploy.sh healthy-wait.
- Key pool: 401/402/403/429 ke saaf Hinglish admin messages, "all keys exhausted" alert 24h dedupe, keys kabhi log nahi (redact), live quota (GET /key).
- Model routing: success-rate + latency ranking, prompt cache, overall deadline (AI_CALL_DEADLINE_MS), pacing.
- Quality gates: golden-set benchmark, Hindi back-translation, solution↔key mismatch → review, low confidence → review, confidence note.
- Observability: Admin → AI me "Quality + stats (7 din)" panel, per-key problem/quota, fail reasons.
- Student explanation hardening: rate limit 6/10min, singleflight, contradict-key output save nahi hota, existing explanation overwrite nahi.
- PYQ date mapping: real search APIs (Brave / Google CSE / SearXNG) pehle; date tabhi accept jab evidence me literally ho; future dates reject.

## FREE search (v2) — Brave ki limit ka hal
- Naya `searxng` container (docker-compose.yml + docker-compose.prod.yml): self-hosted, FREE, koi API key nahi, koi daily limit nahi (VPS se hi search). Sirf docker network ke andar, public port nahi. Config: `searxng/settings.yml`.
- Backend ko `SEARXNG_URL=http://searxng:8080` compose se mil jaata hai (.env me kuch daalna zaruri nahi).
- Search order: SearXNG -> Brave -> Google CSE (agar keys hain) -> DuckDuckGo -> Bing. Kisi API ka quota khatam (401/402/403/429) ho to wo 1 ghante ke liye skip, wasted calls nahi.
- Optional: .env me `SEARXNG_SECRET=<koi lamba random string>`.
- Check: Admin → PYQ dates → Test search: engine `searxng` dikhna chahiye.

## Migration
None needed (Prisma schema change nahi).

## Kill switches / env (sab optional)
AI_JOB_WORKER=off, AI_KEY_REVIVE=off, AI_MODEL_HEALTH=off, AI_CALL_DEADLINE_MS (1000–900000, default 150000), AI_MIN_CONFIDENCE (default 0.6),
OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL (gateway), BRAVE_SEARCH_API_KEY, GOOGLE_CSE_KEY + GOOGLE_CSE_CX, SEARXNG_URL.

## Files (old → new lines)
| file | old | new |
|---|---|---|
| backend/src/admin-api-keys/admin-api-keys.service.ts | 576 | 579 |
| backend/src/ai-explanation/ai-explanation.service.ts | 401 | 403 |
| backend/src/ai-explanation/ai-explanation.util.ts | NEW | 56 |
| backend/src/ai-explanation/ai-explanation.util.spec.ts | NEW | 38 |
| backend/src/ai-jobs/ai-job.controller.ts | 122 | 154 |
| backend/src/ai-jobs/ai-job.logic.ts | 261 | 337 |
| backend/src/ai-jobs/ai-job.logic.spec.ts | 99 | 151 |
| backend/src/ai-jobs/ai-job.runner.ts | 338 | 374 |
| backend/src/ai-jobs/ai-job.runner.spec.ts | 120 | 158 |
| backend/src/ai-jobs/ai-job.service.ts | 843 | 940 |
| backend/src/ai-jobs/ai-jobs.module.ts | 16 | 17 |
| backend/src/ai-jobs/ai-ops.service.ts | NEW | 143 |
| backend/src/ai-provider/ai-provider.integration.spec.ts | 266 | 327 |
| backend/src/ai-provider/ai-provider.service.ts | 622 | 691 |
| backend/src/ai-provider/ai-provider.util.ts | 86 | 165 |
| backend/src/ai-provider/ai-provider.util.spec.ts | 44 | 80 |
| backend/src/health/health.controller.ts | 17 | 64 |
| backend/src/health/health.controller.spec.ts | NEW | 29 |
| backend/src/pyq-dates/pyq-date-search.service.ts | 433 | 508 |
| backend/src/pyq-dates/pyq-date-search.spec.ts | NEW | 45 |
| backend/src/pyq-dates/pyq-date.util.ts | 436 | 438 |
| deploy.sh | 130 | 136 |
| docker-compose.yml | 141 | 177 |
| frontend/src/app/admin/ai/page.tsx | 236 | 273 |
| docker-compose.prod.yml | 149 | 178 |
| searxng/settings.yml | NEW | 23 |

## Verification
Tested (real run): backend tsc 0 errors; 106 unit/integration tests pass (mock OpenRouter: deadline, 403/401, cache, quota, latency); lint = pristine baseline (80 pre-existing, meri files clean); frontend tsc 0 errors; deploy.sh bash -n; compose YAML parse.
Sirf padha (test nahi): real VPS/DB, real Nest boot timers, real OpenRouter/search engines, browser UI.
