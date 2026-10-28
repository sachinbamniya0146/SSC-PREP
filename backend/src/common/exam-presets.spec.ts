/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  EXAM_PRESETS,
  ExistingPattern,
  classifyPatternName,
  mergeSections,
  planPresetSync,
  sourceNoteFor,
} from './exam-presets';
import { buildSectionPlan, readPatternSections } from './section-plan';

const EXAMS = [
  { id: 'e-cgl', slug: 'cgl' },
  { id: 'e-chsl', slug: 'chsl' },
  { id: 'e-mts', slug: 'mts' },
  { id: 'e-cpo', slug: 'cpo' },
  { id: 'e-gd', slug: 'gd' },
];

const existing = (over: Partial<ExistingPattern> & { id: string; examId: string; name: string }): ExistingPattern => ({
  isActive: true,
  totalQuestions: 100,
  totalMarks: 200,
  durationMinutes: 60,
  negativeMarks: 0.5,
  sections: [],
  lockPreviousSections: false,
  ...over,
});

describe('preset data sanity', () => {
  it('keys and (exam, tier, paper, name) are unique', () => {
    expect(new Set(EXAM_PRESETS.map((p) => p.key)).size).toBe(EXAM_PRESETS.length);
    const ids = EXAM_PRESETS.map((p) => `${p.examSlugs[0]}|${p.match.tier}|${p.match.paper}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(EXAM_PRESETS.map((p) => [p.key, p] as const))('%s adds up', (_key, p) => {
    expect(p.sections.reduce((a, s) => a + s.questions, 0)).toBe(p.totalQuestions);
    expect(Math.round(p.sections.reduce((a, s) => a + s.marks, 0) * 100) / 100).toBe(p.totalMarks);
    expect(p.negativeMarks).toBeGreaterThanOrEqual(0);
    expect(p.durationMinutes).toBeGreaterThan(0);
    expect(Number.isInteger(p.totalMarks)).toBe(true); // ExamPattern.totalMarks is an Int column
    expect(Number.isInteger(p.durationMinutes)).toBe(true);
    for (const s of p.sections) expect(s.negativeMarks === undefined || s.negativeMarks >= 0).toBe(true);
    expect(sourceNoteFor(p)).toContain(p.source);
  });

  it('a preset that locks sections has a timer on every section and a distinct subject per section', () => {
    for (const p of EXAM_PRESETS.filter((x) => x.lockSections)) {
      expect(p.sections.every((s) => (s.durationMinutes ?? 0) > 0)).toBe(true);
      const slugs = p.sections.map((s) => s.subjectSlug);
      expect(slugs.every(Boolean)).toBe(true);
      expect(new Set(slugs).size).toBe(slugs.length);
      const plan = buildSectionPlan({ negativeMarks: p.negativeMarks, lockPreviousSections: true, scribeExtraMinutes: p.scribeExtraMinutes, sections: p.sections });
      expect(plan).not.toBeNull();
      // the timers add up to the exam's duration
      expect(Math.round(plan!.totalMs / 60000)).toBe(p.durationMinutes);
    }
  });

  it('only SECONDARY presets say so in the note', () => {
    for (const p of EXAM_PRESETS) {
      const note = sourceNoteFor(p);
      // the admin page shows the green "Verified" badge only for notes that start with VERIFIED
      expect(/^VERIFIED\b/.test(note)).toBe(p.verification === 'OFFICIAL');
      if (p.verification === 'SECONDARY') expect(note.startsWith('NOT VERIFIED')).toBe(true);
    }
  });
});

describe('classifyPatternName', () => {
  it.each([
    ['SSC CGL Tier 1 (2025)', 'TIER_1', 'PAPER_1'],
    ['SSC CGL 2026 — Tier 1', 'TIER_1', 'PAPER_1'],
    ['SSC CGL 2026 — Tier 2 Paper I (Session I)', 'TIER_2', 'PAPER_1'],
    ['SSC CGL Tier II Paper II (Statistics)', 'TIER_2', 'PAPER_2'],
    ['SSC CHSL Tier-2', 'TIER_2', 'PAPER_1'],
    ['SSC CPO Paper 1 (2024)', null, 'PAPER_1'],
    ['SSC CPO SI Paper II', null, 'PAPER_2'],
    ['SSC JE Paper III', null, 'PAPER_3'],
    ['SSC MTS (2024)', null, 'PAPER_1'],
    ['SSC GD Constable (CBE 2024)', null, 'PAPER_1'],
  ])('%s', (name, tier, paper) => {
    expect(classifyPatternName(name as string)).toEqual({ tier, paper });
  });
});

describe('planPresetSync', () => {
  const only = (keys: string[]) => EXAM_PRESETS.filter((p) => keys.includes(p.key));

  it('skips a preset whose exam does not exist and creates nothing for it', () => {
    const plan = planPresetSync({ presets: only(['steno']), exams: EXAMS, patterns: [] });
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe('skip');
    expect(plan[0].warnings[0]).toMatch(/exam not found/);
  });

  it('creates a missing pattern, locked only where the notice says sectional timers', () => {
    const plan = planPresetSync({ presets: only(['cpo-p1', 'gd']), exams: EXAMS, patterns: [] });
    const cpo = plan.find((a) => a.presetKey === 'cpo-p1')!;
    const gd = plan.find((a) => a.presetKey === 'gd')!;
    expect(cpo.kind).toBe('create');
    expect(cpo.create!.lockPreviousSections).toBe(true);
    expect(cpo.create!.totalQuestions).toBe(200);
    expect(gd.create!.lockPreviousSections).toBe(false);
  });

  it('the OLD wrong CPO / GD / MTS numbers are corrected in place — the pattern keeps its name', () => {
    const patterns = [
      existing({ id: 'p-cpo', examId: 'e-cpo', name: 'SSC CPO Paper 1 (2024)', totalQuestions: 100, durationMinutes: 60, negativeMarks: 0.5, sections: [
        { name: 'Part A · Reasoning', subjectSlug: 'reasoning', questions: 25, marks: 50, durationMinutes: 15 },
        { name: 'Part B · General Awareness', subjectSlug: 'general_awareness', questions: 25, marks: 50, durationMinutes: 15 },
        { name: 'Part C · Quantitative Aptitude', subjectSlug: 'quantitative_aptitude', questions: 25, marks: 50, durationMinutes: 15 },
        { name: 'Part D · English', subjectSlug: 'english', questions: 25, marks: 50, durationMinutes: 15 },
      ] }),
      existing({ id: 'p-gd', examId: 'e-gd', name: 'SSC GD Constable (CBE 2024)', totalQuestions: 80, totalMarks: 160, durationMinutes: 60, negativeMarks: 0.5 }),
      existing({ id: 'p-mts', examId: 'e-mts', name: 'SSC MTS (2024)', totalQuestions: 90, totalMarks: 225, durationMinutes: 90, negativeMarks: 0.25 }),
    ];
    const plan = planPresetSync({ presets: only(['cpo-p1', 'gd', 'mts']), exams: EXAMS, patterns });
    const cpo = plan.find((a) => a.presetKey === 'cpo-p1')!;
    expect(cpo.kind).toBe('update');
    expect(cpo.patternId).toBe('p-cpo');
    expect(cpo.changes.join(' | ')).toMatch(/questions 100 -> 200/);
    expect(cpo.changes.join(' | ')).toMatch(/negative 0.5 -> 0.25/);
    // admin-owned bits survive: the section names (matched by subject) ...
    expect(readPatternSections(cpo.write!.sections).map((s) => s.name)).toEqual([
      'Part A · Reasoning',
      'Part B · General Awareness',
      'Part C · Quantitative Aptitude',
      'Part D · English',
    ]);
    // ... but the marks come from the notice
    expect(readPatternSections(cpo.write!.sections).map((s) => [s.questions, s.marks])).toEqual([[50, 50], [50, 50], [50, 50], [50, 50]]);
    const gd = plan.find((a) => a.presetKey === 'gd')!;
    expect(gd.changes).toContain('negative 0.5 -> 0.25');
    // the totals / duration were already right, only the penalty (and the section detail) differ
    expect(gd.changes.filter((c) => !c.startsWith('negative') && !c.startsWith('sections'))).toEqual([]);
    const mts = plan.find((a) => a.presetKey === 'mts')!;
    expect(mts.write!.totalMarks).toBe(270);
    const mtsSections = readPatternSections(mts.write!.sections);
    expect(mtsSections.map((s) => s.negativeMarks)).toEqual([0, 0, 1, 1]);
  });

  it('is idempotent: applying the plan and planning again changes nothing', () => {
    const patterns = [existing({ id: 'p-cpo', examId: 'e-cpo', name: 'SSC CPO Paper 1 (2024)' })];
    const first = planPresetSync({ presets: only(['cpo-p1']), exams: EXAMS, patterns });
    expect(first[0].kind).toBe('update');
    const applied: ExistingPattern[] = [{ ...patterns[0], ...first[0].write! }];
    const second = planPresetSync({ presets: only(['cpo-p1']), exams: EXAMS, patterns: applied });
    expect(second[0].kind).toBe('unchanged');
    expect(second[0].changes).toEqual([]);
  });

  it('never touches lock / scribe, and keeps the admin timers', () => {
    const locked = existing({
      id: 'p-chsl',
      examId: 'e-chsl',
      name: 'SSC CHSL Tier 1 (2024)',
      lockPreviousSections: true,
      sections: [
        { name: 'English', subjectSlug: 'english', questions: 25, marks: 50, durationMinutes: 20, scribeMinutes: 25 },
        { name: 'GI', subjectSlug: 'reasoning', questions: 25, marks: 50, durationMinutes: 10 },
        { name: 'Quant', subjectSlug: 'quantitative_aptitude', questions: 25, marks: 50, durationMinutes: 15 },
        { name: 'GA', subjectSlug: 'general_awareness', questions: 25, marks: 50, durationMinutes: 15 },
      ],
    });
    const [a] = planPresetSync({ presets: only(['chsl-t1']), exams: EXAMS, patterns: [locked] });
    expect(a.write).toBeDefined();
    expect((a.write as any).lockPreviousSections).toBeUndefined();
    const secs = readPatternSections(a.write!.sections);
    expect(secs.map((s) => s.durationMinutes)).toEqual([20, 10, 15, 15]); // admin timers, not the preset's 15/15/15/15
    expect(secs[0].scribeMinutes).toBe(25);
  });

  it('two active patterns for the same tier are all synced, with a duplicate warning', () => {
    const patterns = [
      existing({ id: 'a', examId: 'e-cgl', name: 'SSC CGL Tier 1 (2025)' }),
      existing({ id: 'b', examId: 'e-cgl', name: 'SSC CGL 2026 — Tier 1' }),
    ];
    const plan = planPresetSync({ presets: only(['cgl-t1']), exams: EXAMS, patterns });
    expect(plan.map((x) => x.patternId).sort()).toEqual(['a', 'b']);
    expect(plan.every((x) => x.warnings.some((w) => /deactivate the duplicates/.test(w)))).toBe(true);
  });

  it('Tier 1 and Tier 2 of the same exam do not get mixed up', () => {
    const patterns = [
      existing({ id: 't1', examId: 'e-cgl', name: 'SSC CGL 2026 — Tier 1' }),
      existing({ id: 't2', examId: 'e-cgl', name: 'SSC CGL 2026 — Tier 2 Paper I (Session I)', totalQuestions: 150, totalMarks: 450, durationMinutes: 135, negativeMarks: 1 }),
    ];
    const plan = planPresetSync({ presets: only(['cgl-t1', 'cgl-t2-p1', 'cgl-t2-p2']), exams: EXAMS, patterns });
    expect(plan.find((a) => a.presetKey === 'cgl-t1')!.patternId).toBe('t1');
    expect(plan.find((a) => a.presetKey === 'cgl-t2-p1')!.patternId).toBe('t2');
    expect(plan.find((a) => a.presetKey === 'cgl-t2-p2')!.kind).toBe('create'); // Statistics paper does not exist yet
  });

  it('an inactive pattern with the preset name is reported, not duplicated (unique name per exam)', () => {
    const patterns = [existing({ id: 'x', examId: 'e-cpo', name: 'SSC CPO SI Paper I', isActive: false })];
    const [a] = planPresetSync({ presets: only(['cpo-p1']), exams: EXAMS, patterns });
    expect(a.kind).toBe('skip');
    expect(a.warnings[0]).toMatch(/inactive pattern/);
  });

  it('warns when sections are locked but would be left without a timer', () => {
    const patterns = [existing({ id: 'c', examId: 'e-cgl', name: 'SSC CGL Tier 1', lockPreviousSections: true })];
    const [a] = planPresetSync({ presets: only(['cgl-t1']), exams: EXAMS, patterns });
    expect(a.warnings.some((w) => /no timer/.test(w))).toBe(true);
  });
});

describe('mergeSections', () => {
  it('matches by subject, keeps names / timers, takes questions / marks / penalties from the preset', () => {
    const merged = mergeSections(
      [{ name: 'My English', subjectSlug: 'english', questions: 10, marks: 10, durationMinutes: 12, scribeMinutes: 15 }],
      [
        { name: 'Maths', subjectSlug: 'quantitative_aptitude', questions: 20, marks: 60, negativeMarks: 0 },
        { name: 'English', subjectSlug: 'english', questions: 25, marks: 75, negativeMarks: 1 },
      ],
    );
    expect(merged[0]).toEqual({ name: 'Maths', subjectSlug: 'quantitative_aptitude', questions: 20, marks: 60, negativeMarks: 0 });
    expect(merged[1]).toEqual({ name: 'My English', subjectSlug: 'english', questions: 25, marks: 75, durationMinutes: 12, scribeMinutes: 15, negativeMarks: 1 });
  });
});
