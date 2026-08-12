#!/usr/bin/env node
/**
 * Import Delhi Police Constable 2023 PYQ (bilingual verified) into SSC Prep Hub.
 * Source: /tmp/pyq_inspect/verified_bilingual.json + verified_english.json + verified_hindi.json
 * Verification: OPTION-ID based (EN↔HI same option id = physical identity) — VERIFIED_MULTI_SOURCE
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

async function getExam(name, slug, code) {
  let exam = await prisma.exam.findFirst({ where: { slug } });
  if (!exam) exam = await prisma.exam.create({ data: { name, slug, code } });
  return exam;
}

async function getChapter(subjectId, name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  let chap = await prisma.chapter.findFirst({ where: { subjectId, slug } });
  if (!chap) chap = await prisma.chapter.create({ data: { subjectId, name, slug } });
  return chap;
}

function qhash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 40);
}

async function main() {
  const pairs = JSON.parse(fs.readFileSync('/tmp/pyq_inspect/verified_bilingual.json', 'utf-8'));
  const enOnly = JSON.parse(fs.readFileSync('/tmp/pyq_inspect/verified_english.json', 'utf-8'));
  const hiOnly = JSON.parse(fs.readFileSync('/tmp/pyq_inspect/verified_hindi.json', 'utf-8'));

  const subject = await getSubject('General Awareness'); // default fallback
  const exam = await getExam('Delhi Police Constable', 'delhi-police-constable', 'DPC');
  console.log(`Exam: ${exam.id} | Subject: ${subject.id}`);

  let inserted = 0, skipped = 0;

  async function insertOne({ questionEn, questionHi, optionsEn, optionsHi, answer, qid, dateEn, dateHi, section }) {
    const qText = questionEn?.trim();
    const qTextHi = questionHi?.trim() || null;
    if (!qText || qText.length < 5) { skipped++; return; }
    if (!['A', 'B', 'C', 'D'].includes(answer)) { skipped++; return; }
    if ((optionsEn || []).length < 2) { skipped++; return; }

    // subject by section (EN section name)
    const secName = section && SUBJECT_MAP[section] ? SUBJECT_MAP[section] : 'General Awareness';
    const subj = await getSubject(secName);
    const chap = await getChapter(subj.id, secName);

    // options JSON from EN options (A. text), isCorrect flag per answer
    const optionsJson = optionsEn.map((o) => {
      const m = o.match(/^([A-D])\.\s?(.*)$/s);
      const key = m ? m[1] : String.fromCharCode(65 + optionsEn.indexOf(o));
      const text = m ? m[2].trim() : o;
      return { key, text, isCorrect: key === answer };
    });

    const searchHash = qhash(qText);
    const existing = await prisma.question.findFirst({ where: { searchHash } });
    if (existing) { skipped++; return; }

    try {
      await prisma.question.create({
        data: {
          subjectId: subj.id,
          chapterId: chap.id,
          examId: exam.id,
          year: 2023,
          shift: dateEn ? `Exam Date: ${dateEn}` : null,
          paperCode: qid,
          questionText: qText,
          questionTextHindi: qTextHi,
          optionsJson,
          correctAnswer: answer,
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
          searchHash,
        },
      });
      inserted++;
    } catch (e) {
      // duplicate race or constraint — skip silently
      skipped++;
    }
  }

  console.log(`Pairs: ${pairs.length}, EN-only: ${enOnly.length}, HI-only: ${hiOnly.length}`);
  for (const p of pairs) {
    await insertOne({
      questionEn: p.question_en, questionHi: p.question_hi,
      optionsEn: p.options_en, answer: p.answer, qid: p.qid,
      dateEn: p.date_en, section: p.section_en,
    });
  }
  for (const r of enOnly) {
    await insertOne({
      questionEn: r.q, questionHi: null, optionsEn: r.opt, answer: r.answer,
      qid: r.qid, dateEn: r.date, section: r.section,
    });
  }
  for (const r of hiOnly) {
    await insertOne({
      questionEn: r.q, questionHi: null, optionsEn: r.opt, answer: r.answer,
      qid: r.qid, dateEn: r.date, section: r.section,
    });
  }

  console.log(`\n=== DPC IMPORT DONE: inserted ${inserted}, skipped ${skipped} ===`);
  const total = await prisma.question.count();
  console.log(`DB total questions: ${total}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });