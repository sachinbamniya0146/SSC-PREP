# S42 - Railway / Banking / Defence / State Police ke marking patterns (29 Oct 2026)

Admin -> Exam Patterns -> **Official presets** ab 27 naye exams/papers bhi dikhata hai. Pehle exam banao (Admin -> Exams -> Exam catalog),
phir "Apply". Har preset ke saath source likha hai. Sab **SECONDARY** hain (coaching / SATHEE page se padhe, notice PDF yahan se nahi khula) -
apply karne se pehle current notice se ek baar milao. Kuch bhi andaze se nahi likha.

| Exam | Paper | Q | Marks | Time | Negative |
|---|---|---|---|---|---|
| RRB NTPC | CBT 1 (GA 40, Maths 30, Reasoning 30) | 100 | 100 | 90 | 1/3 |
| RRB NTPC | CBT 2 (GA 50, Maths 35, Reasoning 35) | 120 | 120 | 90 | 1/3 |
| RRB Group D | CBT (Science 25, Maths 25, Reasoning 30, GA 20) | 100 | 100 | 90 | 1/3 |
| RRB ALP | CBT 1, CEN 01/2026 (Maths 25, Reasoning 25, Science 25) | 75 | 75 | 60 | 1/3 |
| RRB Technician Gr III | CBT (Maths 25, Reasoning 25, Science 40, GA 10) | 100 | 100 | 90 | 1/3 |
| RRB JE | CBT 1 (Maths 30, Reasoning 25, GA 15, Science 30) | 100 | 100 | 90 | 1/3 |
| RRB JE | CBT 2 (GA 15, Phy+Chem 15, Computer 10, Environment 10, Technical 100) | 150 | 150 | 120 | 1/3 |
| RPF Constable / SI | CBT (GA 50, Arithmetic 35, Reasoning 35) | 120 | 120 | 90 | 1/3 |
| IBPS PO / IBPS Clerk / SBI Clerk / RBI Assistant / NIACL AO / NIACL Assistant | Prelims (English 30, Quant 35, Reasoning 35; 20 min each, sectional lock) | 100 | 100 | 60 | 0.25 |
| SBI PO | Prelims 2025 (English 40, Quant 30, Reasoning 30; 20 min each) | 100 | 100 | 60 | 0.25 |
| IBPS RRB PO / RRB Clerk | Prelims (Reasoning 40, Quant 40; one 45-min timer) | 80 | 80 | 45 | 0.25 |
| RBI Grade B | Phase I (GA 80/25 min, Reasoning 60/45, English 30/25, Quant 30/25) | 200 | 200 | 120 | 0.25 |
| UPSC CDS | Paper I English / II GK (120 Q each), III Elementary Maths (100 Q) | | 100 each | 120 each | 1/3 of marks |
| UPSC NDA | Paper I Maths (120 Q, 300) / II GAT (English 50 Q 200 + GK 100 Q 400) | | | 150 each | 1/3 of marks |
| UP Police Constable | GK 38, Hindi 37, Numerical 38, Reasoning 37 | 150 | 300 | 120 | 0.5 |
| UP Police SI | Hindi / Law-Constitution-GK / Numerical / Reasoning, 40 each | 160 | 400 | 120 | 0 |
| Delhi Police Constable | GK 50, Reasoning 25, Numerical 15, Computer 10 | 100 | 100 | 90 | 0.25 |

**Jaan-boojh kar nahi daala** (sources me farq tha ya section split nahi mila): RRB ALP CBT 2, banking/insurance **Mains**,
LIC AAO/Assistant, AFCAT, Agniveer, Coast Guard, CAPF AC, Delhi Police Head Constable, Bihar/Rajasthan/MP/Haryana Police, SSC JHT.
Inke liye Admin -> Exam Patterns me haath se pattern banao (notice dekh kar).

## System changes
- `classifyPatternName`: "CBT 1", "Prelims", "Phase I", "Stage I" = Tier 1; "CBT 2", "Mains", "Phase II" = Tier 2 (pehle sirf "Tier 1/2").
- `findPatternForPaper`: jis exam ke patterns me tier hai hi nahi (Group D, RPF, UP Police ...), uske Tier 1 PYQ papers ab wahi pattern lete hain.
  Pehle 120 sawal ka RPF paper 100 par kat jaata.
- Preset plan me warning: section ka subject (General Science, Mathematics, Hindi) database me nahi hai to "syllabus import pehle karo".
- Naye subjects: `general_science`, `hindi`, `mathematics` (S43 syllabus workbook se banenge; `sub-...` spelling bhi chalegi).
- Marks per question ab 4 decimal tak (`marking.ts`): CDS me 100 marks / 120 sawal - pehle poora sahi paper 99.96 aata, ab 100.

## Tests
`marking.spec` (har naye preset ke marks / negative / total ek alag table se dobara likhe aur milaye), `exam-presets.catalog.spec` (har preset: sections ka jod = total, naam ka tier = match, lock wale me har section ka timer, koi do preset ek hi
paper par nahi) + purane preset/builder specs pass.
