import { COMMON_EXAMS, planCommonExams } from './common-exams';

describe('common exams quick-add', () => {
  it('slugs, codes and names are unique, URL-safe and follow the exam- convention of the Master Package', () => {
    expect(new Set(COMMON_EXAMS.map((c) => c.slug)).size).toBe(COMMON_EXAMS.length);
    expect(new Set(COMMON_EXAMS.map((c) => c.code)).size).toBe(COMMON_EXAMS.length);
    expect(new Set(COMMON_EXAMS.map((c) => c.name.toLowerCase())).size).toBe(COMMON_EXAMS.length);
    expect(COMMON_EXAMS.every((c) => c.slug.startsWith('exam-') && /^[a-z0-9-]+$/.test(c.slug) && c.code === c.code.toUpperCase())).toBe(true);
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

  it('the exams of the Master Package Reference IDs are recognised, with or without the exam- prefix', () => {
    const existing = [
      { name: 'SSC GD Constable', slug: 'exam-gd', code: 'GD' },
      { name: 'Delhi Police Constable', slug: 'exam-dp', code: 'DP' },
      { name: 'Junior Engineer', slug: 'je', code: 'X1' },
      { name: 'Stenographer (C & D)', slug: 'steno', code: 'X2' },
    ];
    const plan = planCommonExams(existing);
    for (const slug of ['exam-gd', 'exam-dp', 'exam-je', 'exam-steno']) expect(plan.find((p) => p.slug === slug)!.status).toBe('EXISTS');
    expect(plan.filter((p) => p.status === 'NEW').map((p) => p.slug)).toEqual(['exam-selection-post', 'exam-rrb-ntpc', 'exam-rrb-group-d', 'exam-rrb-alp', 'exam-rrb-je']);
  });
});
