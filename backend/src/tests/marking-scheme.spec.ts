/* eslint-disable @typescript-eslint/no-explicit-any */
import { cacheClearPrefix } from '../common/cache';
import { EXAM_PRESETS } from '../common/exam-presets';
import { MARKING_CACHE_PREFIX, loadMarkingScheme } from './marking-scheme';

const row = (key: string, id: string) => {
  const p = EXAM_PRESETS.find((x) => x.key === key)!;
  return { id, name: p.name, negativeMarks: p.negativeMarks, sections: p.sections };
};

// exam id -> its active patterns, like prisma.examPattern.findMany({ where: { examId, isActive: true } })
function fakePrisma(byExam: Record<string, any[]>, byId: Record<string, any> = {}) {
  const calls = { findMany: 0, findUnique: 0 };
  const prisma: any = {
    examPattern: {
      findMany: async ({ where }: any) => {
        calls.findMany++;
        return byExam[where.examId] ?? [];
      },
      findUnique: async ({ where }: any) => {
        calls.findUnique++;
        return byId[where.id] ?? null;
      },
    },
  };
  return { prisma, calls };
}

describe('loadMarkingScheme', () => {
  beforeEach(() => cacheClearPrefix(MARKING_CACHE_PREFIX));

  const CGL = { e1: [row('cgl-t1', 'p1'), row('cgl-t2-p1', 'p2'), row('cgl-t2-p2', 'p3')] };

  it('a linked pattern wins over everything else', async () => {
    const { prisma } = fakePrisma(CGL, { linked: row('cpo-p1', 'linked') });
    const s = await loadMarkingScheme(prisma, { examPatternId: 'linked', examId: 'e1', examTier: 'TIER_1' }, []);
    expect(s?.patternId).toBe('linked');
    expect(s?.uniform).toEqual({ marks: 1, negative: 0.25 });
  });

  it('a keyed paper finds its pattern by exam + tier + paper (Tier 2 Paper 2 = Statistics)', async () => {
    const { prisma } = fakePrisma(CGL);
    const s1 = await loadMarkingScheme(prisma, { examId: 'e1', examTier: 'TIER_1', tierPaper: 'PAPER_1' });
    const s2 = await loadMarkingScheme(prisma, { examId: 'e1', examTier: 'TIER_2', tierPaper: null });
    const s3 = await loadMarkingScheme(prisma, { examId: 'e1', examTier: 'TIER_2', tierPaper: 'PAPER_2' });
    expect(s1?.patternId).toBe('p1');
    expect(s2?.patternId).toBe('p2');
    expect(s2?.uniform).toEqual({ marks: 3, negative: 1 });
    expect(s3?.patternId).toBe('p3');
    expect(s3?.uniform).toEqual({ marks: 2, negative: 0.5 });
  });

  it('a year-wise style template (no tier) reads exam and tier from the questions when they all agree', async () => {
    const { prisma } = fakePrisma(CGL);
    const t2 = [{ examId: 'e1', examTier: 'TIER_2', tierPaper: 'PAPER_1' }, { examId: 'e1', examTier: 'TIER_2', tierPaper: null }];
    expect((await loadMarkingScheme(prisma, null, t2))?.patternId).toBe('p2');
  });

  it('no tier anywhere: the exam’s Tier 1 / Paper 1 pattern, never Tier 2', async () => {
    const { prisma } = fakePrisma(CGL);
    const untiered = [{ examId: 'e1' }, { examId: 'e1', examTier: null }];
    expect((await loadMarkingScheme(prisma, null, untiered))?.patternId).toBe('p1');
  });

  it('an exam without tiers (CPO, MTS) is found by exam alone', async () => {
    const { prisma } = fakePrisma({ cpo: [row('cpo-p1', 'c1'), row('cpo-p2', 'c2')], mts: [row('mts', 'm1')] });
    expect((await loadMarkingScheme(prisma, { examId: 'cpo' }, []))?.patternId).toBe('c1'); // Paper 1, not Paper 2
    const mts = await loadMarkingScheme(prisma, null, [{ examId: 'mts' }]);
    expect(mts?.patternId).toBe('m1');
    expect(mts?.uniform).toBeNull(); // Session I has no negative marking, Session II has
  });

  it('CPO questions tagged Tier 1, or untiered Paper 2 questions, still find the CPO preset of their paper', async () => {
    const { prisma } = fakePrisma({ cpo: [row('cpo-p1', 'c1'), row('cpo-p2', 'c2')] });
    expect((await loadMarkingScheme(prisma, null, [{ examId: 'cpo', examTier: 'TIER_1' }]))?.patternId).toBe('c1');
    expect((await loadMarkingScheme(prisma, null, [{ examId: 'cpo', examTier: null, tierPaper: 'PAPER_2' }]))?.patternId).toBe('c2');
  });

  it('questions of several exams get no preset (practice mixes keep the question columns)', async () => {
    const { prisma } = fakePrisma({ ...CGL, cpo: [row('cpo-p1', 'c1')] });
    expect(await loadMarkingScheme(prisma, null, [{ examId: 'e1' }, { examId: 'cpo' }])).toBeNull();
    expect(await loadMarkingScheme(prisma, null, [{ examId: 'e1' }, { examId: null }])).toBeNull();
    expect(await loadMarkingScheme(prisma, null, [])).toBeNull();
  });

  it('two Tier 1 patterns that would score differently are ambiguous -> none; identical ones are fine', async () => {
    const a = row('cgl-t1', 'a');
    const different = { ...row('cgl-t1', 'b'), name: 'SSC CGL 2026 — Tier 1', negativeMarks: 0.25, sections: row('cgl-t1', 'b').sections.map((s: any) => ({ ...s, marks: s.marks / 2 })) };
    const same = { ...row('cgl-t1', 'c'), name: 'SSC CGL 2026 — Tier 1' };
    expect(await loadMarkingScheme(fakePrisma({ e: [a, different] }).prisma, { examId: 'e', examTier: 'TIER_1' })).toBeNull();
    cacheClearPrefix(MARKING_CACHE_PREFIX); // same exam id, new pattern list
    expect((await loadMarkingScheme(fakePrisma({ e: [a, same] }).prisma, { examId: 'e', examTier: 'TIER_1' }))?.patternId).toBe('a');
  });

  it('a tier with no preset gives none, not the wrong tier', async () => {
    const { prisma } = fakePrisma({ chsl: [row('chsl-t1', 'x')] });
    expect(await loadMarkingScheme(prisma, { examId: 'chsl', examTier: 'TIER_2' })).toBeNull();
  });

  it('caches the exam’s pattern list for 5 minutes (one query for many submits)', async () => {
    const { prisma, calls } = fakePrisma(CGL);
    await loadMarkingScheme(prisma, { examId: 'e1', examTier: 'TIER_1' });
    await loadMarkingScheme(prisma, { examId: 'e1', examTier: 'TIER_2' });
    expect(calls.findMany).toBe(1);
    cacheClearPrefix(MARKING_CACHE_PREFIX); // what the admin pattern writes do
    await loadMarkingScheme(prisma, { examId: 'e1', examTier: 'TIER_1' });
    expect(calls.findMany).toBe(2);
  });

  it('a database error never blocks a submit: it returns none and the caller keeps the question columns', async () => {
    const prisma: any = { examPattern: { findMany: async () => { throw new Error('db down'); }, findUnique: async () => { throw new Error('db down'); } } };
    expect(await loadMarkingScheme(prisma, { examPatternId: 'x', examId: 'e1' }, [])).toBeNull();
  });
});
