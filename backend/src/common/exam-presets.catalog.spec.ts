import { EXAM_PRESETS, classifyPatternName } from './exam-presets';

// S42: every preset (SSC and the other exams) must be internally consistent, so a sync can never write a broken pattern.
describe('marking presets: internal consistency', () => {
  for (const p of EXAM_PRESETS) {
    it(`${p.key}: sections add up, its own name classifies to its match, a source is named`, () => {
      expect(p.sections.reduce((a, s) => a + s.questions, 0)).toBe(p.totalQuestions);
      expect(Math.round(p.sections.reduce((a, s) => a + s.marks, 0) * 100) / 100).toBe(p.totalMarks);
      expect(classifyPatternName(p.name)).toEqual(p.match);
      expect(p.source.length).toBeGreaterThan(10);
      expect(p.negativeMarks).toBeGreaterThanOrEqual(0);
      expect(p.negativeMarks).toBeLessThan(p.totalMarks / p.totalQuestions + 0.0001);
      if (p.lockSections) {
        expect(p.sections.every((s) => (s.durationMinutes ?? 0) > 0)).toBe(true);
        expect(p.sections.reduce((a, s) => a + (s.durationMinutes ?? 0), 0)).toBe(p.durationMinutes);
      }
    });
  }

  it('no two presets of the same exam claim the same tier + paper', () => {
    const seen = new Set<string>();
    for (const p of EXAM_PRESETS) {
      const k = `${[...p.examSlugs].sort().join('|')}#${p.match.tier}#${p.match.paper}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it('stage words of other exams map to tiers', () => {
    expect(classifyPatternName('RRB NTPC CBT 2').tier).toBe('TIER_2');
    expect(classifyPatternName('IBPS PO Prelims').tier).toBe('TIER_1');
    expect(classifyPatternName('IBPS PO Mains').tier).toBe('TIER_2');
    expect(classifyPatternName('RBI Grade B Phase II').tier).toBe('TIER_2');
    expect(classifyPatternName('UPSC CDS Paper III (Elementary Mathematics)')).toEqual({ tier: null, paper: 'PAPER_3' });
    expect(classifyPatternName('SSC CGL Tier 2 Paper II (Statistics)')).toEqual({ tier: 'TIER_2', paper: 'PAPER_2' });
    expect(classifyPatternName('RPF Constable CBT').tier).toBeNull();
  });
});
