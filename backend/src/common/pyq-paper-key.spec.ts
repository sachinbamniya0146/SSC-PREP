import {
  normalizeExamTier, normalizeTierPaper, parsePaperQuestionNo, buildPaperKey, parsePaperKey,
  templateIdForPaper, titleForPaper, derivePaperCode, parsePaperCode, yearOfDate, monthKeyOfDate,
  isIsoDate, isKeyedTemplateId, effectiveTierPaper,
} from './pyq-paper-key';

describe('normalizeExamTier', () => {
  it.each(['TIER_1', 'tier 1', 'Tier-I', 'T-I', 'I', '1', 'tier1', ' Tier I ', 'T1'])('%s -> TIER_1', (v: string) => {
    expect(normalizeExamTier(v)).toEqual({ tier: 'TIER_1', invalid: false });
  });
  it.each(['TIER_2', 'tier 2', 'Tier-II', 'T-II', 'II', '2', 'tier2'])('%s -> TIER_2', (v: string) => {
    expect(normalizeExamTier(v)).toEqual({ tier: 'TIER_2', invalid: false });
  });
  it('blank is not invalid, junk is', () => {
    expect(normalizeExamTier('')).toEqual({ invalid: false });
    expect(normalizeExamTier(undefined)).toEqual({ invalid: false });
    expect(normalizeExamTier('tier 3')).toEqual({ invalid: true });
    expect(normalizeExamTier('mains')).toEqual({ invalid: true });
  });
});

describe('normalizeTierPaper', () => {
  it('reads paper variants', () => {
    expect(normalizeTierPaper('PAPER_2').paper).toBe('PAPER_2');
    expect(normalizeTierPaper('paper-III').paper).toBe('PAPER_3');
    expect(normalizeTierPaper('1').paper).toBe('PAPER_1');
    expect(normalizeTierPaper('').paper).toBeUndefined();
    expect(normalizeTierPaper('paper 9').invalid).toBe(true);
  });
  it('blank means PAPER_1 for identity', () => {
    expect(effectiveTierPaper(undefined)).toBe('PAPER_1');
    expect(effectiveTierPaper(null)).toBe('PAPER_1');
  });
});

describe('parsePaperQuestionNo', () => {
  it('accepts positive integers only', () => {
    expect(parsePaperQuestionNo('7')).toBe(7);
    expect(parsePaperQuestionNo(' 100 ')).toBe(100);
    expect(parsePaperQuestionNo('12.0')).toBe(12);
    expect(parsePaperQuestionNo('0')).toBeUndefined();
    expect(parsePaperQuestionNo('')).toBeUndefined();
    expect(parsePaperQuestionNo('Q7')).toBeUndefined();
  });
});

describe('buildPaperKey', () => {
  const base = { examId: 'exam-cgl', examTier: 'TIER_1', examDate: '2025-09-12', shift: 'Shift 2' };
  it('same five fields -> same key regardless of spelling', () => {
    const a = buildPaperKey(base);
    expect(a).toBe('exam-cgl|TIER_1|PAPER_1|2025-09-12|Shift 2');
    expect(buildPaperKey({ ...base, examTier: 'Tier-I', shift: 'afternoon' })).toBe(a);
    expect(buildPaperKey({ ...base, tierPaper: 'PAPER_1' })).toBe(a);
  });
  it('Tier 1 and Tier 2 never share a key', () => {
    expect(buildPaperKey(base)).not.toBe(buildPaperKey({ ...base, examTier: 'TIER_2' }));
  });
  it('different shift or date -> different key', () => {
    expect(buildPaperKey(base)).not.toBe(buildPaperKey({ ...base, shift: 'Shift 3' }));
    expect(buildPaperKey(base)).not.toBe(buildPaperKey({ ...base, examDate: '2025-09-13' }));
  });
  it('blank shift is allowed (Tier 2)', () => {
    expect(buildPaperKey({ examId: 'exam-cgl', examTier: 'TIER_2', examDate: '2025-01-18' })).toBe('exam-cgl|TIER_2|PAPER_1|2025-01-18|');
  });
  it('missing tier / date / exam -> null (row joins no mock)', () => {
    expect(buildPaperKey({ ...base, examTier: '' })).toBeNull();
    expect(buildPaperKey({ ...base, examTier: 'junk' })).toBeNull();
    expect(buildPaperKey({ ...base, examDate: '' })).toBeNull();
    expect(buildPaperKey({ ...base, examDate: '2025-02-30' })).toBeNull();
    expect(buildPaperKey({ ...base, examId: '' })).toBeNull();
  });
  it('round-trips through parsePaperKey', () => {
    expect(parsePaperKey(buildPaperKey(base)!)).toEqual({ examId: 'exam-cgl', examTier: 'TIER_1', tierPaper: 'PAPER_1', examDate: '2025-09-12', shift: 'Shift 2' });
    expect(parsePaperKey('x')).toBeNull();
  });
});

describe('template id + title', () => {
  const t1 = { examId: 'exam-cgl', examTier: 'TIER_1' as const, examDate: '2025-09-12', shift: 'Shift 2' };
  const t2 = { examId: 'exam-cgl', examTier: 'TIER_2' as const, examDate: '2025-01-18' };
  it('ids are stable, distinct per tier/paper/shift, and keep the pyq- prefix', () => {
    expect(templateIdForPaper(t1)).toBe('pyq-k-exam-cgl-t1-20250912-s2');
    expect(templateIdForPaper(t2)).toBe('pyq-k-exam-cgl-t2-20250118-na');
    expect(templateIdForPaper({ ...t2, tierPaper: 'PAPER_2' })).toBe('pyq-k-exam-cgl-t2-p2-20250118-na');
    expect(templateIdForPaper(t1).startsWith('pyq-')).toBe(true);
    expect(isKeyedTemplateId(templateIdForPaper(t1))).toBe(true);
    expect(isKeyedTemplateId('pyq-ssc-cgl-t-i-12-sep-2025-s2')).toBe(false);
  });
  it('titles', () => {
    expect(titleForPaper('SSC CGL', t1)).toBe('SSC CGL Tier 1 — 12 Sep 2025 · Shift 2');
    expect(titleForPaper('SSC CGL', t2)).toBe('SSC CGL Tier 2 · Paper 1 — 18 Jan 2025');
  });
});

describe('paperCode helpers', () => {
  it('derives the reference-workbook convention', () => {
    expect(derivePaperCode('ssc-cgl', 'TIER_1', '2025-09-12', 'Shift 2')).toBe('SSC-CGL-T-I-12-Sep-2025-S2');
    expect(derivePaperCode('SSC-CGL', 'TIER_2', '2025-01-18')).toBe('SSC-CGL-T-II-18-Jan-2025');
  });
  it('parses tier / date / shift out of a code', () => {
    expect(parsePaperCode('SSC-CGL-T-I-12-Sep-2025-S2')).toEqual({ examTier: 'TIER_1', examDate: '2025-09-12', shift: 'Shift 2' });
    expect(parsePaperCode('SSC-CGL-T-II-18-Jan-2025')).toEqual({ examTier: 'TIER_2', examDate: '2025-01-18' });
    expect(parsePaperCode('random')).toEqual({});
    expect(parsePaperCode(null)).toEqual({});
  });
  it('derive then parse round-trips', () => {
    const code = derivePaperCode('SSC-CGL', 'TIER_1', '2024-07-09', 'Shift 3');
    expect(parsePaperCode(code)).toEqual({ examTier: 'TIER_1', examDate: '2024-07-09', shift: 'Shift 3' });
  });
});

describe('date helpers', () => {
  it('year / month', () => {
    expect(yearOfDate('2025-09-12')).toBe(2025);
    expect(monthKeyOfDate('2025-09-12')).toBe('2025-09');
    expect(yearOfDate('bad')).toBeUndefined();
    expect(isIsoDate('2025-13-01')).toBe(false);
  });
});
