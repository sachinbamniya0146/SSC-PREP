# UPDATE B — Practice Excel template + ID re-upload (ZIP 2, A2 ke baad)

## Kya naya
- `GET /bank/admin/upload/template/practice`: dropdowns (exam/subject/chapter, correctAnswer, difficulty), frozen header, Hinglish hints, Examples, Instructions, Reference IDs. Admin page par "⭐ Practice Excel Template" button.
- Upload me `id` column ho to row update hoti hai (duplicate nahi banta); id nahi mili → reject; same id file me 2 baar → DUPLICATE; khali cell = purani value rahegi; taxonomy re-upload se nahi badalti.
- Check-only (dry-run) preview: Updated / Jaisi thi waisi / row-by-row preview + "Questions dekhein" link.
- Export me `id` pehle se hai → export → edit → re-upload kaam karta hai.

## Migration
None needed. `npm ci` chalega (jszip ^3.10.1 declare hua, lock me pehle se tha).

## Files (old → new lines)
| file | old | new |
|---|---|---|
| backend/package.json | 88 | 89 |
| backend/package-lock.json | 10404 | 10405 |
| backend/src/bank/bank-template.ts | NEW | 176 |
| backend/src/bank/bank-template.spec.ts | NEW | 62 |
| backend/src/bank/practice-template.service.ts | NEW | 132 |
| backend/src/bank/practice-template.service.spec.ts | NEW | 35 |
| backend/src/bank/bank-upload-job.service.ts | 366 | 428 |
| backend/src/bank/bank-upload-job.controller.ts | 83 | 84 |
| backend/src/bank/bank-upload-job.id-update.spec.ts | NEW | 67 |
| backend/src/bank/bank-upload.controller.ts | 500 | 542 |
| backend/src/bank/bank.module.ts | 32 | 33 |
| frontend/src/app/admin/page.tsx | 1936 | 2004 |

## Verification
Tested: tsc 0 errors, specs pass (template, ID-update mock: check-only, real, conflict, double id), template openpyxl se validate (freeze, 5 validations, comments), frontend tsc 0, `npm ci --dry-run` OK.
Sirf padha: real DB par re-upload, Excel/LibreOffice me dropdown render, browser UI.
