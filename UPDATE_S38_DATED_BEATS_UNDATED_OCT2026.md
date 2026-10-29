# S38 - Dated copy undated ko replace kare; dusre paper ka same question turant dono me (29 Oct 2026)

## Rules (`backend/src/bank/auto-publish.util.ts`, `decideAuto`)
1. **Dated beats undated**: same exam + same year + same question, nayi copy me exam date hai aur purani copy me date nahi => purani hide, nayi publish (KEEP_NEW). Shift / tier / tierPaper / paperCode nayi copy me bhare ho sakte hain, par purani copy me wo khali hona chahiye (agar purani me shift pehle se hai aur alag hai to wo alag paper hai => KEEP_BOTH).
   Ulta: purani copy dated hai aur nayi undated => purani rahegi (KEEP_EXISTING).
2. **Dusre paper ka same question**: sirf paper details (shift / date / tier / year / examId / paperCode) ya solution/questionNo alag => KEEP_BOTH **turant** (24h wait nahi). Question text alag ho to pehle jaisa 24h wait.
3. **Hamesha insaan decide kare**: correctAnswer, options ya questionText badla ho (dated-undated me bhi).
4. Practice copy (year nahi) PYQ se replace nahi hoti: dono rehte hain.
5. Har auto decision pehle jaisa "Auto" mark hota hai aur Undo se wapas hota hai.

## Code
- `auto-publish.util.ts`: `SideInfo` me shift/examTier/tierPaper/paperCode; `AutoDecision.immediate`; `datedVersusUndated()`.
- `auto-publish.service.ts`: do pass (waiting-time wale + "immediate" wale, `differences array_contains`), Question se naye fields padhta hai, preview me `dueByTime`.
- Duplicates page ka text update.

## Tests
`auto-publish.util.spec.ts` (19) + `scripts/audit/autopublish-sim.cjs` (S1-S6 ALL OK).
