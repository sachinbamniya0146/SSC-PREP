import { hasCanonicalPaper, paperQuestionIds, readPaperSnapshot } from './attempt-paper';

describe('attempt question list', () => {
  it('flattens a composed paper in paper order and drops repeats and empty ids', () => {
    const paper = { sections: [{ questions: [{ id: 'a' }, { id: 'b' }] }, { questions: [{ id: 'b' }, { id: '' }, { id: null }, { id: 'c' }] }, { questions: null }] };
    expect(paperQuestionIds(paper)).toEqual(['a', 'b', 'c']);
  });

  it('a missing or empty paper gives an empty list', () => {
    expect(paperQuestionIds(null)).toEqual([]);
    expect(paperQuestionIds({})).toEqual([]);
    expect(paperQuestionIds({ sections: [] })).toEqual([]);
  });

  it('reads a stored list; anything else means "no list stored"', () => {
    expect(readPaperSnapshot(['q1', 'q2', 'q1'])).toEqual(['q1', 'q2']);
    expect(readPaperSnapshot([])).toBeNull();
    expect(readPaperSnapshot(null)).toBeNull();
    expect(readPaperSnapshot({ ids: ['q1'] })).toBeNull();
    expect(readPaperSnapshot('q1')).toBeNull();
    expect(readPaperSnapshot([1, 2, null])).toBeNull();
  });

  it('only the auto-built PYQ papers have a canonical paper', () => {
    expect(hasCanonicalPaper({ id: 'pyq-cgl-2024-s1', type: 'SHIFT_WISE' })).toBe(true);
    expect(hasCanonicalPaper({ id: 'pyq-k-cgl-t1-20240909-s1', type: 'SHIFT_WISE' })).toBe(true);
    expect(hasCanonicalPaper({ id: 'tpl-cgl-pyq-2024', type: 'SHIFT_WISE' })).toBe(false);
    expect(hasCanonicalPaper({ id: 'pyq-x', type: 'FULL_MOCK' })).toBe(false);
    expect(hasCanonicalPaper(null)).toBe(false);
  });
});
