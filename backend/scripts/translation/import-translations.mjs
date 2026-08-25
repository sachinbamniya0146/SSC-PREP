#!/usr/bin/env node
/**
 * import-translations.mjs — SSC Prep Hub
 * ------------------------------------------------------------------
 * Reads an ENHANCED question file (the one Hermes filled following
 * GOLD_TEMPLATE.json) and writes the Hindi + solutions back into the DB.
 *
 * SAFETY GUARANTEES (so "koi gadbad na ho"):
 *   • It NEVER changes correctAnswer.
 *   • It NEVER changes English questionText or option 'text' or isCorrect.
 *       (option text/isCorrect are re-read from the DB and kept authoritative;
 *        only Hindi 'textHi' is attached.)
 *   • If the file's correctAnswer disagrees with the DB → that row is SKIPPED
 *     and a warning is printed. Nothing is guessed or overwritten.
 *   • Rows with an id starting "EXAMPLE" (the template samples) are ignored.
 *   • Set DRY_RUN=1 to preview counts WITHOUT touching the DB.
 *
 * Updated fields per question: questionTextHindi, option textHi,
 *   explanation, explanationHindi, and markers:
 *   translationStatus=AUTO_UNVERIFIED, explanationSource=AI_GENERATED,
 *   reviewStatus=IN_REVIEW  (so it is flagged as machine-made / to-review).
 *
 * Run inside the backend container:
 *   docker cp import-translations.mjs ssc-backend:/app/import-translations.mjs
 *   docker cp questions-enhanced.json ssc-backend:/app/questions-enhanced.json
 *   # preview first:
 *   docker exec -e DRY_RUN=1 ssc-backend node /app/import-translations.mjs /app/questions-enhanced.json
 *   # then real import:
 *   docker exec ssc-backend node /app/import-translations.mjs /app/questions-enhanced.json
 * ------------------------------------------------------------------
 */
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === '1';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node import-translations.mjs <enhanced.json>   (set DRY_RUN=1 to preview)');
  process.exit(1);
}

function loadQuestions(path) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf-8'));
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.questions)) return raw.questions;
  throw new Error('File must be an array or an object with a "questions" array.');
}

function nonEmpty(s) {
  return typeof s === 'string' && s.trim().length > 0;
}

// Merge Hindi (textHi) from the file into the DB's own options.
// DB options stay authoritative for key/text/isCorrect.
function mergeOptions(dbOptions, fileOptions) {
  const dbArr = Array.isArray(dbOptions) ? dbOptions : [];
  const hiByKey = new Map();
  (Array.isArray(fileOptions) ? fileOptions : []).forEach((o) => {
    if (o && o.key && nonEmpty(o.textHi)) hiByKey.set(String(o.key), o.textHi.trim());
  });
  let added = 0;
  const merged = dbArr.map((o, i) => {
    const key = o && o.key ? String(o.key) : String.fromCharCode(65 + i);
    const out = { ...o, key };
    if (hiByKey.has(key)) { out.textHi = hiByKey.get(key); added++; }
    return out;
  });
  return { merged, added };
}

async function main() {
  const items = loadQuestions(inputPath);
  console.log(`Loaded ${items.length} rows from ${inputPath}${DRY_RUN ? '  (DRY RUN — no writes)' : ''}`);

  let updated = 0, skippedNoId = 0, skippedExample = 0, skippedNotFound = 0,
      skippedAnswerMismatch = 0, skippedNothingToDo = 0, skippedImage = 0, errors = 0;

  for (const q of items) {
    const id = q && q.id ? String(q.id) : '';
    if (!id) { skippedNoId++; continue; }
    if (id.startsWith('EXAMPLE')) { skippedExample++; continue; }
    if (q.needsImageReview === true) { skippedImage++; continue; }

    let existing;
    try {
      existing = await prisma.question.findUnique({
        where: { id },
        select: { id: true, correctAnswer: true, optionsJson: true },
      });
    } catch (e) { console.warn(`! error reading id=${id}: ${e.message}`); errors++; continue; }

    if (!existing) { console.warn(`! not found in DB, skipping id=${id}`); skippedNotFound++; continue; }

    // SAFETY: never allow an answer change.
    if (nonEmpty(q.correctAnswer) && q.correctAnswer.trim() !== String(existing.correctAnswer)) {
      console.warn(`! ANSWER MISMATCH for id=${id} (file="${q.correctAnswer}" vs db="${existing.correctAnswer}") — skipping to stay safe.`);
      skippedAnswerMismatch++;
      continue;
    }

    const data = {};
    if (nonEmpty(q.questionTextHindi)) data.questionTextHindi = q.questionTextHindi.trim();
    if (nonEmpty(q.explanation)) data.explanation = q.explanation.trim();
    if (nonEmpty(q.explanationHindi)) data.explanationHindi = q.explanationHindi.trim();

    const { merged, added } = mergeOptions(existing.optionsJson, q.options);
    if (added > 0) data.optionsJson = merged;

    if (Object.keys(data).length === 0) { skippedNothingToDo++; continue; }

    // markers: machine-made translation/solution, needs human sign-off
    data.translationStatus = 'AUTO_UNVERIFIED';
    if (data.explanation || data.explanationHindi) data.explanationSource = 'AI_GENERATED';
    data.reviewStatus = 'IN_REVIEW';

    if (DRY_RUN) { updated++; continue; }

    try {
      await prisma.question.update({ where: { id }, data });
      updated++;
    } catch (e) { console.warn(`! failed to update id=${id}: ${e.message}`); errors++; }
  }

  console.log('\n=== IMPORT SUMMARY ===');
  console.log(`${DRY_RUN ? 'WOULD update' : 'Updated'} : ${updated}`);
  console.log(`Skipped — no id            : ${skippedNoId}`);
  console.log(`Skipped — template example : ${skippedExample}`);
  console.log(`Skipped — needs image      : ${skippedImage}`);
  console.log(`Skipped — not found in DB  : ${skippedNotFound}`);
  console.log(`Skipped — ANSWER MISMATCH  : ${skippedAnswerMismatch}`);
  console.log(`Skipped — nothing filled   : ${skippedNothingToDo}`);
  console.log(`Errors                     : ${errors}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('FATAL:', e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
