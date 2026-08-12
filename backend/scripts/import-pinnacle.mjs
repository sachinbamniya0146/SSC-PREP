#!/usr/bin/env node
/** Import ALL Pinnacle Reasoning chapters + verified questions into Prisma DB */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import fs from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

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
    'ssc': 'SSC CGL', 'ssc cgl': 'SSC CGL', 'ssc cgl tier-1': 'SSC CGL',
    'ssc cgl tier i': 'SSC CGL', 'ssc cgl tier 1': 'SSC CGL',
    'ssc cgl pre': 'SSC CGL Pre',
    'ssc chsl': 'SSC CHSL', 'ssc chsl tier-1': 'SSC CHSL',
    'ssc cpo': 'SSC CPO', 'ssc cpo tier-1': 'SSC CPO',
    'ssc mts': 'SSC MTS', 'ssc gd': 'SSC GD',
    'ssc stenographer': 'SSC Steno', 'ssc je': 'SSC JE',
    'delhi police': 'SSC GD',
  };
  return map[key] || 'SSC CGL';
}

const TM = {
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
  const clean = rawLower.replace(/reasoning\s*[–-]?\s*/i, '').trim().toLowerCase();
  for (const [k, v] of Object.entries(TM)) {
    if (clean.includes(k)) return { subject: 'Reasoning', chapter: v };
  }
  return { subject: 'Reasoning', chapter: raw?.trim() || 'General' };
}

let examCache = {}, subjectCache = {}, chapterCache = {};

async function getExam(name) {
  if (examCache[name]) return examCache[name];
  const slug = EXAM_SLUGS[name] || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const exam = await prisma.exam.findFirst({ where: { slug } });
  if (exam) { examCache[name] = exam; return exam; }
  const fallback = await prisma.exam.findFirst({ where: { slug: 'cgl' } });
  if (fallback) { examCache[name] = fallback; return fallback; }
  throw new Error(`No exam found for: ${name}`);
}

async function getSubject(name) {
  if (subjectCache[name]) return subjectCache[name];
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
  const subj = await prisma.subject.findFirst({ where: { slug } });
  if (subj) { subjectCache[name] = subj; return subj; }
  const created = await prisma.subject.create({ data: { name, slug } });
  subjectCache[name] = created; return created;
}

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
    chapterCache[key] = chap; return chap;
  } catch (e) {
    const chap = await prisma.chapter.findFirst({ where: { subjectId, slug } });
    if (chap) { chapterCache[key] = chap; return chap; }
    throw e;
  }
}

async function importPinnacleFolder(folderPath) {
  console.log(`\n=== Importing Pinnacle chapters from ${folderPath} ===`);
  const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.json'));
  let totalInserted = 0;
  
  for (const file of files) {
    const filePath = path.join(folderPath, file);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!raw.length) continue;
    
    const chapterName = file.replace('.json', '').replace(/-/g, ' ');
    console.log(`  ${chapterName}: ${raw.length} questions`);
    
    let inserted = 0, skipped = 0;
    for (const q of raw) {
      // Pinnacle format: book_q, q, exam, date, shift, opt_a, opt_b, opt_c, opt_d, ans, expl_en, expl_hi, trick_en, trick_hi, diff, year, topic
      const qText = q.q || q.questionText || '';
      const opts = {
        A: q.opt_a || q.opt_A || '',
        B: q.opt_b || q.opt_B || '',
        C: q.opt_c || q.opt_C || '',
        D: q.opt_d || q.opt_D || '',
      };
      const ans = (q.ans || q.answer || '').trim().toUpperCase();
      
      if (!qText || qText.length < 15) { skipped++; continue; }
      const optKeys = Object.keys(opts).filter(k => opts[k] && opts[k].length > 1);
      if (optKeys.length < 2) { skipped++; continue; }
      if (!ans || !['A','B','C','D'].includes(ans)) { skipped++; continue; }
      
      const optionsJson = ['A','B','C','D']
        .filter(k => opts[k] && opts[k].length > 1)
        .map(k => ({ key: k, text: opts[k], isCorrect: k === ans }));
      
      const examName = normalizeExam(q.exam);
      const exam = await getExam(examName);
      const { subject, chapter } = parseTopic(q.topic);
      const subj = await getSubject(subject);
      const chap = await getChapter(subj.id, chapter);
      
      const searchHash = createHash('sha256').update(qText.trim()).digest('hex');
      const existing = await prisma.question.findFirst({ where: { searchHash } });
      if (existing) { continue; }
      
      await prisma.question.create({
        data: {
          subjectId: subj.id,
          chapterId: chap.id,
          examId: exam.id,
          year: q.year ? parseInt(q.year, 10) : null,
          shift: q.shift || null,
          paperCode: null,
          questionText: qText,
          questionTextHindi: null,
          optionsJson,
          correctAnswer: ans,
          explanation: q.expl_en || q.explanation || q.sol || null,
          explanationHindi: q.expl_hi || q.explanationHindi || null,
          explanationSource: 'HUMAN_VERIFIED',
          translationStatus: q.expl_hi ? 'HUMAN_VERIFIED' : 'AUTO_UNVERIFIED',
          difficulty: { easy: 'EASY', medium: 'MEDIUM', hard: 'HARD' }[(q.diff || '').toLowerCase()] || 'MEDIUM',
          marks: 2.0,
          negativeMarks: 0.5,
          isApproved: true,
          searchHash,
        },
      });
      inserted++;
    }
    console.log(`    Inserted: ${inserted} | Skipped: ${skipped}`);
    totalInserted += inserted;
  }
  return totalInserted;
}

async function main() {
  try {
    // 1. Import Pinnacle Reasoning chapters
    const pinnaclePath = path.join('/Users/sachin/ssc-prep-hub/backend/extract/pinnacle');
    const pinnacleInserted = await importPinnacleFolder(pinnaclePath);
    
    console.log(`\n=== Pinnacle total inserted: ${pinnacleInserted} ===`);
    
    // 2. Get final counts
    const total = await prisma.question.count();
    const exams = await prisma.exam.findMany({ include: { _count: { select: { questions: true } } } });
    console.log('\n=== DB Question Counts by Exam ===');
    for (const e of exams) {
      console.log(`  ${e.name}: ${e._count.questions}`);
    }
    console.log(`\n=== TOTAL QUESTIONS IN DB: ${total} ===`);
    
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();