#!/usr/bin/env node
/**
 * Import Delhi Police HC AWO/TPO 2022 + SSC JE 2021 (green-marked text-based) — VERIFIED_OFFICIAL.
 * Sources: /tmp/pyq_inspect/hc.json (151), /tmp/pyq_inspect/je_civil.json (58 text Qs)
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import fs from 'node:fs';

const prisma = new PrismaClient();

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
const qhash = (t) => createHash('sha256').update(t).digest('hex').slice(0, 40);

const SECTION_ALIAS = {
  'general intelligence and reasoning': 'Reasoning',
  'general awareness': 'General Awareness',
  'quantitative aptitude': 'Quantitative Aptitude',
  'numerical ability': 'Quantitative Aptitude',
  'english comprehension': 'English',
};

async function insertOne(r, exam, yearDefault) {
  const q = (r.q || '').trim();
  if (q.length < 5) return 0;
  if (!['A', 'B', 'C', 'D'].includes(r.answer)) return 0;
  if ((r.opt || []).length < 2) return 0;
  const secRaw = (r.section || '').trim();
  const secName = SECTION_ALIAS[secRaw.toLowerCase()] || (secRaw || 'General Awareness');
  const subj = await getSubject(secName);
  const chap = await getChapter(subj.id, secName);
  const optionsJson = r.opt.map((o) => {
    const m = o.match(/^([A-D])\.\s?(.*)$/s);
    const key = m ? m[1] : '?';
    const text = m ? m[2].trim() : o;
    return { key, text, isCorrect: key === r.answer };
  });
  const hash = qhash(q);
  if (await prisma.question.findFirst({ where: { searchHash: hash } })) return 0;
  const year = (r.date || '').match(/(20\d{2})/)?.[1] ? parseInt((r.date.match(/(20\d{2})/))[1], 10) : yearDefault;
  await prisma.question.create({
    data: {
      subjectId: subj.id, chapterId: chap.id, examId: exam.id, year,
      shift: r.date ? `Exam: ${r.date}` : null,
      paperCode: r.qid || null,
      questionText: q, questionTextHindi: null, optionsJson,
      correctAnswer: r.answer,
      explanationSource: 'PDF', translationStatus: 'AUTO_UNVERIFIED',
      answerVerificationStatus: 'VERIFIED_OFFICIAL', lastVerifiedAt: new Date(),
      isApproved: true, isActive: true, difficulty: 'MEDIUM',
      marks: 1.0, negativeMarks: 0.25, searchHash: hash,
    },
  });
  return 1;
}

async function main() {
  const hc = JSON.parse(fs.readFileSync('/tmp/pyq_inspect/hc.json', 'utf-8'));
  const jeCivil = JSON.parse(fs.readFileSync('/tmp/pyq_inspect/je_civil.json', 'utf-8'));
  const hcExam = await getExam('Delhi Police HC AWO/TPO', 'delhi-police-hc-awo-tpo', 'DPHC');
  const jeExam = await getExam('SSC JE', 'je', 'JE');
  let hcIn = 0, jeIn = 0;
  for (const r of hc) hcIn += await insertOne(r, hcExam, 2022);
  for (const r of jeCivil) jeIn += await insertOne(r, jeExam, 2021);
  console.log(`HC inserted: ${hcIn} | JE civil inserted: ${jeIn}`);
  const total = await prisma.question.count();
  console.log(`DB total: ${total}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });