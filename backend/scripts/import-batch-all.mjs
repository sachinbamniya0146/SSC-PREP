#!/usr/bin/env node
/**
 * Import ALL batch-extracted green-marked PYQ JSONs (style: import-dpc-bilingual).
 * Skips: image/no-text records, non-A-D answers, dup hash, DPC 2023 (already in).
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import fs from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();
const qhash = (t) => createHash('sha256').update(t).digest('hex').slice(0, 40);

const examCache = new Map();
async function getExam(name) {
  if (examCache.has(name)) return examCache.get(name);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  let exam = await prisma.exam.findFirst({ where: { OR: [{ slug }, { name }] } });
  if (!exam) {
    try { exam = await prisma.exam.create({ data: { name, slug, code: slug.slice(0, 6).toUpperCase() } }); }
    catch { exam = await prisma.exam.findFirst({ where: { OR: [{ slug }, { name }] } }); }
  }
  examCache.set(name, exam);
  return exam;
}
const subjCache = new Map();
async function getSubject(name) {
  if (subjCache.has(name)) return subjCache.get(name);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
  let s = await prisma.subject.findFirst({ where: { OR: [{ slug }, { name }] } });
  if (!s) {
    try { s = await prisma.subject.create({ data: { name, slug } }); }
    catch { s = await prisma.subject.findFirst({ where: { OR: [{ slug }, { name }] } }); }
  }
  subjCache.set(name, s);
  return s;
}
const chapCache = new Map();
async function getChapter(subjectId, name) {
  const key = subjectId + '|' + name;
  if (chapCache.has(key)) return chapCache.get(key);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  let c = await prisma.chapter.findFirst({ where: { subjectId, OR: [{ slug }, { name }] } });
  if (!c) {
    try { c = await prisma.chapter.create({ data: { subjectId, name, slug } }); }
    catch { c = await prisma.chapter.findFirst({ where: { subjectId, OR: [{ slug }, { name }] } }); }
  }
  chapCache.set(key, c);
  return c;
}
// subject/chapter from python classifier output (positional: file -> array aligned with records)
const CLASS = JSON.parse(fs.readFileSync('/tmp/pyq_inspect/classify_pos.json', 'utf-8'));

async function main() {
  const dir = '/tmp/pyq_inspect/batch_out';
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  console.log('files:', files.length);
  const DPC_SLUG = 'delhi-police-constable';
  let inserted = 0, skipped = 0, dup = 0;
  for (const fn of files) {
    const recs = JSON.parse(fs.readFileSync(path.join(dir, fn), 'utf-8'));
    if (!Array.isArray(recs) || !recs.length) { skipped += recs.length || 0; continue; }
    const examName = recs[0].exam || 'SSC General';
    if (examName === 'Delhi Police Constable') { skipped += recs.length; continue; } // already imported
    const exam = await getExam(examName);
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      const q = (r.q || '').trim();
      if (q.length < 6) { skipped++; continue; }
      if (!['A', 'B', 'C', 'D'].includes(r.answer)) { skipped++; continue; }
      const optRaw = r.opt || [];
      if (optRaw.length < 2) { skipped++; continue; }
      const hash = qhash(q);
      if (await prisma.question.findFirst({ where: { searchHash: hash } })) { dup++; continue; }
      // options
      const sa = (r.section || '').trim().toLowerCase();
      const optionsJson = optRaw.map((o, i) => {
        const m = o.match(/^([A-D])\.\s?(.*)$/s);
        const key = m ? m[1] : String.fromCharCode(65 + i);
        const text = (m ? m[2].trim() : o).replace(/\s+/g, ' ');
        return { key, text, isCorrect: key === r.answer };
      });
      const sc = (CLASS[fn] || [])[i] || ['General Awareness', 'General Awareness'];
      const subj = await getSubject(sc[0]);
      const chap = await getChapter(subj.id, sc[1]);
      const dateStr = (r.date || '').match(/20\d{2}/)?.[0];
      await prisma.question.create({
        data: {
          subjectId: subj.id, chapterId: chap.id, examId: exam.id,
          year: dateStr ? parseInt(dateStr, 10) : null,
          shift: r.date && r.time ? `${r.date} ${r.time}` : (r.date || null),
          paperCode: r.qid || null,
          questionText: q,
          questionTextHindi: /[\u0900-\u097F]/.test(q) ? q : null,
          optionsJson,
          correctAnswer: r.answer,
          explanationSource: 'PDF', translationStatus: 'AUTO_UNVERIFIED',
          answerVerificationStatus: 'VERIFIED_OFFICIAL', lastVerifiedAt: new Date(),
          isApproved: true, isActive: true, difficulty: 'MEDIUM',
          marks: 1.0, negativeMarks: 0.25, searchHash: hash,
        },
      });
      inserted++;
    }
    if (inserted % 2000 < 200) console.log(`  ...${inserted} inserted / ${skipped} skip / ${dup} dup`);
  }
  const total = await prisma.question.count();
  console.log(`DONE inserted=${inserted} skipped=${skipped} dup=${dup} | DB total=${total}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });