import { PRACTICE_COLUMNS, buildDataValidationsXml, buildUpdateBody, columnLetter, diffUpdate, headerLabel, injectSheetXml, isQuestionId } from './bank-template';

describe('practice template metadata', () => {
  it('columns: unique keys, required ones starred, id first', () => {
    const keys = PRACTICE_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe('id');
    expect(headerLabel(PRACTICE_COLUMNS.find((c) => c.key === 'examId')!)).toBe('examId*');
    expect(headerLabel(PRACTICE_COLUMNS.find((c) => c.key === 'topicId')!)).toBe('topicId');
  });
  it('every column the parser requires is in the template', () => {
    for (const k of ['examId', 'subjectId', 'chapterId', 'questionText', 'optionA', 'optionB', 'optionC', 'optionD', 'correctAnswer']) expect(PRACTICE_COLUMNS.some((c) => c.key === k && c.required)).toBe(true);
  });
  it('columnLetter', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
});

describe('sheet xml injection', () => {
  const xml = '<worksheet><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData/><pageMargins left="1"/></worksheet>';
  it('goes before ignoredErrors / legacyDrawing too (comments sheets)', () => {
    const x2 = '<worksheet><sheetData/><ignoredErrors><x/></ignoredErrors><legacyDrawing r:id="r1"/></worksheet>';
    const out = injectSheetXml(x2, '<dataValidations count="0"/>', false);
    expect(out.indexOf('<dataValidations')).toBeLessThan(out.indexOf('<ignoredErrors'));
  });
  it('adds validations before pageMargins + freezes the header', () => {
    const v = buildDataValidationsXml([{ col: 16, formula: '"A,B,C,D"', title: 'Answer', message: 'A/B/C/D', strict: true }]);
    expect(v).toContain('sqref="Q2:Q5000"');
    const out = injectSheetXml(xml, v);
    expect(out.indexOf('<dataValidations')).toBeLessThan(out.indexOf('<pageMargins'));
    expect(out).toContain('state="frozen"');
    expect(out).toContain('<formula1>&quot;A,B,C,D&quot;</formula1>'); // parses back to "A,B,C,D" 
  });
});

describe('edit by ID', () => {
  const hm: Record<string, number> = { id: 0, questionText: 1, optionA: 2, optionB: 3, optionC: 4, optionD: 5, correctAnswer: 6, explanation: 7, difficulty: 8, marks: 9, year: 10 };
  const existingOpts = [{ key: 'A', text: '1', textHi: 'एक' }, { key: 'B', text: '2' }, { key: 'C', text: '3' }, { key: 'D', text: '4' }];
  it('isQuestionId', () => {
    expect(isQuestionId('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
    expect(isQuestionId('abc')).toBe(false);
  });
  it('blank cells never overwrite; options merge with existing', () => {
    const { body, problems } = buildUpdateBody(hm, ['id', 'New text', '', '22', '', '', '', '', '', '', ''], existingOpts, true);
    expect(problems).toEqual([]);
    expect(body.questionText).toBe('New text');
    expect(body.explanation).toBeUndefined();
    expect(body.options).toEqual([{ key: 'A', text: '1', textHi: 'एक' }, { key: 'B', text: '22', textHi: '' }, { key: 'C', text: '3', textHi: '' }, { key: 'D', text: '4', textHi: '' }]);
  });
  it('bad values are reported; practice ignores year', () => {
    const { body, problems } = buildUpdateBody(hm, ['id', '', '', '', '', '', 'Z', '', 'IMPOSSIBLE', 'x', '2024'], existingOpts, true);
    expect(problems).toHaveLength(3);
    expect(body.year).toBeUndefined();
    expect(buildUpdateBody(hm, ['id', '', '', '', '', '', '', '', '', '', '2024'], existingOpts, false).body.year).toBe('2024');
  });
  it('diffUpdate lists only real changes', () => {
    const existing = { questionText: 'Q', correctAnswer: 'B', marks: 1, optionsJson: existingOpts, explanation: null };
    expect(diffUpdate(existing, { questionText: 'Q', correctAnswer: 'B', marks: 1 })).toEqual([]);
    expect(diffUpdate(existing, { questionText: 'Q2', correctAnswer: 'C', marks: 2, explanation: 'x' }).sort()).toEqual(['correctAnswer', 'explanation', 'marks', 'questionText']);
    expect(diffUpdate(existing, { options: [{ key: 'A', text: '1', textHi: 'एक' }, { key: 'B', text: '9', textHi: '' }] })).toEqual(['optionB']);
  });
});

describe('buildUpdateBody — date-wise PYQ columns (26 Oct 2026)', () => {
  const hm = { examTier: 0, tierPaper: 1, questionNo: 2 };
  it('reads tier / paper / questionNo and normalises them', () => {
    const r = buildUpdateBody(hm, ['Tier 2', 'Paper II', '17'], [], false);
    expect(r.problems).toEqual([]);
    expect(r.body).toMatchObject({ examTier: 'TIER_2', tierPaper: 'PAPER_2', paperQuestionNo: 17 });
  });
  it('reports unreadable values and ignores them for practice-only', () => {
    expect(buildUpdateBody(hm, ['tier 9', '', 'x'], [], false).problems).toHaveLength(2);
    expect(buildUpdateBody(hm, ['TIER_1', '', '3'], [], true).body).toEqual({});
  });
});
