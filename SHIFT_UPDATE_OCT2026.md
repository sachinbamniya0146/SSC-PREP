# Shift auto-normalise (Oct 2026)

Admin kuch bhi likhe -> DB me hamesha `Shift 1 / Shift 2 / Shift 3` save hota hai.

| Admin likhe | Save hota hai |
|---|---|
| morning, subah, 9:00 AM, 1, S1, 1st shift, Shift-1 | Shift 1 |
| afternoon, dopahar, 12:30 PM, 2, Shift 2 | Shift 2 |
| evening, shaam, 4 PM, 3, Shift 3 | Shift 3 |
| Shift 4 (sirf jab number likha ho) | Shift 4 |
| samajh na aaye (e.g. "Batch B") | jaisa likha waisa hi (data loss nahi) |

Jahan lagaya: Excel/CSV/JSON/Word upload, single question add, question edit, bulk exam/year/shift badlav, PDF ingestion.
Naya file: backend/src/common/shift.ts (frontend copy: frontend/src/lib/shift.ts).
Purana data: `cd backend && npx ts-node scripts/normalize-shifts.ts` (dry run), phir `--apply`.
