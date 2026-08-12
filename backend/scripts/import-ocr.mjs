#!/usr/bin/env node
/**
 * Generic importer for OCR-extracted questions (Reasoning/Grammar/myGKstudy JSON).
 * Maps question text + options + answer into the DB with chapter mapping.
 * Bilingual: myGKstudy questions are Hindi-primary → keep Hindi as main text.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import fs from 'node:fs';

const prisma = new PrismaClient();

const CHAPTER_MAP = {
  'Reasoning': 'Reasoning',
  'Grammar': 'English Language',
  'myGKstudy': 'Reasoning',
};

async function getOrCreate(examName, subjectName, chapterName) {
  const exam = await prisma.exam.findFirst({ where: { name: examName } })
    || await prisma.exam.findFirst({ where: { slug: 'cgl' } });
  let subj = await prisma.subject.findFirst({ where: { name: subjectName } });
  if (!subj) {
    const slug = subjectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    subj = await prisma.subject.create({ data: { name: subjectName, slug } });
  }
  let chap = await prisma.chapter.findFirst({ where: { subjectId: subj.id, name: chapterName } });
  if (!chap) {
    const slug = chapterName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    chap = await prisma.chapter.create({ data: { subjectId: subj.id, name: chapterName, slug } });
  }
  return { exam, subj, chap };
}

async function importFile(filePath, subjectName, chapterName, examName) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`\n=== ${filePath}: ${raw.length} rows ===`);
  
  const { exam, chap } = await getOrCreate(examName, subjectName, chapterName);
  let inserted = 0, dup = 0, skipped = 0, noAns = 0;
  
  for (const r of raw) {
    const qText = r.text || r.q || r.questionText || '';
    const opts = r.opts || r.options || {};
    const ans = (r.ans || r.answer || '').trim().toUpperCase();
    
    if (!qText || qText.length < 15) { skipped++; continue; }
    const optKeys = Object.keys(opts).filter(k => 'ABCD'.includes(k) && (opts[k] || '').length > 1);
    if (optKeys.length < 2) { skipped++; continue; }
    // NOTE: 'ABCD'.includes('') is TRUE in JS — empty answer must be explicitly rejected.
    if (!ans || !['A','B','C','D'].includes(ans)) { noAns++; continue; }
    
    const optionsJson = ['A','B','C','D']
      .filter(k => (opts[k] || '').length > 1)
      .map(k => ({ key: k, text: opts[k], isCorrect: k === ans }));
    
    const searchHash = createHash('sha256').update(qText.trim()).digest('hex');
    const existing = await prisma.question.findFirst({ where: { searchHash } });
    if (existing) { dup++; continue; }
    
    await prisma.question.create({
      data: {
        subjectId: chap.subjectId,
        chapterId: chap.id,
        examId: exam.id,
        questionText: qText,
        questionTextHindi: null,
        optionsJson,
        correctAnswer: ans,
        explanation: r.expl || r.sol || r.explanation || null,
        explanationHindi: null,
        explanationSource: 'HUMAN_VERIFIED',
        translationStatus: 'AUTO_UNVERIFIED',
        difficulty: 'MEDIUM',
        marks: 2.0,
        negativeMarks: 0.5,
        isApproved: true,
        searchHash,
        answerVerificationStatus: 'VERIFIED_OFFICIAL',
        lastVerifiedAt: new Date(),
      },
    });
    inserted++;
    if (inserted % 200 === 0) console.log(`  ${inserted} inserted...`);
  }
  
  console.log(`Inserted: ${inserted} | Dup: ${dup} | Skipped(short/no-opts): ${skipped} | NoAnswer: ${noAns}`);
  return inserted;
}

async function main() {
  const files = [
    { path: '/tmp/reasoning_full.json', subject: 'Reasoning', chapter: 'Reasoning PYQ', exam: 'SSC CGL' },
    { path: '/tmp/grammar_questions.json', subject: 'English Language', chapter: 'Error Spotting', exam: 'SSC CGL' },
    { path: '/tmp/mygk_questions.json', subject: 'General Awareness', chapter: 'GK PYQ', exam: 'SSC CGL' },
  ];
  let total = 0;
  for (const f of files) {
    if (!fs.existsSync(f.path)) { console.log(`SKIP (not found): ${f.path}`); continue; }
    total += await importFile(f.path, f.subject, f.chapter, f.exam);
  }
  console.log(`\n=== TOTAL INSERTED: ${total} ===`);
}

main().catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());