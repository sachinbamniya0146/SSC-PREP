# Bilingual Question Enhancement — how it works

Goal: add **Hindi translations** and **detailed bilingual solutions** to the SSC Prep Hub
question bank, safely, in batches — without ever changing a verified answer.

## Why this approach
The real questions live in the **production database** (not in the repo). So we:
1. **Export** a batch of questions from the DB into a JSON file (blank Hindi/solution fields).
2. **Enhance** that file (Hermes fills Hindi + solutions) following `GOLD_TEMPLATE.json`.
3. **Import** it back — only Hindi/solutions are written; answers are untouchable.

The app already gates the bilingual question bank on `questionTextHindi` being non-empty,
so **filling Hindi literally makes those questions appear** for bilingual users.

## Files in this folder
| File | Purpose |
|---|---|
| `GOLD_TEMPLATE.json` | The **standard**. 4 fully-worked examples + all the rules. Edit/review freely. |
| `export-questions.mjs` | Reads the DB, writes a batch to `questions-to-translate.json`. Read-only. |
| `import-translations.mjs` | Writes an enhanced batch back to the DB. Safe (see below). |
| `HERMES_PROMPT.md` | The ready-to-paste prompt for Hermes to do the work. |

## Field mapping (file → database `Question`)
| File field | DB column | Who fills it |
|---|---|---|
| `id` | `id` | export (never change) |
| `questionText` | `questionText` | export (never change) |
| `questionTextHindi` | `questionTextHindi` | **Hermes** |
| `options[].textHi` | inside `optionsJson` (`{key,text,textHi,isCorrect}`) | **Hermes** |
| `correctAnswer` | `correctAnswer` | export (never change) |
| `explanation` | `explanation` | **Hermes** |
| `explanationHindi` | `explanationHindi` | **Hermes** |
| — | `translationStatus` → `AUTO_UNVERIFIED` | import (auto) |
| — | `explanationSource` → `AI_GENERATED` | import (auto) |
| — | `reviewStatus` → `IN_REVIEW` | import (auto) |

## Safety guarantees (import script)
- Never changes `correctAnswer`, `questionText`, option `text`, or `isCorrect`.
- Re-reads options from the DB and only **attaches** Hindi `textHi`.
- **Skips + warns** if a file row's answer disagrees with the DB.
- Ignores template rows whose `id` starts with `EXAMPLE`.
- `DRY_RUN=1` previews everything without writing.

## Batch loop (quick reference)
```
# export (server, inside container)
docker cp export-questions.mjs ssc-backend:/app/
docker exec -e MODE=missing -e LIMIT=200 -e OFFSET=0 ssc-backend node /app/export-questions.mjs
docker cp ssc-backend:/app/questions-to-translate.json ./questions-batch-0.json

# ...Hermes fills questions-batch-0.json following GOLD_TEMPLATE.json...

# preview then import
docker cp questions-batch-0.json ssc-backend:/app/
docker cp import-translations.mjs ssc-backend:/app/
docker exec -e DRY_RUN=1 ssc-backend node /app/import-translations.mjs /app/questions-batch-0.json
docker exec ssc-backend node /app/import-translations.mjs /app/questions-batch-0.json

# next batch: OFFSET=200, 400, ...
```

## First-time setup
Commit and push this folder from your Mac, then `git pull` on the server:
```
cd ~/ssc-prep-hub && git add backend/scripts/translation && git commit -m "add bilingual translation tooling" && git push origin main
# on server:
cd /opt/ssc-prep-hub && git pull
```
