# S37 - Ek Excel = PYQ + Practice (29 Oct 2026)

## Kya badla
- **Row-level PYQ / Practice**: row me `year` ya `examDate` hai => PYQ (date-wise mock me judta hai). Dono nahi => Practice. Practice row ka shift / paperCode / examDate / examTier / tierPaper / questionNo apne aap hat jata hai (galti se bhara ho tab bhi ghost paper nahi banta).
- **Naya template**: `GET /bank/admin/upload/template/pyq-practice` (Admin -> Uploads -> "PYQ + Practice Excel Template"). 34 columns (Master Package wale hi, usi order me), dropdowns (examId, subjectId, chapterId, correctAnswer, difficulty, shift Shift 1-4, examTier, tierPaper), Examples sheet (1 PYQ + 1 practice row), Reference IDs (Exam / Subject / Chapter / Topic / Sub-topic).
- **Naya upload button**: "Upload PYQ + PRACTICE (ek Excel)" (`kind=mixed`; PYQ aur Practice dono permission chahiye).
- **Check only (dry-run) ab batata hai**: PYQ rows / Practice rows, har chapter-topic-subtopic me kitne practice (target 100, pehle se kitne, kam kitne), kaun si rows me Hindi nahi, kaun se exam database me nahi (ek baar, grouped).
- **questionNo khali** chalega: ek hi warning ("N PYQ rows without questionNo - upload order"). Compilation ka serial number mat bharo.
- **Exam lookup**: examId me slug, code ya naam chalega; `exam-cgl` aur `cgl` dono. Nahi mila to saaf message: "pehle Admin -> Exams me banao".
- **Admin -> Exams -> "Add common exams"**: Selection Post, GD, Steno, JE, Delhi Police, RRB NTPC / Group D / ALP / JE ek click me (jo hai use skip karta hai). Marking scheme (ExamPattern) alag se.
- `year` galat (jaise "abc" ya 1800) ho to "Invalid year" error.
- Fix: multi-file upload me papers / pending list merge nahi hoti thi (result me paper list khali dikhti thi) - ab judti hai.

## Students ko date kabhi nahi dikhti
Is session me student-side koi API/page change nahi hua. (S40 me poora grep audit.)

## Tests
`row-kind`, `exam-ref`, `common-exams`, `upload-preview`, `practice-template.mixed`, `bank-upload-job.mixed` specs + purane specs: sab pass.
Sandbox runner: `scripts/audit/nest-stubs-job.cjs` + `xlsx-lite.cjs` + `mock-search.cjs` (job-service specs ab chalte hain).
