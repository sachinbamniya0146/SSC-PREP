/* eslint-disable no-console */
/**
 * SSC Prep Hub — one-time backfill for date-wise + tier-wise PYQ mocks (26 Oct 2026).
 *
 * Old PYQs often carry only year + shift + paperCode ("SSC-CGL-T-I-12-Sep-2025-S2"). This reads the tier and
 * the exam date OUT OF THE paperCode (common/pyq-paper-key.ts parsePaperCode) and fills examTier / examDate
 * where they are still blank. It NEVER overwrites a value that is already set, never touches shift / paperCode.
 *
 *   DRY RUN is the default (prints the plan, writes nothing). Add --apply to really write.
 *   (--dry-run is accepted too and always wins over --apply.)
 *
 * After --apply it rebuilds every date-wise paper (same as POST /bank/admin/upload/pyq-papers/rebuild).
 *
 * Usage (from the backend folder):
 *   npx ts-node scripts/backfill-pyq-tiers.ts              # dry run
 *   npx ts-node scripts/backfill-pyq-tiers.ts --apply      # really change data
 *
 * Take a DB backup first:  docker compose exec db pg_dump -U <user> <db> > backup.sql
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BankUploadService } from '../src/bank/bank-upload.service';
import { parsePaperCode } from '../src/common/pyq-paper-key';

const DRY = process.argv.includes('--dry-run') || !process.argv.includes('--apply');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const upload = app.get(BankUploadService);

  const rows = await prisma.question.findMany({
    where: { year: { not: null }, paperCode: { not: null }, OR: [{ examTier: null }, { examDate: null }] },
    select: { id: true, examTier: true, examDate: true, paperCode: true, year: true },
  });
  console.log(`PYQ rows with a paperCode and a blank tier/date: ${rows.length}`);

  // group by the (tier, date) patch so we do one updateMany per patch
  const patches = new Map<string, { ids: string[]; examTier?: string; examDate?: string; code: string }>();
  let unreadable = 0;
  let yearMismatch = 0;
  for (const r of rows) {
    const p = parsePaperCode(r.paperCode);
    const examTier = r.examTier ? undefined : p.examTier;
    const examDate = r.examDate ? undefined : p.examDate;
    if (!examTier && !examDate) { unreadable++; continue; }
    // a date whose year disagrees with the stored year is suspicious — skip it, report it
    if (examDate && r.year && Number(examDate.slice(0, 4)) !== r.year) { yearMismatch++; continue; }
    const key = `${examTier ?? ''}|${examDate ?? ''}`;
    const hit = patches.get(key) ?? { ids: [], examTier, examDate, code: r.paperCode as string };
    hit.ids.push(r.id);
    patches.set(key, hit);
  }

  let would = 0;
  for (const [key, p] of patches) {
    would += p.ids.length;
    console.log(`  ${String(p.ids.length).padStart(6)} rows  tier=${p.examTier ?? '(keep)'}  date=${p.examDate ?? '(keep)'}   e.g. ${p.code}`);
    if (key === '') continue;
  }
  console.log(`Would fill: ${would} rows | paperCode unreadable: ${unreadable} | year/date mismatch (skipped): ${yearMismatch}`);

  if (DRY) {
    console.log('\nDRY RUN — nothing was written. Run again with --apply to write.');
    await app.close();
    return;
  }

  let written = 0;
  for (const p of patches.values()) {
    const data: Record<string, string> = {};
    if (p.examTier) data.examTier = p.examTier;
    if (p.examDate) data.examDate = p.examDate;
    for (let i = 0; i < p.ids.length; i += 500) {
      // re-check blanks in the WHERE so a row changed meanwhile is never overwritten
      const r = await prisma.question.updateMany({
        where: { id: { in: p.ids.slice(i, i + 500) }, ...(p.examTier ? { examTier: null } : {}), ...(p.examDate ? { examDate: null } : {}) },
        data,
      });
      written += r.count;
    }
  }
  console.log(`Written: ${written} rows. Rebuilding date-wise papers…`);
  const rebuilt = await upload.rebuildAllKeyedPapers();
  console.log(`Papers rebuilt: ${rebuilt.papers}. Done.`);
  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
