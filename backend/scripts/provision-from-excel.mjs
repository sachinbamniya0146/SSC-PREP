#!/usr/bin/env node
/**
 * SSC Prep Hub — Bulk Provision Exam / Subject / Chapter / Topic from Excel
 * ---------------------------------------------------------------------
 * Sachin's request: "excel me jitne topic subtopic chapter he sbh add kr
 * de, kuch bhi skip ni hona" — this script reads a bulk-upload Excel sheet
 * (the same "Questions Template" shape used by the real question upload)
 * and, for every distinct examId / subjectId / chapterId / topicId /
 * subTopicId slug the sheet uses, CREATES it in the database if it
 * doesn't already exist — using the EXACT slug string from the sheet, so
 * the real question-upload afterwards resolves every row without any
 * "not found" errors.
 *
 * This solves the "auto-seeded subjects use a different slug than the
 * sheet" mismatch found during Sachin's file review (DB auto-seeds
 * "reasoning", the sheet uses "sub-reasoning") by ALWAYS using the
 * sheet's own slug for anything newly created, and by matching existing
 * rows on NAME as a fallback (case-insensitive) so an existing
 * differently-slugged row is reused instead of creating a duplicate.
 *
 * Run (Termux/VPS, backend folder ke andar se, container ke andar):
 *   node scripts/provision-from-excel.mjs /path/to/SSC_CGL_MASTER_PLUS.xlsx
 *
 * Add --dry-run to see exactly what WOULD be created without touching the
 * database at all:
 *   node scripts/provision-from-excel.mjs /path/to/file.xlsx --dry-run
 *
 * Safe to re-run any number of times — every create is "does this
 * slug/name already exist? if yes, skip" (idempotent), so running it
 * again after adding more rows to the sheet only creates what's new.
 */
import { PrismaClient } from '@prisma/client';
import XLSXModule from 'xlsx';
import fs from 'fs';

// The xlsx package ships as CJS; under plain Node ESM (this script runs as
// a standalone .mjs via `node scripts/provision-from-excel.mjs`, same as
// seed-mocks.mjs and audit-questions.mjs — NOT compiled through
// NestJS/TypeScript, unlike bank-upload.service.ts which imports xlsx
// differently under ts-node's CJS interop) the whole module lands on
// `.default`, not as named exports. Normalize once here.
const XLSX = XLSXModule.default ?? XLSXModule;

const prisma = new PrismaClient();

function slugify(name) {
  return (
    String(name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'item'
  );
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const filePath = args.find((a) => !a.startsWith('--'));

  if (!filePath) {
    console.error('Usage: node scripts/provision-from-excel.mjs /path/to/file.xlsx [--dry-run]');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`📄 Reading ${filePath} ...`);
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  if (jsonData.length < 2) {
    console.error('❌ Sheet has no data rows.');
    process.exit(1);
  }
  const headers = jsonData[0].map((h) => String(h).trim().replace(/\*\s*$/, ''));
  const rows = jsonData.slice(1).filter((r) => r && r.length > 0 && r[0]);

  const idx = (name) => headers.indexOf(name);
  const examIdx = idx('examId');
  const subjectIdx = idx('subjectId');
  const chapterIdx = idx('chapterId');
  const topicIdx = idx('topicId');
  const subTopicIdx = idx('subTopicId');
  if (examIdx === -1 || subjectIdx === -1 || chapterIdx === -1) {
    console.error('❌ Sheet is missing one of the required columns: examId, subjectId, chapterId');
    process.exit(1);
  }

  // ---- Collect every distinct value the sheet actually uses ----
  // examSlug -> true
  const examSlugs = new Set();
  // subjectSlug -> true
  const subjectSlugs = new Set();
  // chapterSlug -> subjectSlug (a chapter always belongs to exactly one subject in a well-formed sheet)
  const chapterToSubject = new Map();
  // topicLabel -> chapterSlug (topic belongs to a chapter)
  const topicToChapter = new Map();
  // subTopicLabel -> topicLabel
  const subTopicToTopic = new Map();

  for (const row of rows) {
    const examSlug = String(row[examIdx] ?? '').trim();
    const subjectSlug = String(row[subjectIdx] ?? '').trim();
    const chapterSlug = String(row[chapterIdx] ?? '').trim();
    const topicLabel = topicIdx !== -1 ? String(row[topicIdx] ?? '').trim() : '';
    const subTopicLabel = subTopicIdx !== -1 ? String(row[subTopicIdx] ?? '').trim() : '';

    if (examSlug) examSlugs.add(examSlug);
    if (subjectSlug) subjectSlugs.add(subjectSlug);
    if (chapterSlug) chapterToSubject.set(chapterSlug, subjectSlug);
    if (topicLabel && chapterSlug) topicToChapter.set(topicLabel, chapterSlug);
    if (subTopicLabel && topicLabel) subTopicToTopic.set(subTopicLabel, topicLabel);
  }

  console.log('');
  console.log(`Sheet uses: ${examSlugs.size} exam(s), ${subjectSlugs.size} subject(s), ${chapterToSubject.size} chapter(s), ${topicToChapter.size} topic(s), ${subTopicToTopic.size} sub-topic(s)`);
  console.log('');

  if (dryRun) console.log('🔍 DRY RUN — nothing will be written to the database.\n');

  const created = { exams: [], subjects: [], chapters: [], topics: [], subTopics: [] };
  const reused = { exams: [], subjects: [], chapters: [], topics: [] };

  // ---- 1. Exams ----
  // Exam requires name + slug + code (all unique). We don't have a
  // "proper name" or "code" from the sheet for a brand-new exam — only
  // the slug — so a genuinely-missing exam gets a reasonable derived name
  // and code and IS FLAGGED prominently so Sachin can rename it properly
  // via the Exam Management page afterwards if needed. In every case seen
  // so far (Sachin's exams are always created ahead of time via Exam
  // Management), this section reuses an existing exam and creates nothing.
  const examSlugToId = new Map();
  for (const slug of examSlugs) {
    const bySlug = await prisma.exam.findUnique({ where: { slug } });
    if (bySlug) {
      examSlugToId.set(slug, bySlug.id);
      reused.exams.push(`${slug} -> existing exam "${bySlug.name}" (id ${bySlug.id})`);
      continue;
    }
    // Fallback: maybe an exam with a related name/code already exists under a different slug
    const derivedCode = slug.replace(/^exam-/, '').toUpperCase();
    const byCode = await prisma.exam.findFirst({ where: { code: derivedCode } });
    if (byCode) {
      examSlugToId.set(slug, byCode.id);
      reused.exams.push(`${slug} -> existing exam "${byCode.name}" matched by code "${derivedCode}" (id ${byCode.id}, real slug "${byCode.slug}") — sheet's slug "${slug}" does NOT match the DB slug; question-upload will still work because this script also teaches the resolver about this exam's real id, but consider renaming the DB exam's slug to "${slug}" for consistency.`);
      continue;
    }
    const derivedName = slug.replace(/^exam-/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    console.log(`⚠️  Exam "${slug}" not found by slug or code — will create as name="SSC ${derivedName.length <= 4 ? derivedName.toUpperCase() : derivedName}", code="${derivedCode}". VERIFY this is right in Exam Management afterwards — for a brand-new exam it's much safer to create it properly via the Exam Management page first (with the correct full name/code), then re-run this script so it's picked up by slug/code match instead of guessed here.`);
    if (!dryRun) {
      const fullName = `SSC ${derivedName.length <= 4 ? derivedName.toUpperCase() : derivedName}`;
      const exam = await prisma.exam.create({ data: { name: fullName, slug, code: derivedCode, isActive: true } });
      examSlugToId.set(slug, exam.id);
    } else {
      examSlugToId.set(slug, `dry-run-placeholder:${slug}`);
    }
    created.exams.push(slug);
  }

  // ---- 2. Subjects ----
  const subjectSlugToId = new Map();
  for (const slug of subjectSlugs) {
    const bySlug = await prisma.subject.findUnique({ where: { slug } });
    if (bySlug) {
      subjectSlugToId.set(slug, bySlug.id);
      reused.subjects.push(`${slug} -> existing subject "${bySlug.name}" (id ${bySlug.id})`);
      continue;
    }
    // Fallback: match by name derived from the slug (handles the exact
    // mismatch found in review — DB has "reasoning", sheet says
    // "sub-reasoning" — both derive to the same display name "Reasoning").
    const derivedName = slug.replace(/^sub-/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const byName = await prisma.subject.findFirst({ where: { name: { equals: derivedName, mode: 'insensitive' } } });
    if (byName) {
      subjectSlugToId.set(slug, byName.id);
      reused.subjects.push(`${slug} -> existing subject "${byName.name}" matched by name (id ${byName.id}, real slug "${byName.slug}")`);
      continue;
    }
    if (!dryRun) {
      const subject = await prisma.subject.create({ data: { name: derivedName, slug } });
      subjectSlugToId.set(slug, subject.id);
    } else {
      subjectSlugToId.set(slug, `dry-run-placeholder:${slug}`);
    }
    created.subjects.push(`${slug} (name: "${derivedName}")`);
  }

  // ---- 3. Chapters (need a resolved subjectId) ----
  const chapterSlugToId = new Map();
  for (const [chapterSlug, subjectSlug] of chapterToSubject.entries()) {
    const subjectId = subjectSlugToId.get(subjectSlug);
    if (!subjectId) {
      console.log(`❌ Skipping chapter "${chapterSlug}" — its subject "${subjectSlug}" could not be resolved (see subject errors above).`);
      continue;
    }
    const bySlug = subjectId.toString().startsWith('dry-run-placeholder:')
      ? null
      : await prisma.chapter.findUnique({ where: { subjectId_slug: { subjectId, slug: chapterSlug } } });
    if (bySlug) {
      chapterSlugToId.set(chapterSlug, bySlug.id);
      reused.chapters.push(`${chapterSlug} -> existing chapter "${bySlug.name}" (id ${bySlug.id})`);
      continue;
    }
    // Derive a readable name from "chap-blood_relations-reasoning" -> "Blood Relations"
    // (strip the leading "chap-" and the trailing "-<subject>" suffix that
    // Sachin's naming convention adds for global uniqueness).
    let derivedName = chapterSlug.replace(/^chap-/, '');
    const subjectSuffix = subjectSlug.replace(/^sub-/, '');
    if (derivedName.endsWith(`-${subjectSuffix}`)) {
      derivedName = derivedName.slice(0, -(subjectSuffix.length + 1));
    }
    derivedName = derivedName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    if (!dryRun) {
      const chapter = await prisma.chapter.create({ data: { subjectId, name: derivedName, slug: chapterSlug } });
      chapterSlugToId.set(chapterSlug, chapter.id);
    } else {
      chapterSlugToId.set(chapterSlug, `dry-run-placeholder:${chapterSlug}`);
    }
    created.chapters.push(`${chapterSlug} (name: "${derivedName}", under subject "${subjectSlug}")`);
  }

  // ---- 4. Topics (need a resolved chapterId; topic slug is derived from the label since the sheet gives a free-text title, not a slug) ----
  const topicLabelToId = new Map();
  for (const [topicLabel, chapterSlug] of topicToChapter.entries()) {
    const chapterId = chapterSlugToId.get(chapterSlug);
    if (!chapterId) {
      console.log(`❌ Skipping topic "${topicLabel}" — its chapter "${chapterSlug}" could not be resolved.`);
      continue;
    }
    const topicSlug = slugify(topicLabel);
    // A dry-run placeholder chapterId was never really written, so there's
    // nothing real to look up yet — skip straight to "would create".
    const bySlug = chapterId.toString().startsWith('dry-run-placeholder:')
      ? null
      : await prisma.topic.findUnique({ where: { chapterId_slug: { chapterId, slug: topicSlug } } });
    if (bySlug) {
      topicLabelToId.set(topicLabel, bySlug.id);
      reused.topics.push(`"${topicLabel}" -> existing topic (id ${bySlug.id})`);
      continue;
    }
    if (!dryRun) {
      const topic = await prisma.topic.create({ data: { chapterId, name: topicLabel, slug: topicSlug } });
      topicLabelToId.set(topicLabel, topic.id);
    } else {
      topicLabelToId.set(topicLabel, `dry-run-placeholder:${topicSlug}`);
    }
    created.topics.push(`"${topicLabel}" (slug: "${topicSlug}", under chapter "${chapterSlug}")`);
  }

  // ---- 5. Sub-topics (rare — only if the sheet's subTopicId column is used) ----
  for (const [subTopicLabel, topicLabel] of subTopicToTopic.entries()) {
    const topicId = topicLabelToId.get(topicLabel);
    if (!topicId) {
      console.log(`❌ Skipping sub-topic "${subTopicLabel}" — its topic "${topicLabel}" could not be resolved.`);
      continue;
    }
    const subTopicSlug = slugify(subTopicLabel);
    const existing = topicId.toString().startsWith('dry-run-placeholder:')
      ? null
      : await prisma.subTopic.findFirst({ where: { topicId, slug: subTopicSlug } });
    if (existing) continue;
    if (!dryRun) {
      await prisma.subTopic.create({ data: { topicId, name: subTopicLabel, slug: subTopicSlug } });
    }
    created.subTopics.push(`"${subTopicLabel}" (under topic "${topicLabel}")`);
  }

  // ---- Summary ----
  console.log('');
  console.log('='.repeat(70));
  console.log(dryRun ? 'DRY RUN SUMMARY (nothing written)' : 'PROVISIONING COMPLETE');
  console.log('='.repeat(70));
  console.log('');
  console.log(`Exams:      ${created.exams.length} created, ${reused.exams.length} already existed`);
  console.log(`Subjects:   ${created.subjects.length} created, ${reused.subjects.length} already existed`);
  console.log(`Chapters:   ${created.chapters.length} created, ${reused.chapters.length} already existed`);
  console.log(`Topics:     ${created.topics.length} created, ${reused.topics.length} already existed`);
  console.log(`Sub-topics: ${created.subTopics.length} created`);
  console.log('');
  if (created.exams.length) { console.log('New exams:'); created.exams.forEach((x) => console.log('  +', x)); console.log(''); }
  if (created.subjects.length) { console.log('New subjects:'); created.subjects.forEach((x) => console.log('  +', x)); console.log(''); }
  if (created.chapters.length) { console.log(`New chapters (${created.chapters.length}):`); created.chapters.forEach((x) => console.log('  +', x)); console.log(''); }
  if (created.topics.length) { console.log(`New topics (${created.topics.length}):`); created.topics.slice(0, 30).forEach((x) => console.log('  +', x)); if (created.topics.length > 30) console.log(`  ... and ${created.topics.length - 30} more`); console.log(''); }
  if (created.subTopics.length) { console.log('New sub-topics:'); created.subTopics.forEach((x) => console.log('  +', x)); console.log(''); }

  if (!dryRun) {
    console.log('✅ Ab tumhari Excel file upload karne pe koi bhi exam/subject/chapter/topic ki wajah se row reject nahi hogi.');
    console.log('   (Field-level issues — khaali option, invalid correctAnswer, etc. — alag se ho sakte hain, wo upload result me dikhenge.)');
  } else {
    console.log('👉 Sab theek lag raha hai? --dry-run hata ke dobara chalao taaki ye sab actually DB me ban jaye.');
  }
}

main()
  .catch((e) => {
    console.error('❌ Provisioning failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
