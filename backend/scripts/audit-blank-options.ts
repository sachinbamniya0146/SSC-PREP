/* eslint-disable no-console */
/**
 * SSC Prep Hub — audit-blank-options.ts
 *
 * WHY THIS SCRIPT EXISTS (Session 20, closing out Session 19 §D item 1):
 * Session 19 fixed createQuestion() in bank-upload.service.ts so NEW bulk
 * uploads can no longer publish a question with a blank questionText, a
 * blank A/B/C/D option, or a blank correctAnswer option — that gate throws
 * before the row is ever written. But that fix only protects rows created
 * AFTER Session 19 shipped. Anything uploaded BEFORE that fix — through the
 * same five upload paths (Excel/CSV/Text/JSON-file/JSON-paste/Word), all of
 * which funnelled through the old, ungated createQuestion() — could already
 * be sitting live in the database with a blank option a student can never
 * select, or worse, a blank option that happens to BE the correct answer
 * (mathematically unanswerable question).
 *
 * This could not be written and run in Session 19 or 20 because the sandbox
 * has no live database connection. Sachin (or whoever has prod DB access)
 * must run this himself, from a machine that can reach the production
 * database — this is exactly what Session 19's handoff asked for.
 *
 * SAFE BY DEFAULT: running with no flags is a DRY RUN. It only reports what
 * it finds — a JSON file with every broken question's id + reason, and a
 * console summary. It changes NOTHING in the database unless you pass
 * --apply, in which case broken questions are pulled from being served to
 * students (isApproved: false, reviewStatus: 'PENDING' — same values
 * createQuestion() already uses for "not ready to publish yet") so an admin
 * can review and fix them, but they are NOT deleted.
 *
 * USAGE (run from backend/ directory):
 *   npx ts-node scripts/audit-blank-options.ts                # dry run, report only
 *   npx ts-node scripts/audit-blank-options.ts --apply         # also un-publish broken ones
 *   npx ts-node scripts/audit-blank-options.ts --apply --yes   # skip the confirmation prompt
 *
 * Output: prints a summary to console AND writes a full JSON report to
 * backend/scripts/reports/blank-options-report-<timestamp>.json so nothing
 * found is lost even if the terminal scrollback is gone.
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const prisma = new PrismaClient();

const BATCH_SIZE = 500;
const OPTION_KEYS = ['A', 'B', 'C', 'D'];

interface OptionRow {
  key?: string;
  text?: string;
  textHi?: string;
}

interface BrokenQuestion {
  id: string;
  examId: string | null;
  subjectId: string;
  chapterId: string | null;
  year: number | null;
  reasons: string[];
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || String(v).trim() === '';
}

/**
 * Checks a single published question's questionText + optionsJson shape.
 * Returns a list of human-readable reasons if something is wrong, or an
 * empty array if the question is fine.
 */
function findIssues(q: {
  id: string;
  questionText: string;
  optionsJson: unknown;
  correctAnswer: string;
}): string[] {
  const reasons: string[] = [];

  if (isBlank(q.questionText)) {
    reasons.push('questionText is blank');
  }

  const options: OptionRow[] = Array.isArray(q.optionsJson) ? (q.optionsJson as OptionRow[]) : [];
  if (options.length === 0) {
    reasons.push('optionsJson is empty/missing entirely');
    return reasons; // nothing further to check without options
  }

  for (const key of OPTION_KEYS) {
    const opt = options.find((o) => o.key === key);
    if (!opt) {
      reasons.push(`option ${key} is missing from optionsJson`);
    } else if (isBlank(opt.text)) {
      reasons.push(`option ${key} has blank text`);
    }
  }

  const correctOpt = options.find((o) => o.key === q.correctAnswer);
  if (!correctOpt) {
    reasons.push(`correctAnswer "${q.correctAnswer}" does not match any option key present`);
  } else if (isBlank(correctOpt.text)) {
    reasons.push(`correctAnswer "${q.correctAnswer}" points at a blank option (question is unanswerable)`);
  }

  return reasons;
}

function askConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} (type "yes" to continue): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

async function main() {
  const apply = process.argv.includes('--apply');
  const skipConfirm = process.argv.includes('--yes');

  console.log(`[audit-blank-options] mode: ${apply ? 'APPLY (will un-publish broken questions)' : 'DRY RUN (report only)'}`);
  console.log('[audit-blank-options] scanning published questions (isApproved: true, isActive: true)...');

  const broken: BrokenQuestion[] = [];
  let scanned = 0;
  let cursor: string | undefined;

  // Keyset pagination (cursor on id) — safer than skip/take for a table that
  // could be tens of thousands of rows, and immune to rows shifting between
  // pages if something else is writing concurrently.
  for (;;) {
    const batch = await prisma.question.findMany({
      where: { isApproved: true, isActive: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        examId: true,
        subjectId: true,
        chapterId: true,
        year: true,
        questionText: true,
        optionsJson: true,
        correctAnswer: true,
      },
    });

    if (batch.length === 0) break;

    for (const q of batch) {
      scanned += 1;
      const reasons = findIssues(q);
      if (reasons.length > 0) {
        broken.push({
          id: q.id,
          examId: q.examId,
          subjectId: q.subjectId,
          chapterId: q.chapterId,
          year: q.year,
          reasons,
        });
      }
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH_SIZE) break;
  }

  console.log(`[audit-blank-options] scanned ${scanned} published questions.`);
  console.log(`[audit-blank-options] found ${broken.length} broken question(s).`);

  if (broken.length > 0) {
    console.log('[audit-blank-options] sample (first 10):');
    for (const b of broken.slice(0, 10)) {
      console.log(`  - ${b.id} (exam=${b.examId ?? '-'}, subject=${b.subjectId}, year=${b.year ?? '-'}): ${b.reasons.join('; ')}`);
    }
  }

  const reportDir = path.join(__dirname, 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `blank-options-report-${stamp}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), scanned, brokenCount: broken.length, broken }, null, 2),
    'utf-8',
  );
  console.log(`[audit-blank-options] full report written to ${reportPath}`);

  if (!apply) {
    console.log('[audit-blank-options] dry run complete. Re-run with --apply to un-publish the broken questions above.');
    return;
  }

  if (broken.length === 0) {
    console.log('[audit-blank-options] nothing to apply — no broken questions found.');
    return;
  }

  if (!skipConfirm) {
    const confirmed = await askConfirmation(
      `[audit-blank-options] About to set isApproved=false, reviewStatus='PENDING' on ${broken.length} question(s). This removes them from student view until an admin fixes and re-approves them. Continue?`,
    );
    if (!confirmed) {
      console.log('[audit-blank-options] aborted by user, no changes made.');
      return;
    }
  }

  const idsToFix = broken.map((b) => b.id);
  const result = await prisma.question.updateMany({
    where: { id: { in: idsToFix } },
    data: { isApproved: false, reviewStatus: 'PENDING' },
  });
  console.log(`[audit-blank-options] updated ${result.count} question(s) — pulled from student view, marked reviewStatus='PENDING' for admin follow-up.`);
}

main()
  .catch((err) => {
    console.error('[audit-blank-options] FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
