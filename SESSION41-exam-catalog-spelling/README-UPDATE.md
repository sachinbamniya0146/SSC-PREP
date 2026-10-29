# S41 - Saare exams ka catalog + "reasoning" / "sub-reasoning" ek hi subject (29 Oct 2026)

## 1. Ek hi subject / exam do spelling me (sabse badi kami)
Project me same subject do naam se bante hain:
- app ke seeds / code: `reasoning`, `quantitative_aptitude`, `english`, `general_awareness`; exam `cgl`, `chsl` ...
- Master Package / Excel Reference IDs: `sub-reasoning`, `sub-quantitative_aptitude`, `sub-english` ...; exam `exam-cgl` ...

Excel upload sawal ko sheet wale naam (`sub-...`) me save karta tha, par **mock, sectional mock, daily test, study-plan test, PDF export,
pattern health** code wale naam (`reasoning`) se sawal dhoondte the. Nateeja: sawal upload ho jaata par mock me nahi aata / "Subject not found",
strict-timer mock me `sub-...` wala sawal **aakhri section** me chala jaata, aur marks/negative galat section ke lagte.
English ke bina-Hindi sawal sirf `english` slug par chhoot paate the - `sub-english` par chhupe rehte the.

Ab ek **core key** (`common/slug-core.ts`): `exam-cgl` = `cgl`, `sub-reasoning` = `reasoning` = `Reasoning`.
- `tests.service` (full mock, sectional mock + resume), `daily-test`, `study-plan-v2` (subject weights, exam subjects), `admin` pattern health,
  `pyq-paper-builder` (subject-wise count), `section-plan` (sawal kis section ka), `marking` (marks/negative), `exam-presets` sync:
  dono spelling ek maane jaate hain.
- English exemption (Hindi zaroori nahi) har spelling par: `HINDI_EXEMPT_SUBJECT_FILTER` - 11 jagah badla (mocks, year-wise, weak practice,
  daily, study plan, PDF export, health, sectional subject list SQL, admin "Add question").
- Excel upload: `subjectId` me exact slug pehle, phir doosri spelling ya subject ka naam (`Quantitative Aptitude`) bhi chalega.

## 2. Exam catalog - sabhi exams, students ko sirf jinke sawal hain
Admin -> Exams -> **Exam catalog**: 44 exams, 6 group:
- SSC: CGL, CHSL, MTS, CPO, GD, Steno, JE, Selection Post, JHT, Delhi Police Constable, Delhi Police Head Constable
- Railway: RRB NTPC, Group D, ALP, Technician, JE, RPF Constable, RPF SI
- Banking: IBPS PO, IBPS Clerk, IBPS RRB PO, IBPS RRB Clerk, SBI PO, SBI Clerk, RBI Assistant, RBI Grade B
- Insurance: LIC AAO, LIC Assistant, NIACL AO, NIACL Assistant
- Defence: UPSC CDS, UPSC NDA, UPSC CAPF AC, AFCAT, Agniveer Army / Air Force / Navy, Coast Guard Navik
- State Police: UP Police Constable, UP Police SI, Bihar / Rajasthan / MP / Haryana Police Constable

Checkbox se chuno ya "Add all missing". Jo pehle se hai (slug / code / naam, `exam-` ke saath ya bina) dobara nahi banta.

**Students ko kya dikhta hai**: `GET /bank/meta` ab sirf wahi exam deta hai jo Active hai **aur** jisme kam se kam 1 published sawal hai.
Pehla sawal live hote hi exam apne aap dikhne lagta hai. Admin screens (`allExams`) me sab exams rehte hain. Exam list me har exam ke saath
"students see it" / "hidden until it has published questions" likha aata hai.

## 3. Syllabus Excel import (Admin -> Topics -> Bulk Syllabus Import)
- Subject ab dono spelling / naam se milta hai; jis row me pehle se chapters hain wahi chuna jaata hai (khali duplicate par syllabus nahi chadhta).
- Chapter: same naam ka chapter dobara nahi banta (pehle `Percentage` ek aur ban jaata tha `chap-percentage-quantitative_aptitude` ke bagal me).
- Naya subject / chapter database ki spelling follow karta hai (`sub-general_science`, `chap-physics-general_science`).
- Sirf wahi sheet padhi jaati hai jiske row 4 me header (S.No. | Chapter No. | Chapter | Topic | Sub-Topic) ho - info sheets skip.

## Tests
`slug-core` (5), `common-exams` (6), `syllabus-import-plan` (6), `taxonomy-import.spelling` (2, fake DB + asli workbook) + saare purane specs.
Sandbox: 453 pass; 2 purane sandbox-only fail (excel-sheet `__name`, taxonomy-dedupe message) S40 par bhi wahi.
