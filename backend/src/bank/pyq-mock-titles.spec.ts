import { retitlePyqMocks, setNumberForPaper, stripDateFromDescription } from './pyq-mock-titles';

type Row = { id: string; title: string; description?: string; titleLocked: boolean; examId: string | null; year: number | null; shift: string | null; examTier: string | null; tierPaper: string | null; createdAt: Date };

function fake(rows: Row[]) {
  return {
    rows,
    prisma: {
      testTemplate: {
        findMany: async (args: any) => rows.filter((r) => r.id.startsWith('pyq-') && (!args.where.examId || r.examId === args.where.examId) && (args.where.year === undefined || r.year === args.where.year)),
        update: async (args: any) => {
          const r = rows.find((x) => x.id === args.where.id)!;
          Object.assign(r, args.data);
          return r;
        },
      },
      exam: { findMany: async () => [{ id: 'e1', name: 'SSC CGL' }] },
    },
  };
}
const row = (id: string, createdAt: string, extra: Partial<Row> = {}): Row => ({ id, title: 'SSC CGL Tier 1 — 12 Sep 2025 · Shift 1', titleLocked: false, examId: 'e1', year: 2025, shift: 'Shift 1', examTier: 'TIER_1', tierPaper: 'PAPER_1', createdAt: new Date(createdAt), ...extra });

describe('retitlePyqMocks (old dated names -> year + shift + Set n)', () => {
  it('renames every unlocked mock and numbers the Sets by creation order', async () => {
    const f = fake([row('pyq-k-a', '2026-01-01'), row('pyq-k-b', '2026-02-01'), row('pyq-k-c', '2026-02-02', { shift: 'Shift 3' })]);
    expect(await retitlePyqMocks(f.prisma)).toBe(3);
    expect(f.rows.map((r) => r.title)).toEqual(['SSC CGL 2025 · Tier 1 · Shift 1 · Set 1', 'SSC CGL 2025 · Tier 1 · Shift 1 · Set 2', 'SSC CGL 2025 · Tier 1 · Shift 3 · Set 1']);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const f = fake([row('pyq-k-a', '2026-01-01')]);
    await retitlePyqMocks(f.prisma);
    expect(await retitlePyqMocks(f.prisma)).toBe(0);
  });

  it('keeps a name the admin typed (titleLocked) but still counts it as a Set', async () => {
    const f = fake([row('pyq-k-a', '2026-01-01', { titleLocked: true, title: 'My own name' }), row('pyq-k-b', '2026-02-01')]);
    await retitlePyqMocks(f.prisma);
    expect(f.rows[0].title).toBe('My own name');
    expect(f.rows[1].title).toBe('SSC CGL 2025 · Tier 1 · Shift 1 · Set 2');
  });

  it('leaves a mock without a year alone and ignores non-PYQ templates', async () => {
    const f = fake([row('pyq-old', '2026-01-01', { year: null, title: 'SSC CGL — code' }), row('tpl-x', '2026-01-01')]);
    expect(await retitlePyqMocks(f.prisma)).toBe(0);
    expect(f.rows[0].title).toBe('SSC CGL — code');
  });
});

describe('setNumberForPaper', () => {
  it('an existing mock keeps its place, a new one gets the next number', async () => {
    const f = fake([row('pyq-k-a', '2026-01-01'), row('pyq-k-b', '2026-02-01')]);
    const base = { examId: 'e1', year: 2025, shift: 'Shift 1', examTier: 'TIER_1', tierPaper: 'PAPER_1' };
    expect(await setNumberForPaper(f.prisma, { id: 'pyq-k-b', ...base })).toBe(2);
    expect(await setNumberForPaper(f.prisma, { id: 'pyq-k-new', ...base })).toBe(3);
    expect(await setNumberForPaper(f.prisma, { id: 'pyq-k-new', ...base, shift: 'Shift 2' })).toBe(1);
  });
});

describe('old description text', () => {
  it('loses the exam date, keeps the rest', () => {
    expect(stripDateFromDescription('Real SSC CGL Tier 1 paper, 2025-09-12 · Shift 2. Composed exactly as it appeared on the day, question-for-question.')).toBe('Real SSC CGL Tier 1 paper, Shift 2. Composed exactly as it appeared on the day, question-for-question.');
    expect(stripDateFromDescription('Real SSC CGL Tier 2 paper, 2025-01-18. Composed exactly')).toBe('Real SSC CGL Tier 2 paper. Composed exactly');
    expect(stripDateFromDescription('Real SSC CGL paper, Shift 1 — 2025. Composed')).toBe('Real SSC CGL paper, Shift 1 — 2025. Composed');
  });

  it('is cleaned by the retitle run, even for a mock whose name the admin typed', async () => {
    const f = fake([row('pyq-k-a', '2026-01-01', { titleLocked: true, title: 'Mine', description: 'Real SSC CGL Tier 1 paper, 2025-09-12 · Shift 1. Composed' })]);
    expect(await retitlePyqMocks(f.prisma)).toBe(1);
    expect(f.rows[0].title).toBe('Mine');
    expect(f.rows[0].description).toBe('Real SSC CGL Tier 1 paper, Shift 1. Composed');
  });
});
