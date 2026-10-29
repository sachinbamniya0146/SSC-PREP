# S45 - Master Package chapter IDs + khali duplicate subjects (29 Oct 2026)

Server ke database check se pata chala (29 Oct):
- subjects / exams bina prefix ke hain: `reasoning`, `quantitative_aptitude`, `english`, `general_awareness`, `hindi`, `computer`; exams `cgl`, `chsl` ...
- chapters bhi bina prefix ke: `percentage`, `alphabet-series`, `static_gk`, `active_passive_voice` ...
- 4 purane syllabus-import ke duplicate subjects (0 sawal, par chapters ke saath): `general-intelligence-reasoning` (28),
  `quantitative-aptitude-maths` (22), `general-awareness-general-knowledge` (13), `english-language-comprehension` (12).

## Fix 1 - `chap-...` IDs ab chalte hain
Master Package / AI Excel me chapterId `chap-percentage-quantitative_aptitude` likhta hai, database me chapter `percentage` hai -> pehle
"chapterId not found". Ab upload (aur "Check only" preview) is form ko chapter ke naam / slug se milata hai, pehle row ke subject ke
andar. `sub-...` (S41) + `chap-...` (S45) dono chalte hain. Chapter ka naam likhna bhi chalta hai.

## Fix 2 - khali subjects students ko nahi dikhte
Practice page sirf wahi subject dikhata hai jisme kam se kam 1 practice sawal ho. Upar ke 4 khali duplicate subjects ab students ko nahi
dikhenge; naya subject (General Science ...) apna pehla practice sawal aate hi dikhega. Database me kuch delete nahi hota.

## Syllabus import (S43 file) is database par kya karega
- Reasoning -> `reasoning` (53 chapter wala), Quant -> `quantitative_aptitude`, English -> `english`, GA -> `general_awareness`,
  Hindi -> `hindi`, Computer -> `computer`. Duplicate (`general-intelligence-reasoning` ...) ko nahi chhuta.
- Naye subject `general_science`, `mathematics` (bina `sub-`), naye chapter bina `chap-` (jaise `physics`) - database ki style.
  Workbook ki "New Reference IDs" sheet wale `chap-...` ids S45 ke baad upload me sahi chapter par jaate hain.
- Same naam ka chapter / topic dobara nahi banta.

## Tests
`slug-core.spec` (chap-id -> words), `upload-preview.chapter-ids.spec` (chap-id, slug aur naam ek hi chapter par).
