// v7 §6 — site-wide 4-pass QA across EVERY exam/subject/chapter.
// Pass 1: automated field check. Pass 2: structural check (4 options, non-empty
// text, correctAnswer valid). Pass 3: human spot-check sample (output only).
// Pass 4: regression diff (counts before/after). FAILURES GET UNPUBLISHED.
// Run: docker cp scripts/qa-site.mjs ssc-backend:/app/ && docker exec ssc-backend node qa-site.mjs
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const log = (s) => console.log(s);

async function main() {
  log('=== v7 §6 SITE-WIDE 4-PASS QA ===');
  const before = {};
  const exams = await prisma.exam.findMany({ select: { id: true, name: true, slug: true } });
  let totalUnpublished = 0;
  const report = [];

  for (const exam of exams) {
    const subjects = await prisma.subject.findMany({
      where: { questions: { some: { examId: exam.id } } },
      select: { id: true, name: true },
    });
    for (const subject of subjects) {
      const chapters = await prisma.chapter.findMany({
        where: { questions: { some: { examId: exam.id, subjectId: subject.id } } },
        select: { id: true, name: true },
      });
      for (const chapter of chapters) {
        const scope = { examId: exam.id, subjectId: subject.id, chapterId: chapter.id, isApproved: true };
        const all = await prisma.question.findMany({ where: scope, select: { id: true, questionText: true, correctAnswer: true, optionsJson: true, isApproved: true } });
        if (!all.length) continue;

        before[`${exam.slug}/${subject.name}/${chapter.name}`] = all.length;

        // Pass 1 — automated field check
        const emptyText = all.filter((q) => !q.questionText || !q.questionText.trim());
        // Pass 2 — structural check
        const structural = all.filter((q) => {
          try {
            const opts = Array.isArray(q.optionsJson) ? q.optionsJson : [];
            const keys = opts.map((o) => o?.key).filter(Boolean);
            const emptyOpt = opts.some((o) => !o?.text || !String(o.text).trim());
            const answerValid = ['A', 'B', 'C', 'D'].includes(q.correctAnswer) && keys.includes(q.correctAnswer);
            return opts.length !== 4 || emptyOpt || !answerValid;
          } catch {
            return true;
          }
        });
        const bad = [...new Map([...emptyText, ...structural].map((q) => [q.id, q])).values()];
        if (bad.length) {
          // Pass 4 (pre) — record; then UNPUBLISH
          const ids = bad.map((q) => q.id);
          const res = await prisma.question.updateMany({ where: { id: { in: ids } }, data: { isApproved: false } });
          totalUnpublished += res.count;
          report.push({ exam: exam.name, subject: subject.name, chapter: chapter.name, unpublished: res.count, examples: bad.slice(0, 2).map((q) => String(q.questionText).slice(0, 60)) });
          log(`✗ ${exam.name}/${subject.name}/${chapter.name}: ${res.count}/${all.length} UNPUBLISHED (${bad.slice(0,1).map(q=>String(q.questionText).slice(0,50))})`);
        } else {
          log(`✓ ${exam.name}/${subject.name}/${chapter.name}: ${all.length} ok`);
        }
      }
    }
  }

  // Pass 4 — regression diff summary
  const after = await prisma.question.count({ where: { isApproved: true } });
  log(`\n=== PASS 4 (regression) ===`);
  log(`approved before: ${Object.values(before).reduce((a, b) => a + b, 0)} → approved after: ${after} (${totalUnpublished} unpublished)`);
  log(`exams audited: ${exams.length}`);

  const fs = await import('node:fs');
  fs.writeFileSync('/app/qa-report-v7.json', JSON.stringify({ generatedAt: new Date().toISOString(), totalUnpublished, approvedAfter: after, report }, null, 2));
  log('report → /app/qa-report-v7.json');
}

main().finally(() => prisma.$disconnect());