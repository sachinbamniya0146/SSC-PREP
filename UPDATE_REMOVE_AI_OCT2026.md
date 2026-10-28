# UPDATE — AI poora hataya (28 Oct 2026)

Ab site me koi AI feature nahi hai. Stored explanations / Hindi translations / dates jaise the waise dikhte hain.

## Hata diya
- Backend modules: `ai-explanation`, `ai-jobs`, `ai-provider`, `admin-api-keys` (+ unke specs). Kuch AI call/key/queue baaki nahi.
- PYQ date finder (internet search + AI voting) aur `pyq-date-search`. Dates ab sirf haath se: Admin -> PYQ Date Mapping.
- PDF import: AI chapter-suggest, AI explanation generate, vision-LLM fallback, LLM structuring. Text-layer + Tesseract OCR + Excel/Word upload waise hi.
- Question edit: "English -> Hindi" AI button. Study plan: OpenRouter call (ab rule-based). Profile: personal API key (`/users/me/openrouter-key`).
- Students ka "AI generate" aur "student voting" (SolutionVerify). Explanation ab sirf wahi dikhti hai jo question me save hai.
- Frontend pages: `/admin/ai`, `/admin/api-keys`, `/settings/api-key`.
- Infra: SearXNG container, OmniRoute compose/script/docs, `OPENAI_*` / `OPENROUTER_*` env vars. `deploy.sh` ab purane `ssc-searxng` / `ssc-omniroute` container hata deta hai.

## Naya / badla
- `GET /explanations/questions/:id` (+ `/available`): stored explanation, student ko pehle question attempt karna padta hai (answer leak gate pehle jaisa).
- PYQ Date Mapping screen: "Bina date" list se date + Tier khud daalo; purani auto rows accept / reject / badal sakte ho.

## Jaan-boojhkar NAHI chhua
- Database: koi table/column nahi hataya (`AiChange`, `AiUsageLog`, `AdminApiKey`, `AiJob*`, `users.openrouterApiKey`, `ExplanationVote`, `PyqDateMap/Config`). Data safe. Inko hatana ho to alag migration me, tumhari OK ke baad.
- `solver` module: ye deterministic math engine hai (LLM nahi), bank-upload verification isse chalta hai.
- Review status `AI_DRAFT` aur `aiConfidenceScore` (purane imported rows ka data).
- `openai` npm package `backend/package.json` me abhi bhi hai (lock file ke saath), code me use nahi hota; hatane ke liye `npm uninstall openai` laptop par chalana padega.
- Admin Help ke "ready-to-use AI prompts" (ChatGPT me khud paste karne ke liye text) aur `docs/` ki purani files.
