# Oct 14 2026 - Duplicate Review: UNDO (real working)

Admin -> Question Manager -> Duplicate Review -> "Ho chuke" tab:
- Har resolved item par "Undo (decision wapas lo)" button.
- Checkbox + "Selected: Undo" aur "Is list ke sabhi N: Undo" (bulk, 40 sec ke tukdon me, timeout nahi).
- Filter: Sab / Naya rakha / Purana rakha / Dono rakhe.
- Upar ek peela banner bhi: "Galti se decision/publish ho gaya? ... Undo".

Undo kya karta hai
| Decision tha | Undo me |
|---|---|
| Naya rakha (upload) | naya (publish hua) question hide + pending, purana (hide hua) wapas LIVE, review wapas Pending |
| Dono rakhe (upload) | naya question hide, review wapas Pending |
| Purana rakha (upload) | kuch save nahi hua tha - review wapas Pending |
| Bank scan: A/B rakha | jo hide hua tha wo wapas live, review Pending |

- Kal raat ke 1178 purane resolved ke liye bhi chalega (naya question searchHash + time + audit log se dhoondha jata hai).
  Agar kisi ka naya question na mile to us row me kuch change nahi hota, error dikhta hai (half-undo nahi).
- Undo ke baad review Pending me aata hai - phir chahe to dobara "Purana rakho" ya "Dono rakho" chuno.
- PYQ mock aur caches apne aap refresh hote hain. No migration, no env.

Backend: POST /bank/admin/duplicates/:id/undo, POST /bank/admin/duplicates/bulk-undo, GET ...?status=RESOLVED&resolvedStatus=KEPT_NEW
Files: backend/src/bank/duplicate-review.service.ts + controller, frontend/src/app/admin/questions/duplicates/page.tsx
