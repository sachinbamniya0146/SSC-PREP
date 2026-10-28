# Marking presets (28 Oct 2026)

Ab har exam ka marking scheme (marks + negative) ExamPattern preset se aata hai, question ke 2 / 0.5 column se nahi.

Order: frozen section plan -> exam preset -> question ke apne marks/negativeMarks.

## Presets
OFFICIAL (SSC notice se verify): cgl-t1, cgl-t2-p1, cgl-t2-p2, chsl-t1, chsl-t2, mts, cpo-p1, cpo-p2, gd
SECONDARY ("NOT VERIFIED" badge, notice se match karke hi apply karo): steno, je-p1, je-p2, selection-post
Exact list/numbers: backend/src/common/exam-presets.ts. JHT seed nahi kiya.

## Deploy ke baad
1. `docker compose exec backend node scripts/seed-patterns.mjs`   (sirf report, kuch change nahi)
2. Theek lage to `docker compose exec backend node scripts/seed-patterns.mjs --apply`
   (ya Admin -> Exam patterns -> "Official presets" -> Apply)
   `--only=cpo-p1,mts` se ek-do hi.
3. Backend cache 5 min me refresh hota hai (admin se apply karo to turant).

## Dhyan do
- CPO/Steno/JE patterns 200Q ho jayenge -> keyed PYQ paper complete tab gina jayega jab 200 Q hon.
- MTS: Session I me negative 0, Session II me 1 (per-section negative).
- Submit ho chuke scores change nahi hote. Practice/quiz mode same rahe.
- Pattern edit page me naya field "Minus per wrong (blank = pattern)".
