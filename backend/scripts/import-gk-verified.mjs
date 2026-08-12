#!/usr/bin/env node
/** Import verified GK questions from krishnachaitanya33355/pyqjson */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import fs from 'node:fs';

const prisma = new PrismaClient();

const SUBJECT_MAP = {
  'Static GK': 'General Awareness',
  'History': 'History',
  'Polity': 'Polity',
  'Geography': 'Geography',
  'Economics': 'Economics',
  'Physics': 'Physics',
  'Chemistry': 'Chemistry',
  'Biology': 'Biology',
  'Current Affairs': 'Current Affairs',
};

const EXAM_SLUGS = {
  'SSC CGL': 'cgl',
  'SSC CGL Pre': 'cgl-pre',
  'SSC CHSL': 'chsl',
  'SSC CPO': 'cpo',
  'SSC MTS': 'mts',
  'SSC GD': 'gd',
  'SSC Steno': 'steno',
  'SSC JE': 'je',
  'SSC Stenographer': 'steno',
};

function normalizeExam(examInfo) {
  if (!examInfo) return 'SSC CGL';
  const info = examInfo.toLowerCase();
  if (info.includes('cgl')) return 'SSC CGL';
  if (info.includes('chsl')) return 'SSC CHSL';
  if (info.includes('mts')) return 'SSC MTS';
  if (info.includes('cpo')) return 'SSC CPO';
  if (info.includes('gd')) return 'SSC GD';
  if (info.includes('steno') || info.includes('stenographer')) return 'SSC Steno';
  if (info.includes('je')) return 'SSC JE';
  return 'SSC CGL';
}

function extractYear(examInfo) {
  if (!examInfo) return null;
  const match = examInfo.match(/\b(20\d{2})\b/);
  return match ? parseInt(match[1], 10) : null;
}

function extractShift(examInfo) {
  if (!examInfo) return null;
  const info = examInfo.toLowerCase();
  if (info.includes('1st shift') || info.includes('shift 1') || info.includes('shift i')) return 'Shift 1';
  if (info.includes('2nd shift') || info.includes('shift 2') || info.includes('shift ii')) return 'Shift 2';
  if (info.includes('3rd shift') || info.includes('shift 3') || info.includes('shift iii')) return 'Shift 3';
  if (info.includes('morning')) return 'Shift 1';
  if (info.includes('afternoon')) return 'Shift 2';
  if (info.includes('evening')) return 'Shift 3';
  return null;
}

let subjectCache = {}, examCache = {}, chapterCache = {};

async function getSubject(sectionName) {
  if (subjectCache[sectionName]) return subjectCache[sectionName];
  const subjectName = SUBJECT_MAP[sectionName] || sectionName;
  const slug = subjectName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
  let subj = await prisma.subject.findFirst({ where: { slug } });
  if (!subj) {
    subj = await prisma.subject.create({ data: { name: subjectName, slug } });
  }
  subjectCache[sectionName] = subj;
  return subj;
}

async function getExam(name) {
  if (examCache[name]) return examCache[name];
  const slug = EXAM_SLUGS[name] || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  let exam = await prisma.exam.findFirst({ where: { slug } });
  if (!exam) {
    exam = await prisma.exam.findFirst({ where: { slug: 'cgl' } }); // fallback
  }
  examCache[name] = exam;
  return exam;
}

async function getChapter(subjectId, sectionName) {
  const key = `${subjectId}:${sectionName}`;
  if (chapterCache[key]) return chapterCache[key];
  const slug = sectionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  let chap = await prisma.chapter.findFirst({ where: { subjectId, slug } });
  if (!chap) {
    chap = await prisma.chapter.create({ data: { subjectId, name: sectionName, slug } });
  }
  chapterCache[key] = chap;
  return chap;
}

async function main() {
  console.log('Loading verified GK questions from JSON...');
  const raw = fs.readFileSync('/tmp/ssc_gk_verified.json', 'utf-8');
  const data = JSON.parse(raw);
  
  let totalInserted = 0, totalSkipped = 0;
  
  for (const section of data.sections) {
    const sectionName = section.section_name;
    if (!SUBJECT_MAP[sectionName]) {
      console.log(`Skipping unknown section: ${sectionName}`);
      continue;
    }
    
    const subject = await getSubject(sectionName);
    console.log(`\n=== ${sectionName} (${section.total_questions} questions) ===`);
    
    let inserted = 0, skipped = 0;
    
    for (const q of section.questions) {
      const qText = q.question?.trim();
      const opts = q.options || {};
      const ans = (q.answer || '').toLowerCase();
      
      if (!qText || qText.length < 15) { skipped++; continue; }
      const optKeys = Object.keys(opts).filter(k => opts[k] && opts[k].length > 1);
      if (optKeys.length < 2) { skipped++; continue; }
      if (!['a','b','c','d'].includes(ans)) { skipped++; continue; }
      
      // Build options JSON
      const optionsJson = ['a','b','c','d']
        .filter(k => opts[k] && opts[k].length > 1)
        .map(k => ({ key: k.toUpperCase(), text: opts[k], isCorrect: k === ans }));
      
      if (optionsJson.length < 2) { skipped++; continue; }
      
      const examName = normalizeExam(q.exam_info);
      const exam = await getExam(examName);
      const year = extractYear(q.exam_info);
      const shift = extractShift(q.exam_info);
      
      const chapter = await getChapter(subject.id, sectionName);
      
      // Check for duplicates
      const searchHash = createHash('sha256').update(qText).digest('hex');
      const existing = await prisma.question.findFirst({ where: { searchHash } });
      if (existing) { skipped++; continue; }
      
      try {
        await prisma.question.create({
          data: {
            subjectId: subject.id,
            chapterId: chapter.id,
            examId: exam?.id,
            year,
            shift,
            questionText: qText,
            questionTextHindi: null,
            optionsJson,
            correctAnswer: ans.toUpperCase(),
            explanation: `Source: ${q.exam_info || 'SSC PYQ'}`,
            explanationHindi: null,
            explanationSource: 'HUMAN_VERIFIED',
            translationStatus: 'AUTO_UNVERIFIED',
            difficulty: 'MEDIUM',
            marks: 1.0,
            negativeMarks: 0.25,
            isApproved: true,
            isActive: true,
            searchHash,
          },
        });
        inserted++;
      } catch (e) {
        skipped++;
      }
    }
    
    console.log(`  Inserted: ${inserted} | Skipped: ${skipped}`);
    totalInserted += inserted;
    totalSkipped += skipped;
  }
  
  console.log(`\n=== TOTAL: Inserted ${totalInserted}, Skipped ${totalSkipped} ===`);
  
  // Final stats
  const total = await prisma.question.count();
  const bySubject = await prisma.subject.findMany({
    include: { _count: { select: { questions: true } } }
  });
  console.log('\n=== Questions by Subject ===');
  for (const s of bySubject) {
    console.log(`  ${s.name}: ${s._count.questions}`);
  }
  console.log(`\n=== GRAND TOTAL: ${total} ===`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());