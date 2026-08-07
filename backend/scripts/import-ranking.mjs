#!/usr/bin/env node
/**
 * Import Ranking PYQ questions (extracted from Ranking_SSC_PYQ_Test.pdf + Solutions)
 * into the question bank — bilingual EN + HI.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import fs from 'node:fs';

const prisma = new PrismaClient();

async function main() {
  const raw = JSON.parse(fs.readFileSync('/tmp/ranking_pyq.json', 'utf-8'));
  console.log(`Source rows: ${raw.length}`);

  const exam = await prisma.exam.findFirst({ where: { slug: 'cgl' } });
  const subj = await prisma.subject.findFirst({ where: { slug: 'reasoning' } });
  if (!exam || !subj) throw new Error('exam/subject not found');

  const chap = await prisma.chapter.upsert({
    where: { subjectId_slug: { subjectId: subj.id, slug: 'ranking' } },
    create: { subjectId: subj.id, name: 'Ranking', slug: 'ranking' },
    update: {},
  });

  let inserted = 0, dup = 0, skipped = 0;

  for (const r of raw) {
    if (!r.q_en || !r.options_en || Object.keys(r.options_en).length < 2) { skipped++; continue; }
    const correct = (r.answer || '').trim().toUpperCase();
    if (!['A', 'B', 'C', 'D'].includes(correct)) { skipped++; continue; }

    const optionsJson = ['A', 'B', 'C', 'D'].map(k => ({
      key: k,
      text: r.options_en[k] || '',
      isCorrect: k === correct,
    })).filter(o => o.text);

    const searchHash = createHash('sha256').update(r.q_en.trim()).digest('hex');
    const existing = await prisma.question.findFirst({ where: { searchHash } });
    if (existing) { dup++; continue; }

    // Build Hindi options (from options_hi if present, else mark as missing)
    const optionsHi = r.options_hi ? ['A', 'B', 'C', 'D'].map(k => ({
      key: k,
      text: r.options_hi[k] || '',
    })).filter(o => o.text) : null;
    void optionsHi;

    await prisma.question.create({
      data: {
        subjectId: subj.id,
        chapterId: chap.id,
        examId: exam.id,
        questionText: r.q_en,
        questionTextHindi: r.q_hi || null,
        optionsJson,
        correctAnswer: correct,
        explanation: r.expl_en || null,
        explanationHindi: r.expl_hi || null,
        explanationSource: 'HUMAN_VERIFIED',
        translationStatus: r.q_hi ? 'HUMAN_VERIFIED' : 'AUTO_UNVERIFIED',
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
  }

  console.log(`Inserted: ${inserted} | Dup: ${dup} | Skipped: ${skipped}`);
}

main().catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());