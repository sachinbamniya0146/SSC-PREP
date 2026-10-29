# Phone check (Sachin) - sessions 23 to 34, 360 px wide, light AND dark

Nobody has looked at these screens on a phone yet. Take a screenshot for anything that looks wrong or cut off and send it. Do each point once in light mode and once in dark mode (phone setting).

## A. Practice sets (S23 - S27)
1. Open a chapter practice set, answer 2 - 3 questions, leave 2 - 3 SKIPPED, submit.
2. In the review, open a skipped question: the right option must be green and a line "Answer: X" must be there.
3. Do 2 - 3 practice sets of the same chapter: no question may repeat inside one set.
4. Result page of a mock: the question line must show `ID #...`.

## B. Mock exam (S21, S29, S33)
5. Start any full mock, answer a few, close the browser tab, open the mock again: same questions, answers still there, clock continues (resume).
6. In the exam top bar tap "📄 Paper": the questions of this section appear one under the other. Tap an option of question 5 without opening 1 - 4: it must become selected (check in the normal view). Mark one, clear one. "One by one" returns. "Review & Submit" opens the summary.
7. Switch to another app for a few seconds and come back: a notice "You left the test window" appears. After submit the result page shows the same count as a grey note.
8. Open the CGL sectional page (`/cgl-test`), start, answer 3 questions, wait 3 seconds (autosave), then REFRESH the page: the SAME questions come back and the 3 answers are still ticked.

## C. Result page (S32)
9. Top of the page: score, rank, percentile, then the section-wise table. The table must fit the screen without sideways scrolling; tap a number in it: the review list below filters to those questions.
10. Topic bars: label and "x/y . z%" must not squeeze the bar to nothing.
11. An attempt made through the practice flow (a non-timed practice set) shows "practice" on the rank card (no rank).

## D. Admin (S31)
12. Admin -> Questions -> edit a question that students already answered -> change the correct option -> Save: an amber banner "N finished attempt(s) answered this question with the old key" appears. Tap "Re-score these attempts": a green line says how many were re-scored. Open one of those students' results: "Score corrected: before -> after" with the note.
   (Do this on a test question first; it changes real scores and writes an audit-log row.)

## E. Question report dialog (text field)
13. In the exam tap "Report" on a question, type something: with the soft keyboard open the Send button must stay reachable.

## F. Date-wise PYQ mocks: students see year + shift + Set, never the date (S34 - S40)
14. Open `/mocks` on the phone: PYQ mocks are named like `SSC CGL 2025 · Tier 1 · Shift 2 · Set 1`. No day / month anywhere (not in the title, not in the small description line).
15. Open `/year-wise` (and `/question-bank` -> PYQ): the choice is Year -> Shift. After a year the shifts appear; no exam date and no paper code like `SSC-CGL-T-I-12-Sep-2025-S2` on any question card.
16. Start one such mock, submit, open the result page and the history list: the title is the same (year + shift + Set). The Telegram / PDF result (if you get one) shows the same title, no date.
17. Search (top search box) for a word from a PYQ question: the result card shows year and shift only.
18. Two papers of the same year and shift (two different dates): they appear as `Set 1` and `Set 2`, in the order they were uploaded.

## G. Admin: one Excel for PYQ + practice (S37 - S39)
19. Admin -> Uploads -> "PYQ + Practice Excel Template": opens in Excel / Sheets with 34 columns, dropdowns in examId / subjectId / chapterId / correctAnswer / shift / examTier.
20. Fill 2 PYQ rows (year + examDate + shift) and 2 practice rows (no year), tick "Check only", press "Upload PYQ + PRACTICE (ek Excel)": the report shows `PYQ rows: 2 - Practice rows: 2`, the practice plan table with "pehle se" numbers, and (if questionNo is blank) one amber line - no red error.
21. Admin -> Exams -> "Add common exams": Selection Post / Railway ... appear; press it again: "Nothing new to create".
22. Admin -> Questions -> Add: choose a chapter and topic: the panel "Is chapter / topic me pehle se ye questions hain" opens with PYQ / Practice counts; type a word of a known question: it is found (duplicate check by eye).
23. Admin -> Coverage -> "Practice 100 gauge": lowest topics first, bar N/100, Excel button downloads.
