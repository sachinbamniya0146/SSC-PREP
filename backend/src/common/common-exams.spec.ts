import { COMMON_EXAMS, EXAM_CATEGORY_LABEL, examCategoryOf, planCommonExams } from './common-exams';
import { EXAM_PRESETS } from './exam-presets';

describe('exam catalog quick-add', () => {
  it('slugs, codes and names are unique, URL-safe and follow the exam- convention of the Master Package', () => {
    expect(new Set(COMMON_EXAMS.map((c) => c.slug)).size).toBe(COMMON_EXAMS.length);
    expect(new Set(COMMON_EXAMS.map((c) => c.code)).size).toBe(COMMON_EXAMS.length);
    expect(new Set(COMMON_EXAMS.map((c) => c.name.toLowerCase())).size).toBe(COMMON_EXAMS.length);
    expect(COMMON_EXAMS.every((c) => c.slug.startsWith('exam-') && /^[a-z0-9-]+$/.test(c.slug) && c.code === c.code.toUpperCase())).toBe(true);
    expect(COMMON_EXAMS.every((c) => !!EXAM_CATEGORY_LABEL[c.category])).toBe(true);
  });

  it('covers SSC, Railway, Banking, Insurance, Defence and State Police', () => {
    const cats = new Set(COMMON_EXAMS.map((c) => c.category));
    expect([...cats].sort()).toEqual(['BANKING', 'DEFENCE', 'INSURANCE', 'RAILWAY', 'SSC', 'STATE_POLICE']);
  });

  it('never plans an exam that already exists by slug, code or name', () => {
    const plan = planCommonExams([
      { name: 'SSC Selection Post', slug: 'exam-selection-post', code: 'SELPOST' },
      { name: 'Railway NTPC', slug: 'exam-ntpc-old', code: 'rrbntpc' }, // same code, other slug
      { name: 'rrb group d', slug: 'x', code: 'Y' }, // same name
    ]);
    const st = (slug: string) => plan.find((p) => p.slug === slug)!;
    expect(st('exam-selection-post').status).toBe('EXISTS');
    expect(st('exam-rrb-ntpc')).toMatchObject({ status: 'EXISTS', existingSlug: 'exam-ntpc-old' });
    expect(st('exam-rrb-group-d').status).toBe('EXISTS');
    expect(st('exam-rrb-alp').status).toBe('NEW');
  });

  it('the app seeds (cgl, chsl, mts, cpo) and the Master Package IDs are recognised, with or without the exam- prefix', () => {
    const existing = [
      { name: 'SSC CGL', slug: 'cgl', code: 'CGL' },
      { name: 'Combined Higher Secondary', slug: 'chsl', code: 'X0' },
      { name: 'SSC GD Constable', slug: 'exam-gd', code: 'GD' },
      { name: 'Delhi Police Constable', slug: 'exam-dp', code: 'DP' },
      { name: 'Junior Engineer', slug: 'je', code: 'X1' },
      { name: 'Stenographer (C & D)', slug: 'steno', code: 'X2' },
    ];
    const plan = planCommonExams(existing);
    for (const slug of ['exam-cgl', 'exam-chsl', 'exam-gd', 'exam-dp', 'exam-je', 'exam-steno']) expect(plan.find((p) => p.slug === slug)!.status).toBe('EXISTS');
    expect(plan.find((p) => p.slug === 'exam-mts')!.status).toBe('NEW');
    // "Delhi Police Head Constable" is not mistaken for "Delhi Police Constable"
    expect(plan.find((p) => p.slug === 'exam-dp-hc')!.status).toBe('NEW');
  });

  it('every marking preset points at an exam of the catalog (so "Add exams" + "Sync presets" always meet)', () => {
    for (const p of EXAM_PRESETS) {
      const hit = p.examSlugs.some((s) => examCategoryOf({ name: '', code: '', slug: s }) !== null);
      expect(`${p.key}:${hit}`).toBe(`${p.key}:true`);
    }
  });

  it('category of an existing exam row', () => {
    expect(examCategoryOf({ name: 'SSC CGL', slug: 'cgl', code: 'CGL' })).toBe('SSC');
    expect(examCategoryOf({ name: 'whatever', slug: 'exam-sbi-po', code: 'Q' })).toBe('BANKING');
    expect(examCategoryOf({ name: 'Some coaching test', slug: 'local-test', code: 'LT' })).toBeNull();
  });
});
