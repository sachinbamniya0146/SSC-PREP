import { buildPaperPreview } from './pyq-paper-preview';

describe('buildPaperPreview', () => {
  it('groups rows into one paper per exam+tier+paper+date+shift', () => {
    const r = buildPaperPreview([
      { row: 2, examId: 'cgl', examDate: '2025-09-12', shift: 'Shift 1', rawTier: 'Tier 1' },
      { row: 3, examId: 'cgl', examDate: '2025-09-12', shift: 'Shift 1', rawTier: 'TIER_1' },
      { row: 4, examId: 'cgl', examDate: '2025-09-12', shift: 'Shift 2', rawTier: 'TIER_1' },
      { row: 5, examId: 'cgl', examDate: '2025-09-12', shift: 'Shift 1', rawTier: 'TIER_2', rawPaper: 'Paper II' },
    ]);
    expect(r.papers).toHaveLength(3);
    expect(r.papers.find((p) => p.examTier === 'TIER_1' && p.shift === 'Shift 1')?.rows).toBe(2);
    expect(r.papers.find((p) => p.examTier === 'TIER_2')?.tierPaper).toBe('PAPER_2');
    expect(r.pendingTotal).toBe(0);
  });

  it('flags invalid tier text, date without tier, tier without date, invalid paper', () => {
    const r = buildPaperPreview([
      { row: 2, examId: 'cgl', examDate: '2025-09-12', rawTier: 'tier 9' },
      { row: 3, examId: 'cgl', examDate: '2025-09-12' },
      { row: 4, examId: 'cgl', rawTier: 'TIER_1' },
      { row: 5, examId: 'cgl', examDate: '2025-09-12', rawTier: 'TIER_2', rawPaper: 'zzz' },
      { row: 6, examId: 'cgl' },
    ]);
    expect(r.pending.map((p) => [p.row, p.reason])).toEqual([
      [2, 'INVALID_TIER'], [3, 'DATE_WITHOUT_TIER'], [4, 'TIER_WITHOUT_DATE'], [5, 'INVALID_PAPER'],
    ]);
    expect(r.papers).toHaveLength(1); // row 5 still builds (PAPER_1 fallback)
    expect(r.papers[0].tierPaper).toBe('PAPER_1');
  });

  it('plain practice rows (nothing set) produce no papers and no warnings', () => {
    const r = buildPaperPreview([{ row: 2, examId: 'cgl' }]);
    expect(r).toEqual({ papers: [], pending: [], pendingTotal: 0 });
  });
});
