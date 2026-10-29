import { clearPaperFields, kindSummary, newKindTally, questionNoWarning, rowKind, tallyRow } from './row-kind';

describe('row kind (PYQ vs practice, per row)', () => {
  it('a year or an exam date makes a PYQ; neither makes practice', () => {
    expect(rowKind({ year: 2024 })).toBe('PYQ');
    expect(rowKind({ year: undefined, examDate: '2024-06-20' })).toBe('PYQ');
    expect(rowKind({})).toBe('PRACTICE');
    expect(rowKind({ year: null, examDate: null })).toBe('PRACTICE');
    expect(rowKind({ year: undefined, examDate: '' })).toBe('PRACTICE');
  });

  it('an unreadable year (NaN) is still a PYQ, so it fails loudly instead of becoming practice', () => {
    expect(rowKind({ year: Number.NaN })).toBe('PYQ');
  });

  it('clearPaperFields removes everything that identifies a paper', () => {
    const q = { year: 2024, shift: 'Shift 4', paperCode: 'X', examDate: '2024-06-20', examTier: 'TIER_1', tierPaper: 'PAPER_1', paperQuestionNo: 7 };
    clearPaperFields(q);
    expect(q).toEqual({ year: undefined, shift: undefined, paperCode: undefined, examDate: undefined, examTier: undefined, tierPaper: undefined, paperQuestionNo: undefined });
  });

  it('tally counts the kinds and the PYQ rows without a questionNo', () => {
    const t = newKindTally();
    tallyRow(t, 'PYQ', { paperQuestionNo: 3 });
    tallyRow(t, 'PYQ', {});
    tallyRow(t, 'PYQ', { paperQuestionNo: undefined });
    tallyRow(t, 'PRACTICE', {});
    expect(t).toEqual({ pyq: 3, practice: 1, pyqWithoutQuestionNo: 2 });
    expect(kindSummary(t)).toBe('PYQ: 3 · Practice: 1');
  });

  it('the questionNo warning is one line, only when needed, and never asks for a compilation serial', () => {
    expect(questionNoWarning(newKindTally())).toBeNull();
    const t = newKindTally();
    tallyRow(t, 'PYQ', {});
    const w = questionNoWarning(t)!;
    expect(w).toContain('1 PYQ row(s) have no questionNo');
    expect(w).toContain('upload order');
    expect(w).toContain('leave it blank');
  });
});
