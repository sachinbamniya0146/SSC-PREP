/**
 * SSC Prep Hub — question bank importer.
 *
 * Source of truth: ~/ssc-automation/data/posts.db (831 verified SSC PYQ,
 * hand-solved from the Pinnacle 7200 TCS MCQ book).
 *
 * Import ONLY double-checked questions — every row's answer was cross-verified
 * (pass 1: letter validity; pass 2: match vs book hand-solved sol files, 0
 * mismatches). Hindi imported when present; missing Hindi stays null and is
 * filled by the AI translation job (flagged AUTO_UNVERIFIED).
 *
 * Run: node scripts/seed-questions.mjs
 */
import { PrismaClient } from '@prisma/client';
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import path from 'node:path';
import os from 'node:os';

const db = new PrismaClient();
const SRC = process.env.QA_SRC_DB || path.join(os.homedir(), 'ssc-automation', 'data', 'posts.db');
const sqlite = new Database(SRC, { readonly: true });

const subjectSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function parseTopic(topic) {
  const parts = (topic || '').split('—').map((s) => s.trim()).filter(Boolean);
  const subject = parts[0] || 'Reasoning';
  const chapter = parts[1] || 'General';
  return { subject, chapter };
}

function examCode(name) {
  const n = (name || '').toUpperCase();
  if (n.includes('CGL')) return 'CGL';
  if (n.includes('CHSL')) return 'CHSL';
  if (n.includes('CPO')) return 'CPO';
  if (n.includes('MTS')) return 'MTS';
  if (n.includes('GD')) return 'GD';
  return 'OTHER';
}
function examName(code) {
  return (
    { CGL: 'SSC CGL', CHSL: 'SSC CHSL', CPO: 'SSC CPO', MTS: 'SSC MTS', GD: 'SSC GD Constable' }[code] ||
    'SSC'
  );
}

function diffToEnum(diff) {
  const d = (diff || '').toLowerCase();
  if (d.includes('hard') || d === 'hard') return 'HARD';
  if (d.includes('easy') || d === 'easy') return 'EASY';
  return 'MEDIUM';
}

const examCache = {};
const subjectCache = {};
const chapterCache = {};

async function getExam(name) {
  if (examCache[name]) return examCache[name];
  let rec = await db.exam.findUnique({ where: { name } });
  if (!rec) {
    rec = await db.exam.create({
      data: { name, slug: name.toLowerCase().replace(/\s+/g, '-'), code: examCode(name) },
    });
  }
  examCache[name] = rec;
  return rec;
}
async function getSubject(name) {
  if (subjectCache[name]) return subjectCache[name];
  let rec = await db.subject.findUnique({ where: { slug: subjectSlug(name) } });
  if (!rec) {
    rec = await db.subject.create({ data: { name, slug: subjectSlug(name) } });
  }
  subjectCache[name] = rec;
  return rec;
}
async function getChapter(subjectId, name) {
  const key = `${subjectId}|${name}`;
  if (chapterCache[key]) return chapterCache[key];
  const slug = subjectSlug(name);
  let rec = await db.chapter.findUnique({ where: { subjectId_slug: { subjectId, slug } } });
  if (!rec) {
    rec = await db.chapter.create({ data: { subjectId, name, slug } });
  }
  chapterCache[key] = rec;
  return rec;
}

async function main() {
  const rows = sqlite
    .prepare(
      `SELECT qid, exam, year, topic, q_en, q_hi, opt_a, opt_b, opt_c, opt_d,
              answer, expl_en, expl_hi, diff, source
       FROM questions`,
    )
    .all();

  console.log(`Source rows: ${rows.length}`);

  let inserted = 0;
  let skipped = 0;
  let dup = 0;

  for (const r of rows) {
    if (!r.q_en || !r.opt_a || !r.opt_b || !r.opt_c || !r.opt_d) {
      skipped++;
      continue;
    }
    const correct = (r.answer || '').trim().toUpperCase();
    if (!['A', 'B', 'C', 'D'].includes(correct)) {
      skipped++;
      continue;
    }

    const { subject, chapter } = parseTopic(r.topic);
    const exam = await getExam(examName(examCode(r.exam)));
    const subj = await getSubject(subject);
    const chap = await getChapter(subj.id, chapter);

    const optionsJson = ['A', 'B', 'C', 'D'].map((key) => ({
      key,
      text: r[`opt_${key.toLowerCase()}`],
      isCorrect: key === correct,
    }));

    const searchHash = createHash('sha256').update(r.q_en.trim()).digest('hex');
    const existing = await db.question.findFirst({ where: { searchHash } });
    if (existing) {
      dup++;
      continue;
    }

    const year = parseInt(r.year, 10) || undefined;
    await db.question.create({
      data: {
        subjectId: subj.id,
        chapterId: chap.id,
        examId: exam.id,
        year,
        questionText: r.q_en,
        questionTextHindi: r.q_hi || null,
        optionsJson,
        correctAnswer: correct,
        explanation: r.expl_en || null,
        explanationHindi: r.expl_hi || null,
        explanationSource: 'HUMAN_VERIFIED',
        translationStatus: r.q_hi ? 'HUMAN_VERIFIED' : 'AUTO_UNVERIFIED',
        difficulty: diffToEnum(r.diff),
        isApproved: true,
        searchHash,
      },
    });
    inserted++;
  }

  console.log(`Inserted ${inserted} | skipped(malformed) ${skipped} | dup ${dup}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
    sqlite.close();
  });