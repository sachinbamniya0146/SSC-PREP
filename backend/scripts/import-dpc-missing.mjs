#!/usr/bin/env node
/**
 * Import 4 missed DPC bilingual TEXT questions (QID-based, NO searchHash dedup —
 * same wording may legitimately appear across shifts with different answers).
 * Source: verified_bilingual.json filtered by missing text qids.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import fs from 'node:fs';

const prisma = new PrismaClient();

const SUBJECT_MAP = {
  'General Intelligence and Reasoning': 'Reasoning',
  'General Awareness': 'General Awareness',
  'Quantitative Aptitude': 'Quantitative Aptitude',
  'Numerical Ability': 'Quantitative Aptitude',
  'English Comprehension': 'English',
  'General Knowledge': 'General Awareness',
  'Elementary Mathematics': 'Quantitative Aptitude',
  'Reasoning': 'Reasoning',
  'General Studies': 'General Awareness',
  'English': 'English',
  'Hindi': 'Hindi',
};

async function getSubject(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
  let subj = await prisma.subject.findFirst({ where: { slug } });
  if (!subj) subj = await prisma.subject.create({ data: { name, slug } });
  return subj;
}

async function getChapter(subjectId, name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  let chap = await prisma.chapter.findFirst({ where: { subjectId, slug } });
  if (!chap) chap = await prisma.chapter.create({ data: { subjectId, name, slug } });
  return chap;
}

async function main() {
  const pairs = JSON.parse(fs.readFileSync('/tmp/pyq_inspect/verified_bilingual.json', 'utf-8'));
  const missing = JSON.parse(fs.readFileSync('/tmp/pyq_inspect/missing_class.json', 'utf-8')).text;
  const byId = new Map(pairs.map((p) => [p.qid, p]));

  const exam = await prisma.exam.findFirst({ where: { slug: 'delhi-police-constable' } });
  console.log(`Exam: ${exam ? exam.name : 'NOT FOUND'}`);

  let inserted = 0, skipped = 0;
  for (const qid of missing) {
    const p = byId.get(qid);
    if (!p) { skipped++; continue; }
    const qText = (p.question_en || '').trim();
    if (qText.length < 5) { skipped++; continue; }
    // QID-based existence check only — NOT searchHash (same wording, diff answer allowed)
    const exists = await prisma.question.findFirst({ where: { paperCode: qid } });
    if (exists) { skipped++; continue; }

    const secName = p.section_en && SUBJECT_MAP[p.section_en] ? SUBJECT_MAP[p.section_en] : 'General Awareness';
    const subj = await getSubject(secName);
    const chap = await getChapter(subj.id, secName);

    const optionsJson = p.options_en.map((o) => {
      const m = o.match(/^([A-D])\.\s?(.*)$/s);
      const key = m ? m[1] : String.fromCharCode(65 + p.options_en.indexOf(o));
      const text = m ? m[2].trim() : o;
      return { key, text, isCorrect: key === p.answer };
    });
    if (optionsJson.filter((o) => o.text).length < 2) { skipped++; continue; }

    try {
      await prisma.question.create({
        data: {
          subjectId: subj.id,
          chapterId: chap.id,
          examId: exam.id,
          year: 2023,
          shift: p.date_en ? `Exam Date: ${p.date_en}` : null,
          paperCode: qid,
          questionText: qText,
          questionTextHindi: p.question_hi || null,
          optionsJson,
          correctAnswer: p.answer,
          explanation: null,
          explanationHindi: null,
          explanationSource: 'PDF',
          translationStatus: 'HUMAN_VERIFIED',
          answerVerificationStatus: 'VERIFIED_MULTI_SOURCE',
          lastVerifiedAt: new Date(),
          isApproved: true,
          isActive: true,
          difficulty: 'MEDIUM',
          marks: 1.0,
          negativeMarks: 0.25,
          searchHash: createHash('sha256').update(qText).digest('hex').slice(0, 40),
        },
      });
      inserted++;
      console.log(`  + ${qid} ${p.answer} | ${qText.slice(0, 50)}`);
    } catch (e) {
      skipped++;
      console.log(`  ! ${qid} skip: ${e.message}`);
    }
  }
  console.log(`=== DONE: inserted ${inserted}, skipped ${skipped} ===`);
  const total = await prisma.question.count();
  console.log(`DB total questions: ${total}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });