import { assignSetNumbers, mockGroupKey, studentMockTitle, withoutExamDate } from './pyq-mock-title';

const d = (s: string) => new Date(s);

describe('student-facing name of a real-paper mock', () => {
  it('year + tier + shift + set, and never a date', () => {
    expect(studentMockTitle('SSC CGL', { examTier: 'TIER_1', tierPaper: 'PAPER_1', year: 2025, shift: 'Shift 2' }, 3)).toBe('SSC CGL 2025 · Tier 1 · Shift 2 · Set 3');
  });

  it('Tier 2 always says the paper; a tier-less old paper has neither', () => {
    expect(studentMockTitle('SSC CGL', { examTier: 'TIER_2', tierPaper: null, year: 2024, shift: null }, 1)).toBe('SSC CGL 2024 · Tier 2 · Paper 1 · Set 1');
    expect(studentMockTitle('SSC CGL', { examTier: 'TIER_2', tierPaper: 'PAPER_2', year: 2024, shift: null }, 2)).toBe('SSC CGL 2024 · Tier 2 · Paper 2 · Set 2');
    expect(studentMockTitle('RRB NTPC', { examTier: null, year: 2021, shift: 'morning' }, 1)).toBe('RRB NTPC 2021 · Shift 1 · Set 1');
  });

  it('a bad set number becomes Set 1', () => {
    expect(studentMockTitle('X', { year: 2020 }, 0)).toBe('X 2020 · Set 1');
    expect(studentMockTitle('X', { year: 2020 }, Number.NaN)).toBe('X 2020 · Set 1');
  });
});

describe('Set numbers', () => {
  const m = (id: string, createdAt: string, extra: object = {}) => ({ id, examId: 'e1', examTier: 'TIER_1', tierPaper: 'PAPER_1', year: 2025, shift: 'Shift 1', createdAt: d(createdAt), ...extra });

  it('count up inside one group, oldest created first', () => {
    const r = assignSetNumbers([m('b', '2026-02-01'), m('a', '2026-01-01'), m('c', '2026-03-01')]);
    expect([r.get('a'), r.get('b'), r.get('c')]).toEqual([1, 2, 3]);
  });

  it('another shift / tier / year / exam starts again at Set 1', () => {
    const r = assignSetNumbers([m('a', '2026-01-01'), m('b', '2026-01-02', { shift: 'Shift 2' }), m('c', '2026-01-03', { examTier: 'TIER_2', tierPaper: 'PAPER_1' }), m('d', '2026-01-04', { year: 2024 }), m('e', '2026-01-05', { examId: 'e2' })]);
    expect(['a', 'b', 'c', 'd', 'e'].map((k) => r.get(k))).toEqual([1, 1, 1, 1, 1]);
  });

  it('a mock created LATER never renames an older one (set numbers follow creation, not exam date)', () => {
    const before = assignSetNumbers([m('old', '2026-01-01')]);
    const after = assignSetNumbers([m('old', '2026-01-01'), m('newer-but-earlier-exam', '2026-05-01')]);
    expect(before.get('old')).toBe(1);
    expect(after.get('old')).toBe(1);
    expect(after.get('newer-but-earlier-exam')).toBe(2);
  });

  it('shift spelling does not split a group', () => {
    expect(mockGroupKey('e1', { year: 2025, shift: 'morning', examTier: 'TIER_1' })).toBe(mockGroupKey('e1', { year: 2025, shift: 'Shift 1', examTier: 'TIER_1' }));
  });
});

describe('withoutExamDate', () => {
  it('drops the exam date from a copy and leaves the original alone', () => {
    const row = { id: 'pyq-k-a', title: 'SSC CGL 2025 · Tier 1 · Shift 1 · Set 1', examDate: '2025-09-12', year: 2025 };
    const safe = withoutExamDate(row);
    expect('examDate' in safe).toBe(false);
    expect(safe.title).toBe(row.title);
    expect(row.examDate).toBe('2025-09-12');
  });
});
