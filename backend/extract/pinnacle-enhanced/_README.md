# pinnacle-enhanced — bilingual, solution-added reasoning questions

This folder holds the **enhanced** version of the raw `backend/extract/pinnacle/` reasoning
questions: every question here has a **Hindi translation**, **Hindi options**, a **verified answer
key**, and a **detailed step-by-step solution in both English and Hindi**.

The raw `pinnacle/` files have `q, a, b, c, d, exam, year, has_fig` but **no answer and no solution**.
Files here are produced by (a) deriving the answer by logic, (b) verifying it with code, and
(c) writing the bilingual solution. Answers that can't be proven (figure-based, or a question whose
derived answer matches no option) are flagged `needs_review: true` and left unanswered — never guessed.

## File format (one JSON array per category)

Same shape as Hermes's `import-pinnacle.mjs` expects, **plus** the `_hi` bilingual fields:

```json
{
  "book_q": 1,
  "q":      "English question text",
  "q_hi":   "प्रश्न का हिंदी अनुवाद",
  "exam": "SSC CGL", "date": "2023-07-14", "shift": "Shift 1", "year": 2023,
  "opt_a": "…", "opt_b": "…", "opt_c": "…", "opt_d": "…",
  "opt_a_hi": "…", "opt_b_hi": "…", "opt_c_hi": "…", "opt_d_hi": "…",
  "ans": "B",
  "expl_en": "detailed English solution (rule → working → why B)",
  "expl_hi": "वही विस्तृत हल हिंदी में",
  "trick_en": "", "trick_hi": "",
  "diff": "medium",
  "topic": "Reasoning — Coding-Decoding",
  "has_fig": false,
  "needs_review": false          // present + true only when the answer is uncertain
}
```

## How to import (bilingual — keeps the Hindi)

Use **`backend/scripts/import-pinnacle-bilingual.mjs`** (NOT the plain `import-pinnacle.mjs`, which
sets `questionTextHindi = null` and drops option Hindi). It matches existing DB rows by `searchHash`
(sha256 of the English question text): if the row exists it **adds** Hindi + solution; if not it
**creates** it. It **never overwrites a verified answer that disagrees** — such rows are skipped with a warning.

```bash
# on the server, from /opt/ssc-prep-hub
docker cp backend/extract/pinnacle-enhanced ssc-backend:/app/pinnacle-enhanced
docker cp backend/scripts/import-pinnacle-bilingual.mjs ssc-backend:/app/

# preview first (no writes):
docker exec -e DRY_RUN=1 ssc-backend node /app/import-pinnacle-bilingual.mjs /app/pinnacle-enhanced
# then real import:
docker exec ssc-backend node /app/import-pinnacle-bilingual.mjs /app/pinnacle-enhanced
```

The site shows a question in the bilingual bank as soon as `questionTextHindi` is non-empty, so
importing here makes these questions appear for Hindi users. Imported rows are marked
`translationStatus=AUTO_UNVERIFIED`, `explanationSource=AI_GENERATED`, `reviewStatus=IN_REVIEW`.

## Progress

| File | Questions | Answered | Needs review |
|---|---|---|---|
| `Coding-Decoding.json` | 280 | 279 | 1 (Q11 — derived code matches no option, likely misprint) |

Of the 756 text-only Coding-Decoding questions: **279 are answered** with verified bilingual
solutions (40 hand-built + 239 auto-solved & code-verified), 1 is flagged in the main file, and the
remaining **476 are catalogued in `_Coding-Decoding.review.json`** with a reason. Those use patterns
that can't be auto-solved without risking a wrong answer — sentence "means" puzzles, number→number
ciphers, and shift+shuffle *combinations* — so they await more rule families or hand-verification
rather than a guess. The `_`-prefixed review file is **ignored by the import glob** (never imported).

Auto-solved answers are produced by `scripts/translation/solver-coding.mjs`, which commits a rule
only when it (a) reproduces every example/given in the stem, (b) yields exactly one option, and
(c) no other confirmed rule disagrees — otherwise the question is flagged, never guessed. Validated
against the 40 hand-built answers with **0 disagreements**.

More category files (Analogy, Series, Blood Relation, Direction, …) are added here batch by batch.
