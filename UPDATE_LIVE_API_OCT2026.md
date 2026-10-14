# Oct 14 2026 - API keys REAL-TIME working + live status

Problem: key daalne ke baad kaam turant shuru nahi hota tha (keys-busy hone par sawal 30 min ke liye "later" me chale jaate the),
worker 1-5 question karke 45 s so jata tha, aur koi live status nahi tha.

## Ab
1. Key add / OFF->ON / "Test key" pass hote hi PYQ date mapping TURANT jaag jati hai (pending sawal ka wait khatam).
2. Worker queue khatam hone tak lagatar chalta hai (ek run me max 150 question / 25 min), 45 s ka gap nahi.
3. Sabhi keys busy ho to 3 min rest (pehle 8 min) - aur nayi key aate hi rest turant khatam.
4. Admin -> API Keys: "Live status" (har 3 s): har key = Kaam kar rahi / Rest (kitne sec) / Ready / OFF,
   kaun si feature + kaun sa free model + kitne sec se, abhi-abhi ki calls, aur PYQ worker (Q#, pass, search ya AI, is run ke counters).
5. Admin -> PYQ Date Mapping: worker "search ho raha / AI padh raha" stage, run counters, 3 s refresh; settings box ab har refresh par reset nahi hota;
   "Abhi chalao" ab queue khatam hone tak chalata hai.

## Files
backend/src/admin-api-keys/admin-api-keys.service.ts, backend/src/ai-provider/ai-provider.service.ts + controller (GET /admin/ai/live),
backend/src/pyq-dates/pyq-date.service.ts, frontend/src/app/admin/api-keys/page.tsx, frontend/src/app/admin/pyq-dates/page.tsx
No migration, no new env.

## Deploy (VPS)
cd /opt/ssc-prep-hub && git fetch origin && git reset --hard origin/main && docker compose up -d --build
