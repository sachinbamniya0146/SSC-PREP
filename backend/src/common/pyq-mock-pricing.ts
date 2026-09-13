/**
 * NEW ("free honge bus top 10 rhenge bs baki paid") — single source of
 * truth for which auto-created PYQ mocks (BankUploadService
 * .upsertPyqMockForPaper(), id prefix `pyq-`) are free vs paid.
 *
 * This logic used to live only in MocksService.listAvailableMocks() (the
 * /mocks list screen), but TestsService.assertMockEntitled() — the ACTUAL
 * gate that decides whether POST /tests/attempts/start is allowed to
 * proceed — only ever checked `template.isPremium`. Auto-created PYQ mocks
 * are always created with isPremium: false (pricing is rank-based, not a
 * fixed flag on the row), so without this shared helper every PYQ mock
 * beyond the free top 10 would show "🔒 Locked · Paid" on the list screen
 * while being START-ABLE for free by calling the API directly — a real
 * paywall bypass, not just a cosmetic gap.
 *
 * Both MocksService and TestsService import these PURE functions directly
 * (no DI/module wiring needed, avoiding the exact cross-module
 * forwardRef() landmine documented in tests.module.ts) so the display and
 * the enforcement can never drift out of sync again.
 */

export const FREE_PYQ_MOCK_COUNT = 10;
export const PYQ_MOCK_PRICE_INR = 10;
export const PYQ_MOCK_OFFER_DAYS = 15;

export function isPyqAutoMockId(templateId: string): boolean {
  return templateId.startsWith('pyq-');
}

/**
 * Pulls a real calendar date out of an auto-generated PYQ mock's title so
 * callers can rank "most recent paper first". BankUploadService
 * .upsertPyqMockForPaper() always builds the title as
 * `${examName} — ${paperCode}`, and every upload template in this codebase
 * uses the "EXAM-TIER-DD-Mon-YYYY-Sx" paperCode convention (e.g.
 * "SSC-CGL-T-I-12-Sep-2025-S1"). Matches that DD-Mon-YYYY fragment
 * case-insensitively; returns null (never throws, never guesses "today")
 * for anything that doesn't match, so a differently-formatted paperCode
 * just falls back to createdAt-desc ordering at the call site instead of
 * corrupting the ranking with a wrong date.
 */
export function extractDateFromPaperTitle(title: string): Date | null {
  const match = title.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!match) return null;
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const month = months[match[2].toLowerCase()];
  if (month === undefined) return null;
  const day = Number(match[1]);
  const year = Number(match[3]);
  const date = new Date(year, month, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Ranks a set of PYQ templates newest-paper-first (rank 0 = newest).
 * `templates` only needs id/title/createdAt — callers pass whatever shape
 * their own Prisma select already produced.
 */
export function rankPyqTemplatesNewestFirst<T extends { id: string; title: string; createdAt: Date }>(
  templates: T[],
): Map<string, number> {
  const withDate = templates.map((t) => ({ t, date: extractDateFromPaperTitle(t.title) }));
  withDate.sort((a, b) => {
    if (a.date && b.date) return b.date.getTime() - a.date.getTime();
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    // Both undated — preserve incoming order (callers already pass
    // createdAt-desc-ordered arrays), which Array.sort's stability
    // guarantees for equal comparator results.
    return 0;
  });
  const rank = new Map<string, number>();
  withDate.forEach(({ t }, idx) => rank.set(t.id, idx));
  return rank;
}

/** True if this specific PYQ template is inside the free top-N window. */
export function isPyqMockFreeByRank(rank: number | undefined): boolean {
  return (rank ?? Number.MAX_SAFE_INTEGER) < FREE_PYQ_MOCK_COUNT;
}
