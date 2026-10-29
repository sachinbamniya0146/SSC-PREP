# S43 - Sabhi exams ka syllabus (subject / chapter / topic / sub-topic) (29 Oct 2026)

File: `docs/syllabus/SSC_PrepHub_Syllabus_All_Exams_v1.xlsx` (Master Package v5 me bhi hai).
Import: **Admin -> Topics -> Bulk Syllabus Import -> ye file**. Dobara import safe (test: doosri baar 0 naye rows).

## Kya judta hai
| Subject | Naya? | Chapters | Topics | Sub-topics | Practice target (100 / leaf) |
|---|---|---|---|---|---|
| General Science (`sub-general_science`) | NAYA | 4 (Physics, Chemistry, Biology, Environment and Ecology) | 32 | 118 | 11,800 |
| Mathematics (`sub-mathematics`, NDA class 11-12) | NAYA | 9 | 22 | 48 | 4,800 |
| Computer Knowledge (`sub-computer`, pehle 0 chapter) | chapters | 7 | 14 | 28 | 2,800 |
| Reasoning | +4 (Inequality, Input-Output, Statement-Course of Action, Cause and Effect) | | 5 | 7 | 700 |
| Quant | +5 (Quadratic Equations, Number Series, Permutation and Combination, Probability, Statistics) | | 7 | 12 | 1,200 |
| English | +1 (Para Jumbles) | | 1 | 2 | 200 |
| General Awareness | +10 (Banking and Financial Awareness, Insurance Awareness, Defence, Basic Law, UP / Bihar / Rajasthan / MP / Haryana / Delhi GK) | | 44 | 29 | 5,900 |
| Hindi | "Vyakaran" me 15 topic (Sandhi, Samas ... Chhand) + Hindi Sahitya, Apathit Gadyansh | | 19 | 10 | 2,400 |

Har naam English + Hindi (Unicode Devanagari). Pehle se maujood chapter (jaise Vyakaran) ka Hindi naam nahi badalta; same naam ka topic
(jaise Sandhi) dobara nahi banta.

## Extra sheets (import me skip)
- **Exam Syllabus Map**: 44 exams -> stage/paper -> section -> subjectId -> kaun se chapters. AI isi se kisi bhi exam ke PYQ ko sahi
  subject/chapter me daalta hai.
- **New Reference IDs**: import ke baad banne wale exact ids (`chap-physics-general_science` ...). Sandbox me asli importer chala kar
  milaya: 42/42 same. Excel upload me chapter ka naam bhi chalta hai.
- **Overview**: counts + practice target.

## Code
- Syllabus import: do subject ek hi naam ke aur dono khali hon to `sub-...` wala chuna jaata hai (Excel ke sawal wahi jaate hain).
- `scripts/audit/xlsx-lite.cjs`: shared strings + `&#NNNN;` padhta hai (asli Excel / openpyxl file sandbox test me khul sake). Sirf sandbox tool.
- Naya spec `taxonomy-import.workbook.spec.ts`: shipped workbook parse - 8 subject sheets, har topic/sub-topic ka Hindi naam, koi topic
  chapter me do baar nahi, existing chapter ka naam exact.

## Jaan-boojh kar nahi
General Engineering (Civil / Electrical / Mechanical) - SSC JE / RRB JE technical. Bahut bada syllabus; jab PYQ aayein tab alag file.
