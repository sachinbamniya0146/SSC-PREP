/**
 * What a FREE student gets and what Premium adds - the numbers live HERE, once.
 *
 * Before (Oct 2026) the same numbers were typed into five services and three pages, and the pages drifted
 * ("3 practice sets for every chapter" was still shown after the rule became "5 practice sets per day").
 * Every service that enforces a limit now imports it from this file, and `GET /payments/benefits` sends the same
 * numbers to the Premium page, so what the page promises is what the server enforces.
 *
 * Pure file: no Nest, no Prisma, safe to import anywhere and to unit-test.
 */

/** Free students can keep this many bookmarks; Premium has no limit. */
export const FREE_BOOKMARK_LIMIT = 100;

/** A premium (non-PYQ) mock can be tried this many times for free before it needs Premium or a mock pack. */
export const FREE_MOCKS_PER_PREMIUM_MOCK = 2;

/** One practice set = this many questions (chapter / topic / sub-topic practice). */
export const PRACTICE_SET_QUESTIONS = 25;

/** Practice sets a free student may start per IST day (env FREE_DAILY_PRACTICE_LIMIT, default 5, never below 1). */
export function freeDailyPracticeLimit(env: Record<string, string | undefined> = process.env): number {
  const n = parseInt(env.FREE_DAILY_PRACTICE_LIMIT || '5', 10);
  return Math.max(1, Number.isFinite(n) ? n : 5);
}

/**
 * The price quoted in the "free limit reached" message (env PLAN_PRICE_INR, default 19; whole rupees, never below 1).
 * It is TEXT only: what a student is really charged comes from the Premium plans in the database, so keep this equal to the cheapest plan.
 */
export function planPriceInr(env: Record<string, string | undefined> = process.env): number {
  const n = Math.floor(Number(env.PLAN_PRICE_INR));
  return Number.isFinite(n) && n >= 1 ? n : 19;
}

/** Price of one chapter PDF for a free student (env CHAPTER_PDF_PRICE_INR, default 1). Premium includes every chapter PDF. */
export function chapterPdfPriceInr(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.CHAPTER_PDF_PRICE_INR);
  return n > 0 ? n : 1;
}

/** Smart mocks (built from the practice bank, one exam) a free student may take in total; Premium has no limit (env FREE_SMART_MOCKS, default 10, never below 1). */
export function freeSmartMocks(env: Record<string, string | undefined> = process.env): number {
  const n = parseInt(env.FREE_SMART_MOCKS || '10', 10);
  return Math.max(1, Number.isFinite(n) ? n : 10);
}

/** Custom tests (the student picks the topics) a free student may start per IST day; Premium has no limit (env FREE_CUSTOM_TESTS_PER_DAY, default 5, never below 1). */
export function freeCustomTestsPerDay(env: Record<string, string | undefined> = process.env): number {
  const n = parseInt(env.FREE_CUSTOM_TESTS_PER_DAY || '5', 10);
  return Math.max(1, Number.isFinite(n) ? n : 5);
}
