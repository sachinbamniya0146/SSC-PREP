import { FREE_BOOKMARK_LIMIT, FREE_MOCKS_PER_PREMIUM_MOCK, PRACTICE_SET_QUESTIONS, chapterPdfPriceInr, freeDailyPracticeLimit } from './free-limits';
import { RANKABLE_USER, isRankableRole } from './rankable';

describe('free limits', () => {
  it('daily practice sets default to 5 and follow the env value, never below 1', () => {
    expect(freeDailyPracticeLimit({})).toBe(5);
    expect(freeDailyPracticeLimit({ FREE_DAILY_PRACTICE_LIMIT: '8' })).toBe(8);
    expect(freeDailyPracticeLimit({ FREE_DAILY_PRACTICE_LIMIT: '0' })).toBe(1);
    expect(freeDailyPracticeLimit({ FREE_DAILY_PRACTICE_LIMIT: 'abc' })).toBe(5);
  });

  it('chapter PDF price defaults to Rs 1, bad values fall back', () => {
    expect(chapterPdfPriceInr({})).toBe(1);
    expect(chapterPdfPriceInr({ CHAPTER_PDF_PRICE_INR: '3' })).toBe(3);
    expect(chapterPdfPriceInr({ CHAPTER_PDF_PRICE_INR: '-2' })).toBe(1);
  });

  it('the documented constants', () => {
    expect(FREE_BOOKMARK_LIMIT).toBe(100);
    expect(FREE_MOCKS_PER_PREMIUM_MOCK).toBe(2);
    expect(PRACTICE_SET_QUESTIONS).toBe(25);
  });
});

describe('who is ranked', () => {
  it('only plain students; admin and staff are not', () => {
    expect(isRankableRole('STUDENT')).toBe(true);
    expect(isRankableRole('ADMIN')).toBe(false);
    expect(isRankableRole('MODERATOR')).toBe(false);
    expect(isRankableRole(undefined)).toBe(false);
    expect(isRankableRole(null)).toBe(false);
  });
  it('the Prisma filter asks for active students', () => {
    expect(RANKABLE_USER.role).toBe('STUDENT');
    expect(RANKABLE_USER.isSuspended).toBe(false);
  });
});
