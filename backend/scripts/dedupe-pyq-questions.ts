/* eslint-disable no-console */
/**
 * SSC Prep Hub — one-time cleanup for duplicate PYQ questions already
 * sitting in the DB (Sachin: "database me bhut se question he" / a
 * shift-wise mock showing 100+ questions for what should be a 100-Q paper).
 *
 * The code fix (common/pyq-paper.ts's dedupeAndCapPaperRows(), wired into
 * BankUploadService.upsertPyqMockForPaper() and TestsService
 * .shiftWisePyqPaper()/yearWiseStart()) stops the SYMPTOM going forward —
 * a bloated group can no longer be SERVED as an oversized test. This
 * script cleans up the CAUSE: duplicate Question rows already in Postgres
 * from a paper that got uploaded more than once as brand-new rows instead
 * of updating the existing ones.
 *
 * What it does:
 *   1. Groups every published question by (examId, year, shift, paperCode).
 *   2. Within each group, applies the EXACT SAME dedupeAndCapPaperRows()
 *      logic the live code now uses — normalized-questionText de-dupe,
 *      oldest-row-wins, capped at MAX_PYQ_PAPER_QUESTIONS (100).
 *   3. Anything in a group that's NOT in the kept set (a true duplicate,
 *      or genuine overflow past 100) is reported. Nothing is deleted
 *      unless you pass --apply.
 *   4. With --apply, those extra rows are soft-removed via
 *      isActive: false (never a hard delete) — reversible, and consistent
 *      with how the rest of the codebase already treats "shouldn't be
 *      servable anymore" (see PUBLISHED_QUESTION_WHERE in
 *      common/question-visibility.ts, which already excludes
 *      isActive: false rows from every student-facing query). After
 *      running with --apply, re-run finalizeUploadBatch's mock refresh
 *      (or just re-upload the affected paper's corrected sheet) so the
 *      SHIFT_WISE mock's totalQuestions/totalMarks catch up — or wait for
 *      the next upload touching that paperCode, which calls
 *      upsertPyqMockForPaper() automatically.
 *
 * Usage:
 *   npx ts-node backend/scripts/dedupe-pyq-questions.ts            # dry run, prints report only
 *   npx ts-node backend/scripts/dedupe-pyq-questions.ts --apply    # actually soft-removes the extras
 */
import { PrismaClient } from '@prisma/client';
import { dedupeAndCapPaperRows } from '../src/common/pyq-paper';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const rows = await prisma.question.findMany({
    where: { isApproved: true, isActive: true, autoSuspended: false, examId: { not: null }, year: { not: null }, shift: { not: null } },
    select: { id: true, questionText: true, createdAt: true, examId: true, year: true, shift: true, paperCode: true },
  });

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.examId}|${r.year}|${r.shift}|${r.paperCode ?? ''}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  let totalExtra = 0;
  const toDeactivate: string[] = [];

  for (const [key, groupRows] of groups) {
    if (groupRows.length <= 100) continue; // nothing to trim for this paper
    const kept = dedupeAndCapPaperRows(groupRows as any);
    const keptIds = new Set(kept.map((r) => r.id));
    const extras = groupRows.filter((r) => !keptIds.has(r.id));
    if (extras.length === 0) continue;
    totalExtra += extras.length;
    toDeactivate.push(...extras.map((r) => r.id));
    console.log(`${key} — ${groupRows.length} rows found, keeping ${kept.length}, flagging ${extras.length} extra/duplicate`);
  }

  console.log(`\n${totalExtra} extra/duplicate question row(s) found across all shift-wise papers.`);

  if (!APPLY) {
    console.log('Dry run only — nothing changed. Re-run with --apply to soft-remove these rows (isActive: false).');
    return;
  }
  if (toDeactivate.length === 0) {
    console.log('Nothing to apply.');
    return;
  }
  const result = await prisma.question.updateMany({
    where: { id: { in: toDeactivate } },
    data: { isActive: false },
  });
  console.log(`Soft-removed ${result.count} row(s). They no longer count toward any shift-wise mock's totalQuestions.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
