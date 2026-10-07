/* eslint-disable no-console */
/**
 * SSC Prep Hub — one-time backfill: convert every old free-text shift already
 * stored in Postgres ("morning", "Shift-1", "4 PM", "dopahar" ...) into the
 * canonical "Shift 1" / "Shift 2" / "Shift 3" label.
 *
 * The code fix (common/shift.ts normalizeShift(), wired into every writer)
 * only protects NEW data. This script cleans the data that is already there.
 *
 * What it does
 *   1. Lists every distinct questions.shift value and the canonical label it
 *      maps to. Values that are already canonical, or that cannot be
 *      understood (kept as typed), are shown but never touched.
 *   2. Dry run by default — prints the plan only.
 *   3. With --apply:
 *        a. questions.shift is rewritten (paperCode is NOT touched, so existing
 *           mock template ids and student attempts keep working);
 *        b. every affected (exam, year, shift, paperCode) paper is re-run
 *           through BankUploadService.upsertPyqMockForPaper() so its SHIFT_WISE
 *           mock gets the new shift/title;
 *        c. an OLD mock whose id was derived from "<year>-<old shift>" (papers
 *           uploaded without a paperCode) can no longer match its questions, so
 *           it is set isActive=false (attempt history is kept, never deleted)
 *           and the fresh "<year>-shift-N" mock created in (b) replaces it.
 *
 * Usage (from the backend folder):
 *   npx ts-node scripts/normalize-shifts.ts            # dry run
 *   npx ts-node scripts/normalize-shifts.ts --apply    # really change data
 *
 * Take a DB backup first:  docker compose exec db pg_dump -U <user> <db> > backup.sql
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BankUploadService } from '../src/bank/bank-upload.service';
import { isCanonicalShift, normalizeShift } from '../src/common/shift';

const APPLY = process.argv.includes('--apply');

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const upload = app.get(BankUploadService);

  try {
    const distinct = await prisma.question.groupBy({
      by: ['shift'],
      where: { shift: { not: null } },
      _count: { _all: true },
    });

    type Plan = { from: string; to: string; count: number };
    const plan: Plan[] = [];
    console.log('\nShift values found in questions:');
    for (const d of distinct) {
      const from = d.shift as string;
      const to = normalizeShift(from);
      const count = d._count._all;
      if (!to) continue;
      if (from === to) {
        console.log(`  ${JSON.stringify(from).padEnd(28)} ${String(count).padStart(6)} rows  ok (already canonical or kept as typed)`);
        continue;
      }
      if (!isCanonicalShift(to)) {
        console.log(`  ${JSON.stringify(from).padEnd(28)} ${String(count).padStart(6)} rows  NOT UNDERSTOOD — left as is`);
        continue;
      }
      console.log(`  ${JSON.stringify(from).padEnd(28)} ${String(count).padStart(6)} rows  ->  ${to}`);
      plan.push({ from, to, count });
    }

    if (plan.length === 0) {
      console.log('\nNothing to change. Every shift is already clean.');
      return;
    }
    const totalRows = plan.reduce((s, p) => s + p.count, 0);
    console.log(`\n${plan.length} spelling(s), ${totalRows} question row(s) would change.`);
    if (!APPLY) {
      console.log('Dry run only. Re-run with --apply to write the changes.');
      return;
    }

    let updatedRows = 0;
    const touchedPapers = new Map<string, { examId: string; year: number; shift: string; paperCode: string | null; examDate: string | null }>();
    const deactivated: string[] = [];

    for (const p of plan) {
      // Remember the papers this spelling belongs to BEFORE rewriting it.
      const papers = await prisma.question.groupBy({
        by: ['examId', 'year', 'paperCode', 'examDate'],
        where: { shift: p.from, examId: { not: null }, year: { not: null } },
      });

      const res = await prisma.question.updateMany({ where: { shift: p.from }, data: { shift: p.to } });
      updatedRows += res.count;
      cacheNote(p, res.count);

      for (const pp of papers) {
        const key = `${pp.examId}|${pp.year}|${p.to}|${pp.paperCode ?? ''}`;
        touchedPapers.set(key, {
          examId: pp.examId as string,
          year: pp.year as number,
          shift: p.to,
          paperCode: pp.paperCode,
          examDate: pp.examDate,
        });
      }

      // Old mocks that still carry the old spelling.
      const templates = await prisma.testTemplate.findMany({ where: { shift: p.from }, select: { id: true, year: true } });
      for (const t of templates) {
        const syntheticOldId = t.year != null ? `pyq-${slug(`${t.year}-${p.from}`)}` : null;
        if (syntheticOldId && t.id === syntheticOldId) {
          await prisma.testTemplate.update({ where: { id: t.id }, data: { isActive: false } });
          deactivated.push(t.id);
        } else {
          await prisma.testTemplate.update({ where: { id: t.id }, data: { shift: p.to } });
        }
      }
    }

    // Refresh (create/update) the SHIFT_WISE mock of every touched paper.
    let refreshed = 0;
    for (const paper of touchedPapers.values()) {
      try {
        await upload.upsertPyqMockForPaper(paper.examId, paper.year, paper.shift, paper.paperCode, paper.examDate);
        refreshed++;
      } catch (e) {
        console.warn(`  could not refresh mock for ${paper.examId} ${paper.year} ${paper.shift}: ${(e as Error).message}`);
      }
    }

    console.log(`\nDONE: ${updatedRows} question row(s) updated, ${refreshed} mock(s) refreshed, ${deactivated.length} old mock(s) deactivated.`);
    if (deactivated.length) console.log('Deactivated old mocks (history kept):', deactivated.join(', '));
    console.log('Restart the backend (or wait ~5 min) so cached shift lists refresh.');
  } finally {
    await app.close();
  }
}

function cacheNote(p: { from: string; to: string }, n: number) {
  console.log(`  updated ${n} row(s): ${JSON.stringify(p.from)} -> ${p.to}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
