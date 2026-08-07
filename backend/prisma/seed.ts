/* eslint-disable no-console */
/* SSC Prep Hub — seed verified PYQs (with correct answers) into Prisma.
 * Source: /Users/sachin/ssc-automation/data/seed_data.py (18 verified Reasoning PYQs)
 * Only questions WITH verified answers are seeded (user: zero answer mistakes).
 * Run: npx ts-node prisma/seed.ts
 */
import { PrismaClient, Difficulty, ExplanationSource, TranslationStatus } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

// Load the Python seed data by parsing the QUESTIONS literal via a sidecar JSON.
// We regenerate the JSON from the python module at seed time.
interface SeedQ {
  qid: number;
  exam: string;
  year: string;
  topic: string;
  q_en: string;
  q_hi: string;
  opt_a: string;
  opt_b: string;
  opt_c: string;
  opt_d: string;
  answer: string;
  expl_en: string;
  expl_hi: string;
  trick_en: string;
  trick_hi: string;
  diff: string;
  source: string;
}

async function main() {
  const fs = require('fs');

  // Read the pre-dumped QUESTIONS JSON (created by /tmp/dump_seed_qs.py)
  const jsonPath = '/tmp/ssc_seed_questions.json';
  if (!fs.existsSync(jsonPath)) {
    console.error('[seed] Missing /tmp/ssc_seed_questions.json — run: python3 /tmp/dump_seed_qs.py');
    process.exit(1);
  }
  const questions: SeedQ[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`[seed] Loaded ${questions.length} verified questions`);

  // 1. Subject
  let subject = await prisma.subject.findUnique({ where: { slug: 'reasoning' } });
  if (!subject) {
    subject = await prisma.subject.create({ data: { name: 'Reasoning', slug: 'reasoning' } });
    console.log('[seed] Created subject: Reasoning');
  }

  // 2. Chapters + questions
  let inserted = 0;
  for (const q of questions) {
    const chapSlug = q.topic
      .replace('—', '-')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60);
    let chapter = await prisma.chapter.findUnique({
      where: { subjectId_slug: { subjectId: subject.id, slug: chapSlug } },
    });
    if (!chapter) {
      chapter = await prisma.chapter.create({
        data: { subjectId: subject.id, name: q.topic, slug: chapSlug },
      });
    }

    const qid = 'q-' + createHash('md5').update(q.q_en).digest('hex').slice(0, 16);
    const ansUpper = q.answer.trim().toUpperCase();
    const optionsJson = [
      { key: 'A', text: q.opt_a, isCorrect: ansUpper === 'A' },
      { key: 'B', text: q.opt_b, isCorrect: ansUpper === 'B' },
      { key: 'C', text: q.opt_c, isCorrect: ansUpper === 'C' },
      { key: 'D', text: q.opt_d, isCorrect: ansUpper === 'D' },
    ];
    const difficulty: Difficulty =
      q.diff.toLowerCase() === 'easy' ? 'EASY' : q.diff.toLowerCase() === 'hard' ? 'HARD' : 'MEDIUM';

    const exists = await prisma.question.findUnique({ where: { id: qid } });
    if (exists) continue;

    await prisma.question.create({
      data: {
        id: qid,
        subjectId: subject.id,
        chapterId: chapter.id,
        year: q.year ? parseInt(q.year, 10) : null,
        questionText: q.q_en,
        questionTextHindi: q.q_hi || null,
        optionsJson: optionsJson as unknown as object,
        correctAnswer: ansUpper,
        explanation: q.expl_en || null,
        explanationHindi: q.expl_hi || null,
        explanationSource: ExplanationSource.HUMAN_VERIFIED,
        translationStatus: TranslationStatus.HUMAN_VERIFIED,
        isApproved: true,
        isActive: true,
        difficulty,
        marks: 1.0,
        negativeMarks: 0.5,
        searchHash: createHash('sha256').update(q.q_en).digest('hex').slice(0, 32),
      },
    });
    inserted++;
  }

  console.log(`[seed] Inserted ${inserted} new questions (total verified bank now seeded)`);
  const total = await prisma.question.count();
  const chapters = await prisma.chapter.count();
  console.log(`[seed] DB totals -> questions: ${total}, chapters: ${chapters}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
