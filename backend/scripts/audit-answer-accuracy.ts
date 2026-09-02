/* eslint-disable no-console */
/**
 * SSC Prep Hub — audit-answer-accuracy.ts
 *
 * WHY THIS SCRIPT EXISTS (Session 20, closing out Session 19 §D item 2,
 * itself carried over from Session 18): the schema already has everything
 * needed to know how many questions have a shaky or disputed answer —
 * Question.answerVerificationStatus, Question.reviewStatus,
 * Question.errorReportCount/autoSuspended, and the QuestionErrorReport
 * table — but nobody has ever actually queried it to see the real numbers.
 * This has been blocked for two sessions because the sandbox has no live
 * DB connection; it needs to run wherever the production database is
 * reachable.
 *
 * READ-ONLY: this script never writes anything to the database. It only
 * reads and reports. Use it to decide what to act on manually (or feed the
 * "DISPUTED"/most-reported list to an admin review queue).
 *
 * USAGE (run from backend/ directory):
 *   npx ts-node scripts/audit-answer-accuracy.ts
 *   npx ts-node scripts/audit-answer-accuracy.ts --top 50   # change how many
 *                                                             worst offenders to list (default 20)
 *
 * Output: console summary + a full JSON report written to
 * backend/scripts/reports/answer-accuracy-report-<timestamp>.json
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

function topArg(): number {
  const idx = process.argv.indexOf('--top');
  if (idx !== -1 && process.argv[idx + 1]) {
    const n = parseInt(process.argv[idx + 1], 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return 20;
}

async function main() {
  const topN = topArg();
  console.log('[audit-answer-accuracy] querying live/published questions only (isApproved: true, isActive: true)...');

  const publishedWhere = { isApproved: true, isActive: true };

  // 1) How many published questions sit at each verification confidence level.
  const byVerification = await prisma.question.groupBy({
    by: ['answerVerificationStatus'],
    where: publishedWhere,
    _count: true,
  });

  // 2) How many published questions sit at each review-gate status (should
  //    normally all be APPROVED if published, but worth confirming — a
  //    mismatch here would itself be a bug worth flagging).
  const byReviewStatus = await prisma.question.groupBy({
    by: ['reviewStatus'],
    where: publishedWhere,
    _count: true,
  });

  // 3) Explicitly-DISPUTED published questions — the most urgent bucket,
  //    since "DISPUTED" means someone already flagged the answer as wrong
  //    and it is still live being served to students.
  const disputed = await prisma.question.findMany({
    where: { ...publishedWhere, answerVerificationStatus: 'DISPUTED' },
    select: {
      id: true, examId: true, subjectId: true, year: true,
      questionText: true, correctAnswer: true, errorReportCount: true,
    },
    orderBy: { errorReportCount: 'desc' },
  });

  // 4) Questions with the most open/confirmed student error reports —
  //    a high signal list even for questions not yet marked DISPUTED.
  const mostReported = await prisma.question.findMany({
    where: { ...publishedWhere, errorReportCount: { gt: 0 } },
    select: {
      id: true, examId: true, subjectId: true, year: true,
      questionText: true, correctAnswer: true, answerVerificationStatus: true,
      errorReportCount: true, autoSuspended: true,
    },
    orderBy: { errorReportCount: 'desc' },
    take: topN,
  });

  // 5) Breakdown of the underlying error reports themselves — status x category.
  const reportsByStatus = await prisma.questionErrorReport.groupBy({
    by: ['status'],
    _count: true,
  });
  const reportsByCategory = await prisma.questionErrorReport.groupBy({
    by: ['category', 'status'],
    _count: true,
  });

  // 6) Auto-suspended questions (v5 §37.4 threshold already tripped) that
  //    are somehow still marked isApproved — a suspended-but-still-live
  //    question would itself be a bug worth a separate fix if found.
  const suspendedButLive = await prisma.question.findMany({
    where: { autoSuspended: true, isApproved: true },
    select: { id: true, examId: true, subjectId: true, errorReportCount: true },
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    publishedByVerificationStatus: Object.fromEntries(
      byVerification.map((r) => [r.answerVerificationStatus, r._count]),
    ),
    publishedByReviewStatus: Object.fromEntries(
      byReviewStatus.map((r) => [r.reviewStatus, r._count]),
    ),
    disputedCount: disputed.length,
    disputedQuestions: disputed,
    mostReportedQuestions: mostReported,
    errorReportsByStatus: Object.fromEntries(reportsByStatus.map((r) => [r.status, r._count])),
    errorReportsByCategory: reportsByCategory,
    suspendedButStillLiveCount: suspendedButLive.length,
    suspendedButStillLive: suspendedButLive,
  };

  console.log('\n=== Published questions by answerVerificationStatus ===');
  console.table(summary.publishedByVerificationStatus);

  console.log('\n=== Published questions by reviewStatus (should all be APPROVED) ===');
  console.table(summary.publishedByReviewStatus);

  console.log(`\n=== DISPUTED published questions: ${summary.disputedCount} ===`);
  if (summary.disputedCount > 0) {
    console.log('These are LIVE right now with an answer already flagged as disputed. Highest priority to review.');
  }

  console.log(`\n=== Top ${topN} most student-reported published questions ===`);
  for (const q of mostReported.slice(0, topN)) {
    console.log(`  - ${q.id} (exam=${q.examId ?? '-'}, subject=${q.subjectId}, year=${q.year ?? '-'}) reports=${q.errorReportCount} status=${q.answerVerificationStatus}${q.autoSuspended ? ' [AUTO-SUSPENDED]' : ''}`);
  }

  console.log('\n=== Underlying error report counts ===');
  console.table(summary.errorReportsByStatus);

  if (summary.suspendedButStillLiveCount > 0) {
    console.log(`\n⚠️  ${summary.suspendedButStillLiveCount} question(s) are autoSuspended=true but isApproved=true (still being served to students despite tripping the auto-suspend threshold) — worth its own bug-fix pass.`);
  }

  const reportDir = path.join(__dirname, 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `answer-accuracy-report-${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`\n[audit-answer-accuracy] full report written to ${reportPath}`);
}

main()
  .catch((err) => {
    console.error('[audit-answer-accuracy] FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
