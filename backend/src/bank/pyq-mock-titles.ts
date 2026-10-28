/**
 * Student-safe names of the real-paper (PYQ) mocks (29 Oct 2026): no exam date, only year + shift + "Set n".
 * See common/pyq-mock-title.ts for the format. Kept free of Nest imports and taking a minimal Prisma-shaped
 * object, like pyq-paper-builder.ts, so it can run against an in-memory fake in a test.
 */
import { MockForSetNo, StudentTitleParts, assignSetNumbers, studentMockTitle } from '../common/pyq-mock-title';

export interface TitlePrisma {
  testTemplate: {
    findMany(args: any): Promise<any[]>;
    update(args: any): Promise<any>;
  };
  exam: { findMany(args: any): Promise<{ id: string; name: string }[]> };
}

/** "Real SSC CGL Tier 1 paper, 2025-09-12 · Shift 2. Composed ..." -> "... paper, Shift 2. Composed ..." (old text written before 29 Oct 2026). */
export function stripDateFromDescription(text: string): string {
  return text.replace(/paper, \d{4}-\d{2}-\d{2} · /, 'paper, ').replace(/paper, \d{4}-\d{2}-\d{2}\./, 'paper.');
}

const SELECT = { id: true, title: true, description: true, titleLocked: true, examId: true, year: true, shift: true, examTier: true, tierPaper: true, createdAt: true };

/**
 * Set number the mock `a.id` has (or WOULD get if it is created now): its place, oldest first, among the real-paper
 * mocks of the same exam + tier + paper + year + shift.
 */
export async function setNumberForPaper(
  prisma: TitlePrisma,
  a: { id: string; examId: string; year: number | null; shift: string | null; examTier: string | null; tierPaper: string | null },
): Promise<number> {
  const rows: MockForSetNo[] = await prisma.testTemplate.findMany({
    where: { id: { startsWith: 'pyq-' }, examId: a.examId, year: a.year },
    select: SELECT,
    take: 2000,
  });
  if (!rows.some((r) => r.id === a.id)) {
    rows.push({ id: a.id, examId: a.examId, year: a.year, shift: a.shift, examTier: a.examTier, tierPaper: a.tierPaper, createdAt: new Date() });
  }
  return assignSetNumbers(rows).get(a.id) ?? 1;
}

/**
 * Rewrites the title of every real-paper mock to the student-safe name. A mock the admin renamed by hand
 * (titleLocked) keeps its name. Returns how many titles changed. Safe to run any number of times.
 */
export async function retitlePyqMocks(prisma: TitlePrisma, onlyExamId?: string): Promise<number> {
  const rows: (MockForSetNo & { title: string; description?: string | null; titleLocked: boolean })[] = await prisma.testTemplate.findMany({
    where: { id: { startsWith: 'pyq-' }, ...(onlyExamId ? { examId: onlyExamId } : {}) },
    select: SELECT,
    take: 5000,
  });
  if (rows.length === 0) return 0;
  const setNos = assignSetNumbers(rows);
  const examIds = [...new Set(rows.map((r) => r.examId).filter((x): x is string => !!x))];
  const exams = examIds.length ? await prisma.exam.findMany({ where: { id: { in: examIds } }, select: { id: true, name: true } }) : [];
  const examName = new Map(exams.map((e) => [e.id, e.name]));
  let changed = 0;
  for (const r of rows) {
    const data: { title?: string; description?: string } = {};
    if (!r.titleLocked && r.year) {
      const parts: StudentTitleParts = { examTier: r.examTier, tierPaper: r.tierPaper, year: r.year, shift: r.shift };
      const next = studentMockTitle(examName.get(r.examId ?? '') ?? 'SSC', parts, setNos.get(r.id) ?? 1);
      if (next !== r.title) data.title = next;
    }
    if (typeof r.description === 'string') {
      const cleaned = stripDateFromDescription(r.description);
      if (cleaned !== r.description) data.description = cleaned;
    }
    if (data.title === undefined && data.description === undefined) continue;
    await prisma.testTemplate.update({ where: { id: r.id }, data });
    changed++;
  }
  return changed;
}
