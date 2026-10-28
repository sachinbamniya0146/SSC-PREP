/**
 * Pure helper functions for PYQ exam dates (manual entry + export).
 * No database, no network here — everything is deterministic so it can be unit-tested.
 */

export type Tier = 'TIER_1' | 'TIER_2';

const MONTHS_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// ---------------------------------------------------------------------------
// Tier (Tier 1 / Tier 2)
// ---------------------------------------------------------------------------

/** "Tier 1", "Tier-II", "TIER_2", "T-II", "2", "I" ... -> TIER_1 | TIER_2 (null when not recognisable). */
export function normalizeTier(raw: unknown): Tier | null {
  if (raw === null || raw === undefined) return null;
  const v = String(raw).trim().toLowerCase().replace(/[\s_\-.]+/g, '');
  if (!v) return null;
  if (['1', 'i', 'one', 'tier1', 'tieri', 'tierone', 't1', 'ti', 'paper1', 'paperi'].includes(v)) return 'TIER_1';
  if (['2', 'ii', 'two', 'tier2', 'tierii', 'tiertwo', 't2', 'tii', 'paper2', 'paperii'].includes(v)) return 'TIER_2';
  return null;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export function isValidIsoDate(s: unknown, minYear = 2010, now: number = Date.now()): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = +s.slice(0, 4);
  const m = +s.slice(5, 7);
  const d = +s.slice(8, 10);
  const maxYear = new Date().getUTCFullYear() + 1;
  if (y < minYear || y > maxYear) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (!(dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d)) return false;
  // A2: a PYQ was already held, so a date in the FUTURE is never real (a "scheduled exam" page or a typo). +1 day = IST tolerance.
  return dt.getTime() <= now + 86_400_000;
}

/** Accepts "2025-09-12", "12-09-2025", "12/09/2025", "12 Sep 2025", "September 12, 2025" -> "2025-09-12" (null if unreadable). */
export function toIsoDate(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v))) {
    const iso = `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v))) {
    const iso = `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  const monthIndex = (name: string) => MONTHS_ABBR.indexOf(name.slice(0, 3).toLowerCase());
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[\s,.-]+([A-Za-z]{3,9})\.?[\s,.-]+(\d{4})$/.exec(v))) {
    const mi = monthIndex(m[2]);
    if (mi >= 0) {
      const iso = `${m[3]}-${pad(mi + 1)}-${pad(+m[1])}`;
      return isValidIsoDate(iso) ? iso : null;
    }
  }
  if ((m = /^([A-Za-z]{3,9})\.?[\s,.-]+(\d{1,2})(?:st|nd|rd|th)?[\s,.-]+(\d{4})$/.exec(v))) {
    const mi = monthIndex(m[1]);
    if (mi >= 0) {
      const iso = `${m[3]}-${pad(mi + 1)}-${pad(+m[2])}`;
      return isValidIsoDate(iso) ? iso : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function stripHtml(s: string): string {
  return decodeEntities(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => {
      const c = Number(n);
      return c > 0 && c < 0x10ffff ? String.fromCodePoint(c) : ' ';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => {
      const c = parseInt(h, 16);
      return c > 0 && c < 0x10ffff ? String.fromCodePoint(c) : ' ';
    });
}

/** "Q.12) What is ..." -> "What is ..." and strips markup the editor may have left in the text. */
export function cleanQuestionText(s: string): string {
  return stripHtml(String(s ?? ''))
    .replace(/^\s*(?:q(?:uestion)?\.?\s*)?\d{1,3}\s*[.):\-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
