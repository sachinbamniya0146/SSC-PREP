# PROMPT FOR HERMES — Bilingual question enhancement (SSC Prep Hub)

Copy everything inside the block below and give it to Hermes.

---

```
You are enhancing the SSC Prep Hub question bank: add accurate HINDI translations
and DETAILED bilingual solutions to the questions in the LIVE database, in safe batches.

REPO (Mac): ~/ssc-prep-hub
SERVER:     ssh -o IdentitiesOnly=yes -i "$HOME/Downloads/ssh-key-2026-08-21.key" ubuntu@140.245.202.120
On server the project is at /opt/ssc-prep-hub and the backend container is "ssc-backend".

There are three helper files in the repo at:
  backend/scripts/translation/GOLD_TEMPLATE.json     ← THE STANDARD. Study it first.
  backend/scripts/translation/export-questions.mjs   ← pulls a batch out of the DB
  backend/scripts/translation/import-translations.mjs ← writes the filled batch back

STEP 0 — Make sure the server has the latest scripts:
  ssh ...server...
  cd /opt/ssc-prep-hub && git pull

STEP 1 — EXPORT one batch from the database (read-only, changes nothing):
  cd /opt/ssc-prep-hub
  docker cp backend/scripts/translation/export-questions.mjs ssc-backend:/app/export-questions.mjs
  docker exec -e MODE=missing -e LIMIT=200 -e OFFSET=0 ssc-backend node /app/export-questions.mjs
  docker cp ssc-backend:/app/questions-to-translate.json ./questions-batch-0.json
  (MODE=missing = only questions still missing Hindi or a solution.
   For the next batch use OFFSET=200, then 400, etc. The script prints the next OFFSET.)

STEP 2 — STUDY the format:
  Open backend/scripts/translation/GOLD_TEMPLATE.json. It has 4 fully-worked examples
  (General Awareness, Analogy, Coding-Decoding, Quantitative). Match that exact format
  and that level of detail.

STEP 3 — FILL questions-batch-0.json. For EVERY question object, fill ONLY these:
  • "questionTextHindi" — correct, natural Hindi translation of the English question.
  • each option's "textHi" — Hindi of that option (keep "key", "text", "isCorrect" as they are).
  • "explanation" — DETAILED step-by-step English solution (the rule/formula, the working,
    why the answer is correct; mention why other options are wrong when useful).
  • "explanationHindi" — the same detailed solution in Hindi.

  HARD RULES (breaking these causes wrong data):
  • NEVER change "id", "questionText", option "text", option "isCorrect", or "correctAnswer".
  • NEVER invent a different answer. The answer in the file is already verified from the DB.
    If you think it is wrong, write your doubt inside the explanation — do NOT change the field.
  • If a question needs a FIGURE/IMAGE you cannot see (mirror image, embedded/counting figure,
    non-verbal series, etc.), add  "needsImageReview": true  to that question and leave its
    solution blank. Do not guess a solution.
  • Hindi must be clean and readable (not broken machine Hindi). Keep numbers/symbols/formulae.

STEP 4 — PREVIEW the import (no writes yet):
  docker cp questions-batch-0.json ssc-backend:/app/questions-batch-0.json
  docker cp backend/scripts/translation/import-translations.mjs ssc-backend:/app/import-translations.mjs
  docker exec -e DRY_RUN=1 ssc-backend node /app/import-translations.mjs /app/questions-batch-0.json
  Read the summary. "ANSWER MISMATCH" or "not found" counts should be 0. If not, fix the file.

STEP 5 — REAL import:
  docker exec ssc-backend node /app/import-translations.mjs /app/questions-batch-0.json
  The script sets translationStatus=AUTO_UNVERIFIED, explanationSource=AI_GENERATED,
  reviewStatus=IN_REVIEW and never touches answers.

STEP 6 — VERIFY on the site: once a question has Hindi, it becomes visible in the bilingual
  question bank on https://sscprephub.in . Spot-check a few.

STEP 7 — NEXT batch: repeat Steps 1–6 with OFFSET increased by 200 each time, until the
  export script reports "That was the last batch".

Report after each batch: how many updated, and any answer-mismatch / image-review cases.
```

---

## Notes for you (Sachin)
- **Pehle push karo:** commit + push the `backend/scripts/translation/` folder from your Mac so `git pull` on the server gets these files.
- **Safe by design:** the import can only *add* Hindi + solutions. It cannot change any answer or English text, and it skips anything suspicious.
- **Review:** every enhanced batch file (`questions-batch-N.json`) is plain JSON you can open and double-check before Step 5.
