#!/usr/bin/env node
/**
 * Duplicate topic / sub-topic audit + merge (CLI twin of Admin → Duplicate topics).
 *
 *   node scripts/taxonomy-dedupe.mjs                 → sirf report (kuch change nahi hota)
 *   node scripts/taxonomy-dedupe.mjs --apply         → same-name / same-Hindi groups merge (similar wale kabhi auto merge nahi hote)
 *   node scripts/taxonomy-dedupe.mjs --undo <logId>  → ek merge wapas
 *
 * Har merge taxonomy_merge_logs me likha jata hai. Backup ke baad hi --apply chalana.
 * Uses the compiled service from dist/ (same code as the admin panel), so run it inside the backend container.
 */
import { createRequire } from 'module';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
let Svc;
try {
  Svc = require('../dist/bank/taxonomy-dedupe.service.js').TaxonomyDedupeService;
} catch (e) {
  console.error('❌ dist/bank/taxonomy-dedupe.service.js nahi mila — pehle `npm run build` chalao.', e?.message ?? '');
  process.exit(1);
}
const prisma = new PrismaClient();
const svc = new Svc(prisma); // no SearchService here → after --apply run "reindex" from the admin panel

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const undoIdx = args.indexOf('--undo');

const line = (g) =>
  `  [${g.reason}] ${g.rows.map((r) => `"${r.name}"${r.nameHindi ? `/${r.nameHindi}` : ''}(${r.questionCount}q)`).join('  +  ')}  → rakhna: "${g.rows[0].name}"`;

try {
  if (undoIdx !== -1) {
    const id = args[undoIdx + 1];
    if (!id) throw new Error('--undo ke baad logId do');
    console.log(await svc.undo(id));
  } else {
    const a = await svc.audit();
    console.log(`\nDuplicate groups → topics: ${a.summary.topicGroups}, sub-topics: ${a.summary.subTopicGroups}, chapters: ${a.summary.chapterGroups}`);
    console.log(`Exact (merge-able): ${a.summary.exactGroups}  |  Similar (insaan dekhe): ${a.summary.similarGroups}  |  hatne wali rows: ${a.summary.rowsToRemove}\n`);
    for (const [title, list] of [['TOPICS', a.topics], ['SUB-TOPICS', a.subTopics], ['CHAPTERS (sirf report — Admin → Chapters se merge karo)', a.chapters]]) {
      if (!list.length) continue;
      console.log(`== ${title}`);
      list.forEach((g) => console.log(line(g)));
      console.log('');
    }
    if (!apply) console.log('Report only. Merge karne ke liye: node scripts/taxonomy-dedupe.mjs --apply');
    else {
      const r = await svc.mergeAllExact('cli', false);
      console.log(`✅ ${r.losersMerged} duplicate rows merge hue. Undo: node scripts/taxonomy-dedupe.mjs --undo <logId> (Admin → Duplicate topics me log dikhega).`);
      console.log('ℹ️  Search index purane topic names dikha sakta hai → admin panel se Meilisearch reindex chalao.');
    }
  }
} finally {
  await prisma.$disconnect();
}
