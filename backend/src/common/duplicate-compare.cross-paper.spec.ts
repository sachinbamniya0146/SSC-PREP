import { PAPER_IDENTITY_FIELDS, isCrossPaperRepeat } from './duplicate-compare';

describe('isCrossPaperRepeat: same question in a different paper', () => {
  it('shift / date / tier / year / exam / tier paper / paper code differences are cross-paper', () => {
    for (const f of PAPER_IDENTITY_FIELDS) expect(isCrossPaperRepeat([f])).toBe(true);
    expect(isCrossPaperRepeat(['explanation', 'shift'])).toBe(true);
  });
  it('a different solution, Hindi text or question number alone is NOT a different paper', () => {
    expect(isCrossPaperRepeat(['explanation'])).toBe(false);
    expect(isCrossPaperRepeat(['questionTextHindi', 'paperQuestionNo'])).toBe(false);
  });
  it('exact copies (no differences) and empty input are not cross-paper', () => {
    expect(isCrossPaperRepeat([])).toBe(false);
    expect(isCrossPaperRepeat(null)).toBe(false);
    expect(isCrossPaperRepeat(undefined)).toBe(false);
  });
});
