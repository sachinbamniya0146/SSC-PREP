import { analyzeKeyedPaper, buildKeyedPaper, findPatternForPaper, legacyPaperCeiling, missingNumberRanges, PaperBuilderPrisma } from './pyq-paper-builder';
import { dedupeAndCapPaperRows } from '../common/pyq-paper';
import { PaperParts } from '../common/pyq-paper-key';

// ---- tiny in-memory Prisma stand-in (only what the builder touches) --------------------------------------
type Row = Record<string, any>;
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return (v as Row[]).every((w) => matches(row, w));
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    const cur = row[k] === undefined ? null : row[k];
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('startsWith' in v || 'not' in v) {
        const sw = (v as any).startsWith as string | undefined;
        const not = (v as any).not as { startsWith?: string } | string | null | undefined;
        if (sw && !String(cur ?? '').startsWith(sw)) return false;
        if (not && typeof not === 'object' && not.startsWith && String(cur ?? '').startsWith(not.startsWith)) return false;
        if (not !== undefined && (not === null || typeof not === 'string') && cur === not) return false;
        return true;
      }
    }
    return cur === (v === undefined ? null : v);
  });
}
function fakePrisma(opts: { patterns?: any[] } = {}) {
  const questions: Row[] = [];
  const templates = new Map<string, Row>();
  let t = 0;
  const prisma: PaperBuilderPrisma = {
    question: { findMany: async ({ where }: any) => questions.filter((q) => matches(q, where)).map((q) => ({ ...q })) },
    exam: { findUnique: async () => ({ name: 'SSC CGL' }) },
    examPattern: { findMany: async () => opts.patterns ?? [] },
    testTemplate: {
      findFirst: async ({ where }: any) => [...templates.values()].find((x) => matches(x, where)) ?? null,
      findUnique: async ({ where }: any) => (templates.has(where.id) ? { ...templates.get(where.id) } : null),
      update: async ({ where, data }: any) => { Object.assign(templates.get(where.id)!, data); },
      upsert: async ({ where, create, update }: any) => {
        if (templates.has(where.id)) Object.assign(templates.get(where.id)!, update);
        else templates.set(where.id, { ...create });
      },
    },
  };
  const add = (n: number, over: Row, prefix: string) => {
    for (let i = 1; i <= n; i++) {
      questions.push({
        id: `${prefix}-${i}`, questionText: `${prefix} question ${i}`, createdAt: new Date(2026, 9, 26, 0, 0, t++), marks: 2,
        isApproved: true, isActive: true, autoSuspended: false, examId: 'exam-cgl', examTier: 'TIER_1', tierPaper: null,
        examDate: '2025-09-12', shift: 'Shift 2', paperQuestionNo: null, paperCode: `SSC-CGL-${prefix}`, ...over,
      });
    }
  };
  return { prisma, questions, templates, add };
}
const T1: PaperParts = { examId: 'exam-cgl', examTier: 'TIER_1', examDate: '2025-09-12', shift: 'Shift 2' };
const T2: PaperParts = { examId: 'exam-cgl', examTier: 'TIER_2', examDate: '2025-09-12' };
const pat = (name: string, totalQuestions: number, durationMinutes = 60) => ({ id: name, name, totalQuestions, durationMinutes });

describe('buildKeyedPaper: one mock per paper, growing as subjects are uploaded', () => {
  it('Reasoning 25 -> Maths 25 -> English+GA 50: ONE mock, same id, 25 -> 50 -> 100, goes live only at 100', async () => {
    const f = fakePrisma({ patterns: [pat('SSC CGL Tier 1', 100)] });
    f.add(25, {}, 'reasoning');
    const a = await buildKeyedPaper(f.prisma, T1);
    expect(a!.built).toBe(25);
    expect(a!.live).toBe(false);
    f.add(25, { paperCode: 'SSC-CGL-T-I-12-Sep-2025-S2' }, 'maths'); // different paperCode spelling: must not split the paper
    const b = await buildKeyedPaper(f.prisma, T1);
    expect(b!.built).toBe(50);
    f.add(50, {}, 'eng-ga');
    const c = await buildKeyedPaper(f.prisma, T1);
    expect(c!.built).toBe(100);
    expect(c!.live).toBe(true);
    expect([a!.templateId, b!.templateId].every((id) => id === c!.templateId)).toBe(true);
    expect(f.templates.size).toBe(1);
    const tpl = f.templates.get(c!.templateId)!;
    expect(tpl.totalQuestions).toBe(100);
    expect(tpl.isActive).toBe(true);
    expect(tpl.isPremium).toBe(false);
    expect(tpl.title).toBe('SSC CGL Tier 1 — 12 Sep 2025 · Shift 2');
    expect(tpl.examTier).toBe('TIER_1');
    expect(tpl.year).toBe(2025);
  });

  it('is hidden while building, and stays hidden for the first two uploads', async () => {
    const f = fakePrisma();
    f.add(25, {}, 'a');
    await buildKeyedPaper(f.prisma, T1);
    expect([...f.templates.values()][0].isActive).toBe(false);
  });

  it('re-running with no new data changes nothing (idempotent)', async () => {
    const f = fakePrisma();
    f.add(100, {}, 'a');
    const x = await buildKeyedPaper(f.prisma, T1);
    const y = await buildKeyedPaper(f.prisma, T1);
    expect(y).toEqual(x);
    expect(f.templates.size).toBe(1);
  });

  it('Tier 1 and Tier 2 of the same date are separate mocks', async () => {
    const f = fakePrisma();
    f.add(30, {}, 'one');
    f.add(30, { examTier: 'TIER_2', shift: null }, 'two');
    const a = await buildKeyedPaper(f.prisma, T1);
    const b = await buildKeyedPaper(f.prisma, T2);
    expect(a!.templateId).not.toBe(b!.templateId);
    expect(a!.built).toBe(30);
    expect(b!.built).toBe(30);
    expect(f.templates.size).toBe(2);
    expect(f.templates.get(b!.templateId)!.title).toBe('SSC CGL Tier 2 · Paper 1 — 12 Sep 2025');
  });

  it('different shift = different mock', async () => {
    const f = fakePrisma();
    f.add(20, { shift: 'Shift 1' }, 'a');
    f.add(20, { shift: 'Shift 3' }, 'b');
    const a = await buildKeyedPaper(f.prisma, { ...T1, shift: 'Shift 1' });
    const b = await buildKeyedPaper(f.prisma, { ...T1, shift: 'Shift 3' });
    expect(a!.templateId).not.toBe(b!.templateId);
    expect(a!.built).toBe(20);
    expect(b!.built).toBe(20);
  });

  it('rows without date/tier, unpublished rows and other papers never join', async () => {
    const f = fakePrisma();
    f.add(10, {}, 'ok');
    f.add(5, { examDate: null }, 'nodate');
    f.add(5, { examTier: null }, 'notier');
    f.add(5, { isApproved: false }, 'nohindi');
    f.add(5, { examId: 'exam-chsl' }, 'otherexam');
    f.add(5, { tierPaper: 'PAPER_2' }, 'paper2');
    const r = await buildKeyedPaper(f.prisma, T1);
    expect(r!.built).toBe(10);
  });

  it('PAPER_1 matches blank and explicit PAPER_1', async () => {
    const f = fakePrisma();
    f.add(5, { tierPaper: null }, 'a');
    f.add(5, { tierPaper: 'PAPER_1' }, 'b');
    expect((await buildKeyedPaper(f.prisma, T1))!.built).toBe(10);
  });

  it('a question repeated in the same paper is counted once', async () => {
    const f = fakePrisma();
    f.add(10, {}, 'a');
    f.questions.push({ ...f.questions[0], id: 'dup', createdAt: new Date(2030, 0, 1), questionText: '  A QUESTION 1 '.replace('A', 'a') });
    expect((await buildKeyedPaper(f.prisma, T1))!.built).toBe(10);
  });

  it('no questions yet -> no mock is created', async () => {
    const f = fakePrisma();
    expect(await buildKeyedPaper(f.prisma, T1)).toBeNull();
    expect(f.templates.size).toBe(0);
  });

  it('Tier 2 Paper I (150 questions) is NOT cut at 100 and goes live at the pattern target', async () => {
    const f = fakePrisma({ patterns: [pat('SSC CGL Tier 1', 100), pat('SSC CGL Tier 2 Paper I', 150, 135), pat('SSC CGL Tier 2 Paper II', 100)] });
    f.add(100, { examTier: 'TIER_2', shift: null }, 'q');
    const a = await buildKeyedPaper(f.prisma, T2);
    expect(a!.built).toBe(100);
    expect(a!.live).toBe(false);
    f.add(50, { examTier: 'TIER_2', shift: null }, 'r');
    const b = await buildKeyedPaper(f.prisma, T2);
    expect(b!.built).toBe(150);
    expect(b!.live).toBe(true);
    const tpl = f.templates.get(b!.templateId)!;
    expect(tpl.targetQuestions).toBe(150);
    expect(tpl.durationMinutes).toBe(135);
  });

  it('once live it is never switched off by a later rebuild, and a manual admin hide is respected', async () => {
    const f = fakePrisma({ patterns: [pat('SSC CGL Tier 1', 100)] });
    f.add(100, {}, 'a');
    const a = await buildKeyedPaper(f.prisma, T1);
    expect(a!.live).toBe(true);
    f.templates.get(a!.templateId)!.isActive = false; // admin hides it
    f.add(5, {}, 'extra');
    await buildKeyedPaper(f.prisma, T1);
    expect(f.templates.get(a!.templateId)!.isActive).toBe(false); // not forced back on
    expect(f.templates.get(a!.templateId)!.totalQuestions).toBe(105);
  });

  it('an older paperCode-based mock for the same exam + date + shift stays the mock; no twin is created', async () => {
    const f = fakePrisma();
    f.templates.set('pyq-ssc-cgl-t-i-12-sep-2025-s2', { id: 'pyq-ssc-cgl-t-i-12-sep-2025-s2', examId: 'exam-cgl', examDate: '2025-09-12', shift: 'Shift 2', examTier: null, isActive: true, totalQuestions: 80 });
    f.add(25, {}, 'a');
    const r = await buildKeyedPaper(f.prisma, T1);
    expect(r).toBeNull();
    expect(f.templates.size).toBe(1);
    const legacy = f.templates.get('pyq-ssc-cgl-t-i-12-sep-2025-s2')!;
    expect(legacy.examTier).toBe('TIER_1'); // tier stamped for the /mocks tabs
    expect(legacy.totalQuestions).toBe(80); // untouched
    expect(legacy.isActive).toBe(true); // untouched
  });
});

describe('findPatternForPaper', () => {
  it('matches by tier name; ambiguous tier-2 patterns need a paper match', async () => {
    const f = fakePrisma({ patterns: [pat('SSC CGL Tier 1', 100), pat('SSC CGL Tier 2 Paper I', 150), pat('SSC CGL Tier 2 Paper II', 100)] });
    expect((await findPatternForPaper(f.prisma, 'exam-cgl', 'TIER_1', 'PAPER_1'))!.totalQuestions).toBe(100);
    expect((await findPatternForPaper(f.prisma, 'exam-cgl', 'TIER_2', 'PAPER_1'))!.totalQuestions).toBe(150);
    expect((await findPatternForPaper(f.prisma, 'exam-cgl', 'TIER_2', 'PAPER_2'))!.totalQuestions).toBe(100);
  });
  it('no clear match -> undefined (caller falls back to 100)', async () => {
    const none = fakePrisma({ patterns: [pat('SSC CGL Tier 2 Paper I', 150), pat('SSC CGL Tier 2 Paper II', 100)] });
    expect(await findPatternForPaper(none.prisma, 'exam-cgl', 'TIER_2', 'PAPER_3')).toBeUndefined();
    expect(await findPatternForPaper(none.prisma, 'exam-cgl', 'TIER_1', 'PAPER_1')).toBeUndefined();
    const tierII = fakePrisma({ patterns: [pat('SSC CGL Tier II', 130)] });
    expect((await findPatternForPaper(tierII.prisma, 'exam-cgl', 'TIER_2', 'PAPER_1'))!.totalQuestions).toBe(130);
    expect(await findPatternForPaper(tierII.prisma, 'exam-cgl', 'TIER_1', 'PAPER_1')).toBeUndefined();
  });
});

describe('legacyPaperCeiling: legacy paperCode mocks follow the pattern instead of a hard 100', () => {
  const withPatterns = (patterns: any[]) => ({ examPattern: { findMany: async () => patterns } });
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `q${i}`, questionText: `question ${i}`, createdAt: new Date(2026, 0, 1, 0, 0, i) }));

  it('no exam / no pattern -> 100 (old behaviour)', async () => {
    expect(await legacyPaperCeiling(withPatterns([]), undefined)).toBe(100);
    expect(await legacyPaperCeiling(withPatterns([]), 'exam-cgl')).toBe(100);
  });

  it('one pattern of 150 questions -> 150, and a 130-question paper is no longer cut at 100', async () => {
    const c = await legacyPaperCeiling(withPatterns([pat('SSC CGL Tier 2', 150)]), 'exam-cgl');
    expect(c).toBe(150);
    expect(dedupeAndCapPaperRows(rows(130), c)).toHaveLength(130);
    expect(dedupeAndCapPaperRows(rows(130))).toHaveLength(100); // default is unchanged
  });

  it('never goes below 100 (an existing mock must not shrink) and never above the keyed ceiling', async () => {
    expect(await legacyPaperCeiling(withPatterns([pat('Typing', 40)]), 'exam-x')).toBe(100);
    expect(await legacyPaperCeiling(withPatterns([pat('Huge', 5000)]), 'exam-x')).toBe(300);
  });

  it('ambiguous exam-level patterns (Tier 1 = 100, Tier 2 = 150) stay at 100', async () => {
    expect(await legacyPaperCeiling(withPatterns([pat('SSC CGL Tier 1', 100), pat('SSC CGL Tier 2', 150)]), 'exam-cgl')).toBe(100);
  });

  it('rows that carry a tier use that tier\'s pattern', async () => {
    const both = withPatterns([pat('SSC CGL Tier 1', 100), pat('SSC CGL Tier 2', 150)]);
    expect(await legacyPaperCeiling(both, 'exam-cgl', { examTier: 'TIER_2' })).toBe(150);
    expect(await legacyPaperCeiling(both, 'exam-cgl', { examTier: 'TIER_1' })).toBe(100);
  });

  it('a failing lookup falls back to 100 instead of throwing', async () => {
    const broken = { examPattern: { findMany: async () => { throw new Error('db down'); } } };
    expect(await legacyPaperCeiling(broken as any, 'exam-cgl')).toBe(100);
  });
});

describe('admin paper detail: what is still missing', () => {
  it('missingNumberRanges compresses gaps into ranges', () => {
    expect(missingNumberRanges([1, 2, 3, 7, 9, 10], 12)).toEqual(['4–6', '8', '11–12']);
    expect(missingNumberRanges([], 3)).toEqual(['1–3']);
    expect(missingNumberRanges([1, 2, 3], 3)).toEqual([]);
    expect(missingNumberRanges([0, 5, 99], 5)).toEqual(['1–4']); // 0 and out-of-range numbers are ignored
  });

  it('shows Q41–60 missing and the short subject when only 80 of 100 are in', async () => {
    const f = fakePrisma({ patterns: [{ ...pat('SSC CGL Tier 1', 100), sections: [
      { name: 'Reasoning', subjectSlug: 'reasoning', questions: 25, marks: 50, durationMinutes: 15 },
      { name: 'Maths', subjectSlug: 'quant', questions: 25, marks: 50, durationMinutes: 15 },
    ] }] });
    for (let i = 1; i <= 40; i++) f.questions.push({ id: `r${i}`, questionText: `r ${i}`, createdAt: new Date(2026, 9, 26, 0, 0, i), marks: 2, isApproved: true, isActive: true, autoSuspended: false, examId: 'exam-cgl', examTier: 'TIER_1', tierPaper: null, examDate: '2025-09-12', shift: 'Shift 2', paperQuestionNo: i, subject: { name: 'Reasoning', slug: 'reasoning' } });
    for (let i = 61; i <= 100; i++) f.questions.push({ id: `m${i}`, questionText: `m ${i}`, createdAt: new Date(2026, 9, 26, 0, 1, i), marks: 2, isApproved: true, isActive: true, autoSuspended: false, examId: 'exam-cgl', examTier: 'TIER_1', tierPaper: null, examDate: '2025-09-12', shift: 'Shift 2', paperQuestionNo: i, subject: { name: 'Maths', slug: 'quant' } });
    const d = await analyzeKeyedPaper(f.prisma, { id: 'x', examId: 'exam-cgl', examTier: 'TIER_1', tierPaper: null, examDate: '2025-09-12', shift: 'Shift 2' });
    expect(d).not.toBeNull();
    expect(d!.built).toBe(80);
    expect(d!.target).toBe(100);
    expect(d!.numbering).toEqual({ numbered: 80, unnumbered: 0, missing: ['41–60'] });
    expect(d!.subjects.find((x) => x.slug === 'reasoning')).toMatchObject({ have: 40, need: 25 });
    expect(d!.shortSections).toEqual([]); // both sections have at least their 25
  });

  it('flags a short subject and counts unnumbered + duplicate rows', async () => {
    const f = fakePrisma({ patterns: [{ ...pat('SSC CGL Tier 1', 100), sections: [{ name: 'Maths', subjectSlug: 'quant', questions: 25, marks: 50, durationMinutes: 15 }] }] });
    const base = { marks: 2, isApproved: true, isActive: true, autoSuspended: false, examId: 'exam-cgl', examTier: 'TIER_1', tierPaper: null, examDate: '2025-09-12', shift: 'Shift 2', subject: { name: 'Maths', slug: 'quant' } };
    for (let i = 1; i <= 10; i++) f.questions.push({ ...base, id: `m${i}`, questionText: `m ${i}`, createdAt: new Date(2026, 9, 26, 0, 0, i), paperQuestionNo: null });
    f.questions.push({ ...base, id: 'dup', questionText: 'm 1', createdAt: new Date(2026, 9, 26, 0, 5, 0), paperQuestionNo: null }); // same text again
    const d = await analyzeKeyedPaper(f.prisma, { id: 'x', examId: 'exam-cgl', examTier: 'TIER_1', tierPaper: null, examDate: '2025-09-12', shift: 'Shift 2' });
    expect(d!.built).toBe(10);
    expect(d!.duplicatesDropped).toBe(1);
    expect(d!.numbering).toEqual({ numbered: 0, unnumbered: 10, missing: null });
    expect(d!.shortSections).toEqual(['Maths: 15 more needed (10/25)']);
  });

  it('a paper without exam / tier / date has no detail', async () => {
    const f = fakePrisma();
    expect(await analyzeKeyedPaper(f.prisma, { id: 'x', examId: 'e', examTier: null, tierPaper: null, examDate: null, shift: null })).toBeNull();
  });
});

describe('titleLocked: a hand-typed mock name survives later uploads', () => {
  it('keeps the admin title while the mock keeps growing', async () => {
    const f = fakePrisma({ patterns: [pat('SSC CGL Tier 1', 100)] });
    f.add(30, {}, 'reasoning');
    await buildKeyedPaper(f.prisma, T1);
    const id = [...f.templates.keys()][0];
    f.templates.get(id)!.title = 'CGL 2025 — Shift 2 (Sachin edit)';
    f.templates.get(id)!.titleLocked = true;
    f.add(30, {}, 'maths');
    await buildKeyedPaper(f.prisma, T1);
    expect(f.templates.get(id)!.title).toBe('CGL 2025 — Shift 2 (Sachin edit)');
    expect(f.templates.get(id)!.totalQuestions).toBe(60);
  });

  it('an unlocked title still follows the paper', async () => {
    const f = fakePrisma({ patterns: [pat('SSC CGL Tier 1', 100)] });
    f.add(30, {}, 'reasoning');
    await buildKeyedPaper(f.prisma, T1);
    const id = [...f.templates.keys()][0];
    f.templates.get(id)!.title = 'old auto title';
    f.add(30, {}, 'maths');
    await buildKeyedPaper(f.prisma, T1);
    expect(f.templates.get(id)!.title).not.toBe('old auto title');
  });
});
