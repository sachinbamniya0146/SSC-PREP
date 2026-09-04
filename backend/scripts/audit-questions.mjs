#!/usr/bin/env node
/**
 * SSC Prep Hub — Question Bank Full Audit
 * ----------------------------------------
 * Sachin's request: "ek ek question ko search karo, kaha kya samasya hai —
 * translation missing, exam mapping galat, session/shift missing, marking
 * galat" — is script se poori DB scan hoti hai aur EXACT problem report
 * banti hai (question ID, exam, subject, year, kya galat hai — sab).
 *
 * Run (Termux/VPS, backend folder ke andar se):
 *   node scripts/audit-questions.mjs
 *
 * Output: two files in backend/audit-output/
 *   1. audit-summary.txt   — human-readable Hinglish summary + counts
 *   2. audit-details.csv   — every problem question, one row per issue,
 *                            open in Excel/Google Sheets to fix one by one
 *
 * Nothing here is destructive — read-only queries, no writes to the DB.
 */
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const OUT_DIR = path.join(process.cwd(), 'audit-output');

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('📊 Loading exams/subjects/chapters/topics for name lookups...');
  const [exams, subjects, chapters, topics] = await Promise.all([
    prisma.exam.findMany({ select: { id: true, name: true, slug: true, code: true } }),
    prisma.subject.findMany({ select: { id: true, name: true, slug: true } }),
    prisma.chapter.findMany({ select: { id: true, name: true, subjectId: true } }),
    prisma.topic.findMany({ select: { id: true, name: true, chapterId: true } }),
  ]);
  const examById = new Map(exams.map((e) => [e.id, e]));
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const chapterById = new Map(chapters.map((c) => [c.id, c]));
  const topicById = new Map(topics.map((t) => [t.id, t]));

  console.log('📥 Loading all questions (this may take a bit on a large bank)...');
  const questions = await prisma.question.findMany({
    select: {
      id: true,
      examId: true,
      subjectId: true,
      chapterId: true,
      topicId: true,
      questionText: true,
      questionTextHindi: true,
      questionDiagramType: true,
      questionImageUrl: true,
      optionsJson: true,
      correctAnswer: true,
      explanation: true,
      explanationHindi: true,
      year: true,
      shift: true,
      paperCode: true,
      marks: true,
      negativeMarks: true,
      isApproved: true,
      isActive: true,
      autoSuspended: true,
      reviewStatus: true,
      answerVerificationStatus: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`   Total questions in DB: ${questions.length}`);

  // ---- Per-question issue detection ----
  const issueRows = []; // one row per (question, issue) for the CSV
  const counts = {
    total: questions.length,
    missingHindiTranslation: 0,
    missingExam: 0,
    examSubjectMismatch: 0, // subject doesn't belong to any chapter used for this exam (heuristic below)
    missingYear: 0,
    missingShift: 0,
    invalidCorrectAnswer: 0,
    correctAnswerOptionEmpty: 0,
    emptyOptionText: 0,
    duplicateOptionKeys: 0,
    notExactly4Options: 0,
    zeroOrNegativeMarks: 0,
    negativeMarksIsPositive: 0, // negativeMarks stored as negative number (double-negation bug)
    missingExplanation: 0,
    missingExplanationHindi: 0,
    blankQuestionText: 0,
    liveButUnapproved: 0, // isApproved=false but isActive=true and not auto-suspended (confusing state)
    approvedWithoutHindi: 0, // isApproved=true but no Hindi text (violates the bilingual gate elsewhere in the app)
    autoSuspended: 0,
    orphanChapter: 0, // chapterId set but not found in chapters table
    orphanTopic: 0,
    chapterSubjectMismatch: 0, // question.chapterId belongs to a different subjectId than question.subjectId
  };

  function addIssue(q, type, detail) {
    counts[type] = (counts[type] || 0) + 1;
    const exam = q.examId ? examById.get(q.examId) : null;
    const subject = subjectById.get(q.subjectId);
    const chapter = q.chapterId ? chapterById.get(q.chapterId) : null;
    issueRows.push({
      questionId: q.id,
      issueType: type,
      detail,
      examName: exam?.name ?? '(NO EXAM SET)',
      subjectName: subject?.name ?? '(UNKNOWN SUBJECT)',
      chapterName: chapter?.name ?? '',
      year: q.year ?? '',
      shift: q.shift ?? '',
      correctAnswer: q.correctAnswer ?? '',
      isApproved: q.isApproved,
      isActive: q.isActive,
      questionTextPreview: (q.questionText || '').slice(0, 90).replace(/\n/g, ' '),
      createdAt: q.createdAt?.toISOString?.() ?? '',
    });
  }

  for (const q of questions) {
    // 1) Translation
    const hasHindi = !!(q.questionTextHindi && q.questionTextHindi.trim() !== '');
    if (!hasHindi) addIssue(q, 'missingHindiTranslation', 'questionTextHindi khaali/missing hai');

    if (!q.explanation || !q.explanation.trim()) addIssue(q, 'missingExplanation', 'explanation (English) missing hai');
    if (!q.explanationHindi || !q.explanationHindi.trim()) addIssue(q, 'missingExplanationHindi', 'explanationHindi missing hai');

    // 2) Exam mapping
    if (!q.examId) {
      addIssue(q, 'missingExam', 'examId NULL hai — kisi exam se linked nahi, kisi bhi exam-specific paper/mock me nahi aayega');
    } else if (!examById.has(q.examId)) {
      addIssue(q, 'missingExam', `examId "${q.examId}" DB me exam table se match nahi karta (orphan/stale reference)`);
    }

    // 2b) chapter belongs to the same subject as the question claims
    if (q.chapterId) {
      const ch = chapterById.get(q.chapterId);
      if (!ch) {
        addIssue(q, 'orphanChapter', `chapterId "${q.chapterId}" chapters table me exist nahi karta`);
      } else if (ch.subjectId !== q.subjectId) {
        addIssue(
          q,
          'chapterSubjectMismatch',
          `Question ka subjectId (${subjectById.get(q.subjectId)?.name ?? q.subjectId}) aur chapter "${ch.name}" ka asal subject alag hai — galat subject ke andar dikhega`,
        );
      }
    }
    if (q.topicId && !topicById.has(q.topicId)) {
      addIssue(q, 'orphanTopic', `topicId "${q.topicId}" topics table me exist nahi karta`);
    }

    // 3) Session / Year / Shift
    if (q.year === null || q.year === undefined) addIssue(q, 'missingYear', 'year missing hai — PYQ/year-wise filter me nahi aayega');
    if (!q.shift || !String(q.shift).trim()) addIssue(q, 'missingShift', 'shift missing hai (Shift 1/2/3 etc.)');

    // 4) Marking / correctness
    const validKeys = ['A', 'B', 'C', 'D'];
    if (!validKeys.includes(q.correctAnswer)) {
      addIssue(q, 'invalidCorrectAnswer', `correctAnswer="${q.correctAnswer}" — A/B/C/D nahi hai, is question ka koi sahi jawab set hi nahi hai`);
    }
    if (typeof q.marks !== 'number' || q.marks <= 0) {
      addIssue(q, 'zeroOrNegativeMarks', `marks=${q.marks} — 0 ya khaali hai, score sahi se count nahi hoga`);
    }
    if (typeof q.negativeMarks === 'number' && q.negativeMarks < 0) {
      addIssue(q, 'negativeMarksIsPositive', `negativeMarks=${q.negativeMarks} ye already negative number hai — scoring code isko dobara ghata sakta hai (double negative bug), ye positive value honi chahiye (e.g. 0.5)`);
    }

    // 5) Options structure
    const opts = Array.isArray(q.optionsJson) ? q.optionsJson : [];
    if (opts.length !== 4) {
      addIssue(q, 'notExactly4Options', `${opts.length} options hain, 4 (A,B,C,D) hone chahiye`);
    }
    const keys = opts.map((o) => o?.key).filter(Boolean);
    if (new Set(keys).size !== keys.length) {
      addIssue(q, 'duplicateOptionKeys', `Option keys me duplicate hai: ${keys.join(',')}`);
    }
    const emptyOpts = opts.filter((o) => {
      const hasText = o?.text && String(o.text).trim() !== '';
      const hasDiagram = !!o?.diagramType;
      const hasImage = !!o?.imageUrl;
      return !hasText && !hasDiagram && !hasImage;
    });
    if (emptyOpts.length > 0) {
      addIssue(q, 'emptyOptionText', `Option(s) ${emptyOpts.map((o) => o?.key).join(',')} khaali hai (na text, na diagram, na image)`);
    }
    const correctOpt = opts.find((o) => o?.key === q.correctAnswer);
    if (validKeys.includes(q.correctAnswer)) {
      const correctHasContent = correctOpt && ((correctOpt.text && String(correctOpt.text).trim() !== '') || correctOpt.diagramType || correctOpt.imageUrl);
      if (!correctHasContent) {
        addIssue(q, 'correctAnswerOptionEmpty', `correctAnswer="${q.correctAnswer}" hai lekin us option ka content khaali hai — student kabhi sahi jawab select hi nahi kar sakta`);
      }
    }

    if (!q.questionText || !q.questionText.trim()) {
      if (!q.questionDiagramType && !q.questionImageUrl) {
        addIssue(q, 'blankQuestionText', 'questionText khaali hai (na diagram, na image bhi)');
      }
    }

    // 6) Publish-state sanity
    if (q.isApproved && !hasHindi) {
      addIssue(q, 'approvedWithoutHindi', 'isApproved=true hai lekin Hindi translation missing — bilingual gate ke against, kahi is check ko bypass kar diya gaya');
    }
    if (!q.isApproved && q.isActive && !q.autoSuspended) {
      addIssue(q, 'liveButUnapproved', 'isApproved=false lekin isActive=true — confusing state, review karke ya to approve karo ya inactive karo');
    }
    if (q.autoSuspended) {
      addIssue(q, 'autoSuspended', `Student error-reports ki wajah se auto-suspend ho chuka hai (reviewStatus=${q.reviewStatus}) — dobara check karke reinstate ya permanently fix karo`);
    }
  }

  // ---- Exam × Subject × Year coverage (for the admin dashboard question) ----
  console.log('📊 Building exam × subject × year matrix...');
  const matrixMap = new Map(); // key: examName|subjectName|year -> count
  for (const q of questions) {
    const exam = q.examId ? examById.get(q.examId) : null;
    const subject = subjectById.get(q.subjectId);
    const key = `${exam?.name ?? '(No Exam)'}|${subject?.name ?? '(Unknown Subject)'}|${q.year ?? '(No Year)'}`;
    matrixMap.set(key, (matrixMap.get(key) ?? 0) + 1);
  }
  const matrixRows = Array.from(matrixMap.entries())
    .map(([key, count]) => {
      const [examName, subjectName, year] = key.split('|');
      return { examName, subjectName, year, count };
    })
    .sort((a, b) => a.examName.localeCompare(b.examName) || a.subjectName.localeCompare(b.subjectName) || String(a.year).localeCompare(String(b.year)));

  // ---- Write CSV (one row per issue, sorted by exam then subject) ----
  const csvHeader = [
    'questionId', 'issueType', 'detail', 'examName', 'subjectName', 'chapterName',
    'year', 'shift', 'correctAnswer', 'isApproved', 'isActive', 'questionTextPreview', 'createdAt',
  ];
  const csvLines = [csvHeader.join(',')];
  for (const r of issueRows) {
    csvLines.push(csvHeader.map((h) => csvEscape(r[h])).join(','));
  }
  fs.writeFileSync(path.join(OUT_DIR, 'audit-details.csv'), csvLines.join('\n'), 'utf-8');

  // ---- Write matrix CSV (exam x subject x year counts) ----
  const matrixHeader = ['examName', 'subjectName', 'year', 'questionCount'];
  const matrixLines = [matrixHeader.join(',')];
  for (const r of matrixRows) {
    matrixLines.push([csvEscape(r.examName), csvEscape(r.subjectName), csvEscape(r.year), r.count].join(','));
  }
  fs.writeFileSync(path.join(OUT_DIR, 'audit-exam-subject-year-matrix.csv'), matrixLines.join('\n'), 'utf-8');

  // ---- Write human-readable summary (Hinglish) ----
  const uniqueProblemQuestionIds = new Set(issueRows.map((r) => r.questionId));
  const summaryLines = [];
  summaryLines.push('SSC PREP HUB — QUESTION BANK AUDIT REPORT');
  summaryLines.push('Generated: ' + new Date().toISOString());
  summaryLines.push('='.repeat(70));
  summaryLines.push('');
  summaryLines.push(`Total questions in DB: ${counts.total}`);
  summaryLines.push(`Questions with AT LEAST ONE problem: ${uniqueProblemQuestionIds.size} (${counts.total ? ((uniqueProblemQuestionIds.size / counts.total) * 100).toFixed(1) : 0}%)`);
  summaryLines.push(`Total individual issues found: ${issueRows.length}`);
  summaryLines.push('');
  summaryLines.push('-- Issue-wise breakdown --');
  const issueLabels = {
    missingHindiTranslation: 'Hindi translation missing (questionTextHindi khaali)',
    missingExplanation: 'English explanation missing',
    missingExplanationHindi: 'Hindi explanation missing',
    missingExam: 'Exam link missing/broken (examId null ya invalid)',
    orphanChapter: 'Chapter link broken (chapterId invalid)',
    orphanTopic: 'Topic link broken (topicId invalid)',
    chapterSubjectMismatch: 'Chapter ka subject, question ke subject se match nahi karta',
    missingYear: 'Year missing',
    missingShift: 'Shift missing',
    invalidCorrectAnswer: 'correctAnswer A/B/C/D nahi hai (CRITICAL)',
    zeroOrNegativeMarks: 'marks 0 ya khaali hai',
    negativeMarksIsPositive: 'negativeMarks galat sign me store hai (CRITICAL — scoring bug)',
    notExactly4Options: '4 options nahi hain',
    duplicateOptionKeys: 'Duplicate option keys',
    emptyOptionText: 'Koi option khaali hai',
    correctAnswerOptionEmpty: 'Sahi jawab wala option hi khaali hai (CRITICAL — student answer nahi de sakta)',
    blankQuestionText: 'Question text hi khaali hai (CRITICAL)',
    approvedWithoutHindi: 'Live/approved hai par Hindi translation nahi (bilingual gate bypass)',
    liveButUnapproved: 'isActive=true but isApproved=false (confusing state)',
    autoSuspended: 'Student reports ki wajah se auto-suspended ho chuka hai',
  };
  for (const [key, label] of Object.entries(issueLabels)) {
    const c = counts[key] || 0;
    if (c > 0) summaryLines.push(`  ${String(c).padStart(6)}  ${label}`);
  }
  summaryLines.push('');
  summaryLines.push('-- CRITICAL issues (students affected RIGHT NOW, fix first) --');
  const critical = ['invalidCorrectAnswer', 'correctAnswerOptionEmpty', 'blankQuestionText', 'negativeMarksIsPositive'];
  const criticalTotal = critical.reduce((s, k) => s + (counts[k] || 0), 0);
  summaryLines.push(`  Total critical issues: ${criticalTotal}`);
  for (const k of critical) {
    if (counts[k] > 0) summaryLines.push(`    - ${issueLabels[k]}: ${counts[k]}`);
  }
  summaryLines.push('');
  summaryLines.push('-- Exam × Subject × Year matrix --');
  summaryLines.push('(Full breakdown in audit-exam-subject-year-matrix.csv — open in Excel)');
  summaryLines.push('');
  const noExamRows = matrixRows.filter((r) => r.examName === '(No Exam)');
  const noYearRows = matrixRows.filter((r) => r.year === '(No Year)');
  if (noExamRows.length) {
    const total = noExamRows.reduce((s, r) => s + r.count, 0);
    summaryLines.push(`  ⚠️  ${total} questions have NO exam linked at all (across ${noExamRows.length} subject groupings)`);
  }
  if (noYearRows.length) {
    const total = noYearRows.reduce((s, r) => s + r.count, 0);
    summaryLines.push(`  ⚠️  ${total} questions have NO year set`);
  }
  summaryLines.push('');
  summaryLines.push('-- Files --');
  summaryLines.push('  audit-details.csv                    — every problem, one row each, Excel me kholo aur fix karo');
  summaryLines.push('  audit-exam-subject-year-matrix.csv   — admin dashboard jaisa exam x subject x year count table');
  summaryLines.push('');
  summaryLines.push('NOTE: Ye script sirf READ karta hai, kuch bhi DB me change nahi karta.');

  fs.writeFileSync(path.join(OUT_DIR, 'audit-summary.txt'), summaryLines.join('\n'), 'utf-8');

  console.log('');
  console.log('✅ Audit complete!');
  console.log(`   ${OUT_DIR}/audit-summary.txt`);
  console.log(`   ${OUT_DIR}/audit-details.csv  (${issueRows.length} issue rows)`);
  console.log(`   ${OUT_DIR}/audit-exam-subject-year-matrix.csv  (${matrixRows.length} rows)`);
  console.log('');
  console.log(summaryLines.slice(0, 15).join('\n'));
}

main()
  .catch((e) => {
    console.error('❌ Audit failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
