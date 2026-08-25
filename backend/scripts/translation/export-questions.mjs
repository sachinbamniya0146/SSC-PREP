#!/usr/bin/env node
/**
 * export-questions.mjs — SSC Prep Hub
 * ------------------------------------------------------------------
 * Exports questions from the LIVE database into a JSON file that has
 * the SAME format as GOLD_TEMPLATE.json, with the Hindi + solution
 * fields left BLANK for enhancement.
 *
 * It ONLY reads the DB. It changes nothing.
 *
 * Env vars (all optional):
 *   MODE   = "missing" (default) → only questions that still need Hindi
 *            OR a solution. "all" → every active question.
 *   LIMIT  = how many to export in this batch      (default 200)
 *   OFFSET = how many to skip (for the next batch)  (default 0)
 *   OUT    = output file path              (default /app/questions-to-translate.json)
 *
 * Run inside the backend container (has @prisma/client + DATABASE_URL):
 *   docker cp export-questions.mjs ssc-backend:/app/export-questions.mjs
 *   docker exec -e LIMIT=200 -e OFFSET=0 ssc-backend node /app/export-questions.mjs
 *   docker cp ssc-backend:/app/questions-to-translate.json ./
 * ------------------------------------------------------------------
 */
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';

const prisma = new PrismaClient();

const MODE = (process.env.MODE || 'missing').toLowerCase();
const LIMIT = Math.max(1, parseInt(process.env.LIMIT || '200', 10));
const OFFSET = Math.max(0, parseInt(process.env.OFFSET || '0', 10));
const OUT = process.env.OUT || '/app/questions-to-translate.json';

const log = (...a) => console.error(...a); // logs → stderr so stdout/file stays clean

function buildWhere() {
  if (MODE === 'all') return { isActive: true };
  // "missing": needs a Hindi question OR a solution
  return {
    isActive: true,
    OR: [
      { questionTextHindi: null },
      { questionTextHindi: '' },
      { explanation: null },
      { explanation: '' },
    ],
  };
}

function normalizeOptions(optionsJson, correctAnswer) {
  const arr = Array.isArray(optionsJson) ? optionsJson : [];
  return arr.map((o, i) => {
    const key = o && o.key ? String(o.key) : String.fromCharCode(65 + i);
    return {
      key,
      text: o && o.text != null ? String(o.text) : '',
      textHi: o && o.textHi ? String(o.textHi) : '', // FILL THIS
      isCorrect: typeof (o && o.isCorrect) === 'boolean' ? o.isCorrect : key === correctAnswer,
    };
  });
}

async function main() {
  const where = buildWhere();
  const total = await prisma.question.count({ where });
  log(`MODE=${MODE}  matching questions in DB: ${total}`);
  log(`Exporting batch: OFFSET=${OFFSET}  LIMIT=${LIMIT}`);

  const rows = await prisma.question.findMany({
    where,
    orderBy: { createdAt: 'asc' }, // stable order for pagination
    skip: OFFSET,
    take: LIMIT,
    select: {
      id: true,
      questionText: true,
      questionTextHindi: true,
      optionsJson: true,
      correctAnswer: true,
      explanation: true,
      explanationHindi: true,
      difficulty: true,
      year: true,
      subject: { select: { name: true } },
      exam: { select: { name: true } },
    },
  });

  const questions = rows.map((r) => ({
    id: r.id,
    subject: r.subject?.name ?? null,
    exam: r.exam?.name ?? null,
    year: r.year ?? null,
    difficulty: r.difficulty,
    questionText: r.questionText,
    questionTextHindi: r.questionTextHindi || '', // FILL if empty
    options: normalizeOptions(r.optionsJson, r.correctAnswer),
    correctAnswer: r.correctAnswer, // DO NOT CHANGE
    explanation: r.explanation || '', // FILL if empty
    explanationHindi: r.explanationHindi || '', // FILL if empty
  }));

  const payload = {
    _note: 'Fill questionTextHindi, each option textHi, explanation, explanationHindi. Follow GOLD_TEMPLATE.json. NEVER change id, questionText, option text, isCorrect, or correctAnswer.',
    generatedAt: new Date().toISOString(),
    mode: MODE,
    offset: OFFSET,
    limit: LIMIT,
    matchingTotal: total,
    count: questions.length,
    questions,
  };

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf-8');
  log(`\n✅ Wrote ${questions.length} questions to ${OUT}`);
  if (OFFSET + questions.length < total) {
    log(`➡️  Next batch: run again with OFFSET=${OFFSET + LIMIT}`);
  } else {
    log('🎉 That was the last batch (no more remaining).');
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  log('ERROR:', e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
