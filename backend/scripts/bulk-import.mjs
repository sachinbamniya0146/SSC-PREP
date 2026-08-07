#!/usr/bin/env node
/**
 * Bulk import ALL questions from posts.db into PostgreSQL.
 * Works with existing DB structure (exams/subjects already seeded).
 */
import { PrismaClient } from '@prisma/client';
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import path from 'node:path';
import os from 'node:os';

const prisma = new PrismaClient();
const SRC = process.env.QA_SRC_DB || path.join(os.homedir(), 'ssc-automation', 'data', 'posts.db');
const sqlite = new Database(SRC, { readonly: true });

// --- Exam name -> slug mapping (already in DB) ---
const EXAM_SLUGS = {
  'SSC CGL': 'cgl',
  'SSC CGL Pre': 'cgl-pre',
  'SSC CHSL': 'chsl',
  'SSC CPO': 'cpo',
  'SSC MTS': 'mts',
  'SSC GD': 'gd',
  'SSC Steno': 'steno',
  'SSC JE': 'je',
};

function normalizeExam(raw) {
  const key = (raw || '').trim().toLowerCase();
  const map = {
    'ssc': 'SSC CGL',
    'ssc cgl': 'SSC CGL',
    'ssc cgl tier-1': 'SSC CGL',
    'ssc cgl tier i': 'SSC CGL',
    'ssc cgl tier 1': 'SSC CGL',
    'ssc cgl pre': 'SSC CGL Pre',
    'ssc chsl': 'SSC CHSL',
    'ssc chsl tier-1': 'SSC CHSL',
    'ssc chsl tier i': 'SSC CHSL',
    'ssc chsl tier 1': 'SSC CHSL',
    'ssc cpo': 'SSC CPO',
    'ssc cpo tier-1': 'SSC CPO',
    'ssc cpo tier i': 'SSC CPO',
    'ssc cpo tier 1': 'SSC CPO',
    'ssc mts': 'SSC MTS',
    'ssc gd': 'SSC GD',
    'ssc stenographer': 'SSC Steno',
    'ssc je': 'SSC JE',
    'delhi police': 'SSC GD',
  };
  return map[key] || 'SSC CGL';
}

function parseTopic(raw) {
  const rawLower = (raw || '').toLowerCase();
  if (rawLower.includes('—')) {
    const parts = rawLower.split('—');
    const subject = parts[0].trim();
    const subjectName = subject.charAt(0).toUpperCase() + subject.slice(1);
    let chapter = parts.slice(1).join('—').trim().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    chapter = chapter.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return { subject: subjectName, chapter };
  }
  // Topic map for reasoning
  const tm = {
    'age': 'Age', 'analogy': 'Analogy', 'arithmetic': 'Arithmetic Reasoning',
    'blood': 'Blood Relations', 'classification': 'Classification',
    'coding': 'Coding-Decoding', 'direction': 'Direction & Distance',
    'figure counting': 'Figure Counting', 'figure_series': 'Figure Series',
    'matrix': 'Matrix', 'missing_number': 'Missing Number',
    'non verbal': 'Non-Verbal Reasoning', 'number_series': 'Number Series',
    'odd_one_out': 'Odd One Out', 'ordering': 'Ordering & Ranking',
    'puzzle': 'Puzzle', 'ranking': 'Ordering & Ranking',
    'syllogism': 'Syllogism', 'venn_diagram': 'Venn Diagram',
    'word formation': 'Word Formation',
  };
  const clean = rawLower.replace(/reasoning\s*[–-]?\s*/i, '').trim().toLowerCase();
  for (const [k, v] of Object.entries(tm)) {
    if (clean.includes(k)) return { subject: 'Reasoning', chapter: v };
  }
  return { subject: 'Reasoning', chapter: raw?.trim() || 'General' };
}

let examCache = {};
async function getExam(name) {
  if (examCache[name]) return examCache[name];
  const slug = EXAM_SLUGS[name] || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const exam = await prisma.exam.findFirst({ where: { slug } });
  if (!exam) {
    const byName = await prisma.exam.findFirst({ where: { name } });
    if (byName) { examCache[name] = byName; return byName; }
    // Fallback: use SSC CGL
    const fallback = await prisma.exam.findFirst({ where: { slug: 'cgl' } });
    if (fallback) { examCache[name] = fallback; return fallback; }
    throw new Error(`No exam found for: ${name}`);
  }
  examCache[name] = exam;
  return exam;
}

let subjectCache = {};
async function getSubject(name) {
  if (subjectCache[name]) return subjectCache[name];
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
  const subj = await prisma.subject.findFirst({ where: { slug } });
  if (!subj) {
    const byName = await prisma.subject.findFirst({ where: { name } });
    if (byName) { subjectCache[name] = byName; return byName; }
    // Create if missing
    const created = await prisma.subject.create({ data: { name, slug } });
    subjectCache[name] = created;
    return created;
  }
  subjectCache[name] = subj;
  return subj;
}

let chapterCache = {};
async function getChapter(subjectId, name) {
  const key = `${subjectId}:${name}`;
  if (chapterCache[key]) return chapterCache[key];
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  try {
    const chap = await prisma.chapter.upsert({
      where: { subjectId_slug: { subjectId, slug } },
      create: { subjectId, name, slug },
      update: {},
    });
    chapterCache[key] = chap;
    return chap;
  } catch (e) {
    // Unique constraint race - try find
    const chap = await prisma.chapter.findFirst({ where: { subjectId, slug } });
    if (chap) { chapterCache[key] = chap; return chap; }
    throw e;
  }
}

async function main() {
  console.log('Source:', SRC);
  const rows = sqlite.prepare('SELECT * FROM questions ORDER BY qid').all();
  console.log(`Source rows: ${rows.length}`);

  let inserted = 0, skipped = 0, dup = 0;

  for (const r of rows) {
    if (!r.q_en || !r.opt_a || !r.opt_b || !r.opt_c || !r.opt_d) { skipped++; continue; }
    const correct = (r.answer || '').trim().toUpperCase();
    if (!['A', 'B', 'C', 'D'].includes(correct)) { skipped++; continue; }

    const { subject, chapter } = parseTopic(r.topic);
    const exam = await getExam(normalizeExam(r.exam));
    const subj = await getSubject(subject);
    const chap = await getChapter(subj.id, chapter);

    const optionsJson = ['A', 'B', 'C', 'D'].map((key) => ({
      key, text: r[`opt_${key.toLowerCase()}`], isCorrect: key === correct,
    }));

    const searchHash = createHash('sha256').update(r.q_en.trim()).digest('hex');
    const existing = await prisma.question.findFirst({ where: { searchHash } });
    if (existing) { dup++; continue; }

    await prisma.question.create({
      data: {
        subjectId: subj.id,
        chapterId: chap.id,
        examId: exam.id,
        year: parseInt(r.year, 10) || null,
        questionText: r.q_en,
        questionTextHindi: r.q_hi || null,
        optionsJson,
        correctAnswer: correct,
        explanation: r.expl_en || null,
        explanationHindi: r.expl_hi || null,
        explanationSource: 'HUMAN_VERIFIED',
        translationStatus: r.q_hi ? 'HUMAN_VERIFIED' : 'AUTO_UNVERIFIED',
        difficulty: { 'easy': 'EASY', 'medium': 'MEDIUM', 'hard': 'HARD' }[(r.diff || '').trim().toLowerCase()] || 'MEDIUM',
        marks: 1.0,
        negativeMarks: 0.5,
        isApproved: true,
        searchHash,
      },
    });
    inserted++;
    if (inserted % 200 === 0) console.log(`  ${inserted} inserted, ${dup} dup, ${skipped} skipped`);
  }

  console.log(`\n=== DONE ===`);
  console.log(`Inserted: ${inserted} | Skipped: ${skipped} | Dup: ${dup}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); sqlite.close(); });