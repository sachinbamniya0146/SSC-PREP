import { buildExamAliasMap, examAliasKey, groupUnknownExams, resolveExamRef, unknownExamMessage } from './exam-ref';

const EXAMS = [
  { id: 'id-cgl', slug: 'exam-cgl', name: 'SSC CGL', code: 'CGL' },
  { id: 'id-mts', slug: 'exam-mts', name: 'SSC MTS', code: 'MTS' },
  { id: 'id-sp', slug: 'exam-selection-post', name: 'SSC Selection Post', code: 'SELPOST' },
];

describe('exam reference lookup', () => {
  it('alias key ignores case, spaces and underscores', () => {
    expect(examAliasKey(' SSC  CGL ')).toBe('ssc-cgl');
    expect(examAliasKey('ssc_cgl')).toBe('ssc-cgl');
    expect(examAliasKey(null)).toBe('');
  });

  it('finds an exam by exact slug, id, code or name', () => {
    expect(resolveExamRef('exam-cgl', EXAMS)).toBe('id-cgl');
    expect(resolveExamRef('id-mts', EXAMS)).toBe('id-mts');
    expect(resolveExamRef('CGL', EXAMS)).toBe('id-cgl');
    expect(resolveExamRef('SSC Selection Post', EXAMS)).toBe('id-sp');
    expect(resolveExamRef('Exam-CGL', EXAMS)).toBe('id-cgl');
  });

  it('blank or unknown values stay unknown (the importer never invents an exam)', () => {
    expect(resolveExamRef('', EXAMS)).toBeUndefined();
    expect(resolveExamRef(undefined, EXAMS)).toBeUndefined();
    expect(resolveExamRef('exam-rrb-ntpc', EXAMS)).toBeUndefined();
  });

  it('a slug is never shadowed by another exam name', () => {
    const exams = [
      { id: 'a', slug: 'exam-x', name: 'Other', code: 'X' },
      { id: 'b', slug: 'other', name: 'Exam X', code: 'Y' },
    ];
    const m = buildExamAliasMap(exams);
    expect(m.get('exam-x')).toBe('a');
    expect(m.get('other')).toBe('b');
  });

  it('groups the unknown exams once per value (Percentage sheet: 37 blank + Selection Post)', () => {
    const rows: { row: number; examId: unknown }[] = [];
    for (let i = 2; i < 39; i++) rows.push({ row: i, examId: '' });
    for (let i = 39; i < 50; i++) rows.push({ row: i, examId: 'exam-cgl' });
    for (let i = 50; i < 53; i++) rows.push({ row: i, examId: 'exam-rrb-ntpc' });
    const g = groupUnknownExams(rows, EXAMS);
    expect(g.map((x) => [x.value, x.count])).toEqual([['', 37], ['exam-rrb-ntpc', 3]]);
    expect(g[0].rows[0]).toBe(2);
  });

  it('"exam-cgl" finds an exam stored as slug "cgl" and vice versa (but never shadows a real slug)', () => {
    const exams = [{ id: 'a', slug: 'cgl', name: 'SSC CGL', code: 'CGL' }, { id: 'b', slug: 'exam-mts', name: 'SSC MTS', code: 'MTS' }];
    expect(resolveExamRef('exam-cgl', exams)).toBe('a');
    expect(resolveExamRef('mts', exams)).toBe('b');
    const clash = [{ id: 'a', slug: 'cgl', name: 'X', code: 'X1' }, { id: 'b', slug: 'exam-cgl', name: 'Y', code: 'Y1' }];
    expect(resolveExamRef('exam-cgl', clash)).toBe('b');
    expect(resolveExamRef('cgl', clash)).toBe('a');
  });

  it('the message says where to create the exam and which slugs are valid', () => {
    const m = unknownExamMessage('exam-rrb-ntpc', ['exam-cgl', 'exam-mts']);
    expect(m).toContain('/admin/exams');
    expect(m).toContain('exam-cgl, exam-mts');
    expect(unknownExamMessage('', ['exam-cgl'])).toContain('examId is empty');
  });
});
