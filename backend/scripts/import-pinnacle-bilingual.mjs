#!/usr/bin/env node
/**
 * import-pinnacle-bilingual.mjs — SSC Prep Hub
 * ------------------------------------------------------------------
 * Imports the ENHANCED, fully-bilingual reasoning files from
 *      backend/extract/pinnacle-enhanced/*.json
 * into the Question table.
 *
 * These files use the same shape as Hermes's pinnacle import, PLUS Hindi:
 *   book_q, q, q_hi, exam, date, shift, year,
 *   opt_a..opt_d, opt_a_hi..opt_d_hi, ans,
 *   expl_en, expl_hi, trick_en, trick_hi, diff, topic, has_fig,
 *   (optional) needs_review, review_note
 *
 * Unlike import-pinnacle.mjs, this one:
 *   • sets questionTextHindi (from q_hi)
 *   • stores Hindi option text (optionsJson element = {key,text,textHi,isCorrect})
 *   • fills explanation (expl_en) and explanationHindi (expl_hi)
 *
 * SAFETY:
 *   • Matches an existing DB question by searchHash (sha256 of the English question text).
 *   • If the DB row ALREADY has a correctAnswer and it disagrees with this file's `ans`
 *     → the row is SKIPPED with a warning (never overwrite a verified answer).
 *   • Rows with needs_review:true, or has_fig without a valid ans, are skipped.
 *   • DRY_RUN=1 previews counts without writing.
 *
 * Run inside the backend container:
 *   docker cp backend/extract/pinnacle-enhanced ssc-backend:/app/pinnacle-enhanced
 *   docker cp backend/scripts/import-pinnacle-bilingual.mjs ssc-backend:/app/
 *   docker exec -e DRY_RUN=1 ssc-backend node /app/import-pinnacle-bilingual.mjs /app/pinnacle-enhanced
 *   docker exec ssc-backend node /app/import-pinnacle-bilingual.mjs /app/pinnacle-enhanced
 * ------------------------------------------------------------------
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import fs from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === '1';

const dir = process.argv[2] || 'backend/extract/pinnacle-enhanced';

const EXAM_SLUGS = {
  'SSC CGL': 'cgl', 'SSC CGL Pre': 'cgl-pre', 'SSC CHSL': 'chsl', 'SSC CPO': 'cpo',
  'SSC MTS': 'mts', 'SSC GD': 'gd', 'SSC Steno': 'steno', 'SSC JE': 'je',
};
function normalizeExam(raw) {
  const key = (raw || '').trim().toLowerCase();
  const map = {
    'ssc': 'SSC CGL', 'ssc cgl': 'SSC CGL', 'ssc cgl tier-1': 'SSC CGL',
    'ssc cgl tier i': 'SSC CGL', 'ssc cgl tier 1': 'SSC CGL', 'ssc cgl pre': 'SSC CGL Pre',
    'ssc chsl': 'SSC CHSL', 'ssc chsl tier-1': 'SSC CHSL',
    'ssc cpo': 'SSC CPO', 'ssc cpo tier-1': 'SSC CPO',
    'ssc mts': 'SSC MTS', 'ssc gd': 'SSC GD',
    'ssc stenographer': 'SSC Steno', 'ssc je': 'SSC JE', 'delhi police': 'SSC GD',
  };
  return map[key] || 'SSC CGL';
}
function parseTopic(raw) {
  const s = (raw || '').trim();
  if (s.includes('—')) {
    const [subj, ...rest] = s.split('—');
    const subject = subj.trim().charAt(0).toUpperCase() + subj.trim().slice(1);
    const chapter = rest.join('—').trim() || 'General';
    return { subject, chapter };
  }
  return { subject: 'Reasoning', chapter: s || 'General' };
}

const examCache = {}, subjectCache = {}, chapterCache = {};
async function getExam(name) {
  if (examCache[name]) return examCache[name];
  const slug = EXAM_SLUGS[name] || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  let exam = await prisma.exam.findFirst({ where: { slug } });
  if (!exam) exam = await prisma.exam.findFirst({ where: { slug: 'cgl' } });
  if (!exam) throw new Error(`No exam found for: ${name}`);
  examCache[name] = exam; return exam;
}
async function getSubject(name) {
  if (subjectCache[name]) return subjectCache[name];
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
  let subj = await prisma.subject.findFirst({ where: { slug } });
  if (!subj) subj = await prisma.subject.create({ data: { name, slug } });
  subjectCache[name] = subj; return subj;
}
async function getChapter(subjectId, name) {
  const key = `${subjectId}:${name}`;
  if (chapterCache[key]) return chapterCache[key];
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  let chap;
  try {
    chap = await prisma.chapter.upsert({
      where: { subjectId_slug: { subjectId, slug } },
      create: { subjectId, name, slug }, update: {},
    });
  } catch {
    chap = await prisma.chapter.findFirst({ where: { subjectId, slug } });
  }
  chapterCache[key] = chap; return chap;
}

function nonEmpty(s) { return typeof s === 'string' && s.trim().length > 0; }

async function main() {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  console.log(`Found ${files.length} file(s) in ${dir}${DRY_RUN ? '   (DRY RUN — no writes)' : ''}`);

  let created = 0, updated = 0, skippedReview = 0, skippedFig = 0,
      skippedMismatch = 0, skippedBad = 0, errors = 0;

  for (const file of files) {
    const rows = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
    if (!Array.isArray(rows) || !rows.length) continue;
    console.log(`\n# ${file}: ${rows.length} questions`);

    for (const q of rows) {
      try {
        if (q.needs_review === true) { skippedReview++; continue; }
        const qText = (q.q || '').trim();
        const ans = (q.ans || '').trim().toUpperCase();
        const opts = { A: q.opt_a, B: q.opt_b, C: q.opt_c, D: q.opt_d };
        const optsHi = { A: q.opt_a_hi, B: q.opt_b_hi, C: q.opt_c_hi, D: q.opt_d_hi };
        const optKeys = ['A', 'B', 'C', 'D'].filter((k) => nonEmpty(opts[k]));

        if (qText.length < 10 || optKeys.length < 2) { skippedBad++; continue; }
        if (!['A', 'B', 'C', 'D'].includes(ans)) {
          if (q.has_fig) { skippedFig++; } else { skippedBad++; }
          continue;
        }

        const optionsJson = optKeys.map((k) => ({
          key: k, text: String(opts[k]),
          ...(nonEmpty(optsHi[k]) ? { textHi: String(optsHi[k]).trim() } : {}),
          isCorrect: k === ans,
        }));

        const searchHash = createHash('sha256').update(qText).digest('hex');
        const existing = await prisma.question.findFirst({
          where: { searchHash },
          select: { id: true, correctAnswer: true },
        });

        const bilingual = {
          questionTextHindi: nonEmpty(q.q_hi) ? q.q_hi.trim() : null,
          optionsJson,
          explanation: nonEmpty(q.expl_en) ? q.expl_en.trim() : null,
          explanationHindi: nonEmpty(q.expl_hi) ? q.expl_hi.trim() : null,
          explanationSource: 'AI_GENERATED',
          reviewStatus: 'IN_REVIEW',
        };

        if (existing) {
          // SAFETY: never overwrite an existing verified answer that disagrees.
          if (nonEmpty(existing.correctAnswer) && existing.correctAnswer !== ans) {
            console.warn(`  ! ANSWER MISMATCH (skip) hash=${searchHash.slice(0, 8)} db=${existing.correctAnswer} file=${ans}`);
            skippedMismatch++; continue;
          }
          if (!DRY_RUN) {
            await prisma.question.update({
              where: { id: existing.id },
              data: { ...bilingual, correctAnswer: ans, translationStatus: 'AUTO_UNVERIFIED' },
            });
          }
          updated++;
        } else {
          const exam = await getExam(normalizeExam(q.exam));
          const { subject, chapter } = parseTopic(q.topic);
          const subj = await getSubject(subject);
          const chap = await getChapter(subj.id, chapter);
          if (!DRY_RUN) {
            await prisma.question.create({
              data: {
                subjectId: subj.id, chapterId: chap.id, examId: exam.id,
                year: q.year ? parseInt(q.year, 10) || null : null,
                shift: q.shift || null,
                questionText: qText,
                ...bilingual,
                correctAnswer: ans,
                translationStatus: 'AUTO_UNVERIFIED',
                difficulty: { easy: 'EASY', medium: 'MEDIUM', hard: 'HARD' }[(q.diff || '').toLowerCase()] || 'MEDIUM',
                marks: 2.0, negativeMarks: 0.5, isApproved: true, searchHash,
              },
            });
          }
          created++;
        }
      } catch (e) {
        console.warn(`  ! error: ${e.message}`);
        errors++;
      }
    }
  }

  console.log('\n=== IMPORT SUMMARY ===');
  console.log(`${DRY_RUN ? 'WOULD create' : 'Created'}      : ${created}`);
  console.log(`${DRY_RUN ? 'WOULD update' : 'Updated'}      : ${updated}`);
  console.log(`Skipped review    : ${skippedReview}`);
  console.log(`Skipped figure    : ${skippedFig}`);
  console.log(`Skipped mismatch  : ${skippedMismatch}`);
  console.log(`Skipped bad/short : ${skippedBad}`);
  console.log(`Errors            : ${errors}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('FATAL:', e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
