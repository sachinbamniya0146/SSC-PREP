// Marking-scheme presets for every SSC exam (28 Oct 2026 — replaces the old hard-coded list, whose CPO / MTS / GD
// numbers were wrong). The data lives in src/common/exam-presets.ts (compiled to dist/), each preset with its source.
//
//   docker compose exec backend node scripts/seed-patterns.mjs            # REPORT only — writes nothing
//   docker compose exec backend node scripts/seed-patterns.mjs --apply    # apply every update / create
//   docker compose exec backend node scripts/seed-patterns.mjs --apply --only=cpo-p1,mts
//
// Safe to re-run: an existing active pattern of the same exam + tier + paper is UPDATED in its marking numbers
// only (lock / scribe / timers / names stay); a missing one is created; a missing exam is reported and skipped.
import { PrismaClient } from '@prisma/client';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { EXAM_PRESETS, planPresetSync } = require('../dist/common/exam-presets.js');

const apply = process.argv.includes('--apply');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').filter(Boolean)) : null;

const prisma = new PrismaClient();

async function main() {
  const [exams, patterns] = await Promise.all([
    prisma.exam.findMany({ select: { id: true, slug: true } }),
    prisma.examPattern.findMany({
      select: { id: true, examId: true, name: true, isActive: true, totalQuestions: true, totalMarks: true, durationMinutes: true, negativeMarks: true, sections: true, lockPreviousSections: true },
    }),
  ]);
  const actions = planPresetSync({ presets: EXAM_PRESETS, exams, patterns }).filter((a) => !only || only.has(a.presetKey));

  let written = 0;
  for (const a of actions) {
    const tag = a.verification === 'OFFICIAL' ? 'official' : 'SECONDARY-check';
    console.log(`\n[${a.kind.toUpperCase()}] ${a.presetKey} · ${a.patternName ?? a.presetName} (${tag})`);
    for (const c of a.changes) console.log(`   • ${c}`);
    for (const w of a.warnings) console.log(`   ! ${w}`);
    if (!apply) continue;
    if (a.kind === 'update') {
      await prisma.examPattern.update({
        where: { id: a.patternId },
        data: {
          totalQuestions: a.write.totalQuestions,
          totalMarks: a.write.totalMarks,
          durationMinutes: a.write.durationMinutes,
          negativeMarks: a.write.negativeMarks,
          sections: a.write.sections,
          sourceNote: a.write.sourceNote,
        },
      });
      written++;
    } else if (a.kind === 'create') {
      await prisma.examPattern.create({
        data: {
          examId: a.examId,
          name: a.create.name,
          totalQuestions: a.create.totalQuestions,
          totalMarks: a.create.totalMarks,
          durationMinutes: a.create.durationMinutes,
          negativeMarks: a.create.negativeMarks,
          sections: a.create.sections,
          lockPreviousSections: a.create.lockPreviousSections,
          scribeExtraMinutes: a.create.scribeExtraMinutes,
          sourceNote: a.create.sourceNote,
        },
      });
      written++;
    }
  }

  const count = (k) => actions.filter((a) => a.kind === k).length;
  console.log(`\nSummary: ${count('update')} update, ${count('create')} create, ${count('unchanged')} unchanged, ${count('skip')} skipped.`);
  console.log(apply ? `Applied: ${written} written.` : 'REPORT ONLY — nothing written. Re-run with --apply to write.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
