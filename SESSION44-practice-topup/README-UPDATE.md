# S44 - Practice set kabhi chhota/khali nahi (naye exams ke liye) (29 Oct 2026)

## Kami
Practice set exam ke badge se banta tha: kisi exam (RRB, Banking ...) ke us topic me apne 3 hi practice sawal hon to student ko 3 sawal ka
set milta (ya "not available"), jabki usi topic ke CGL wale 300 practice sawal pade the. Practice syllabus ka hota hai, exam ka nahi.

## Ab
- Exam ke apne practice sawal **pehle**, kam pade to **usi subject / chapter / topic / sub-topic** ke doosre exams ke practice sawal set ko
  poora karte hain (level-balanced Easy -> Hard). Jis exam ke paas apne poore sawal hain, uska set bilkul pehle jaisa.
- Practice page ki exam list me band (inactive) exam nahi dikhta.
- PYQ kabhi practice me nahi aate (weak-topic wala purana fallback jaisa tha waisa).

## Excel upload audit (kuch nahi toota, notes)
- Naya subject / chapter (General Science, Physics ...) upload se pehle **syllabus import** zaroori hai - warna "chapterId not found".
  Admin -> Exam Patterns preset plan bhi yahi warning deta hai.
- Hindi subject ke sawal: question / options Hindi me hi; `questionText` aur `questionTextHindi` dono me wahi Hindi text (Master Package v5
  section 11C). Upload Devanagari ko `questionText` me reject nahi karta.
- Practice row me bhi `examId` zaroori hai (practice page sab exams ke practice dikhata hai, isliye koi bhi sahi exam chalega).

## Tests
`question-bank-practice.topup.spec` (3 apne + 7 doosre; poore apne = koi borrow nahi; doosra exam nahi = purana chhota set).
`scripts/audit/nest-stubs-job.cjs` ab practice service ko bhi asli load karta hai (sirf sandbox tool).
