/**
 * Shift normalisation (Sachin, Oct 2026 — "admin shift dalta he to morning /
 * afternoon / evening ke according automatic Shift 1 / Shift 2 / Shift 3 me
 * change ho jaye").
 *
 * Problem: `Question.shift` and `TestTemplate.shift` are free-text. Admins type
 * "morning", "Shift-1", "1st shift", "9:00 AM", "dopahar", "S3" ... and every
 * spelling became its OWN bucket: the same real paper was split across several
 * mocks, and the year-wise shift picker listed duplicates.
 *
 * Rule (SSC convention):
 *   Shift 1  = morning   (subah)   ~ 8-11 AM
 *   Shift 2  = afternoon (dopahar) ~ 11:30 AM - 3 PM
 *   Shift 3  = evening   (shaam)   ~ 3:30 PM onwards
 *   Shift 4  = only when explicitly written as a number (some CHSL / MTS days)
 *
 * `normalizeShift()` is the ONE function every writer must use. It returns:
 *   - a canonical label ("Shift 1" | "Shift 2" | "Shift 3" | "Shift N") when it
 *     understands the input, or
 *   - null for blank input, or
 *   - the trimmed original text when it cannot be understood (never throws and
 *     never silently drops data — an admin can still see/fix an odd value).
 */

export const CANONICAL_SHIFT_PREFIX = 'Shift';

/** Canonical label for shift number n, e.g. 2 -> "Shift 2". */
export function shiftLabel(n: number): string {
  return `${CANONICAL_SHIFT_PREFIX} ${n}`;
}

/** true when `s` is exactly a canonical label ("Shift 1" ... "Shift 9"). */
export function isCanonicalShift(s: string | null | undefined): boolean {
  return typeof s === 'string' && /^Shift [1-9]$/.test(s);
}

// Words -> shift number. Matched on whole tokens (lower-cased, punctuation split).
const WORD_TO_SHIFT: Record<string, number> = {
  // English
  morning: 1, forenoon: 1, early: 1, first: 1, '1st': 1,
  afternoon: 2, noon: 2, midday: 2, second: 2, '2nd': 2,
  evening: 3, late: 3, third: 3, '3rd': 3, night: 3,
  fourth: 4, '4th': 4,
  // Hindi / Hinglish (romanised) + Devanagari
  subah: 1, savere: 1, suba: 1, pratah: 1, 'सुबह': 1, 'सवेरे': 1, 'प्रातः': 1, 'पहली': 1, 'पहला': 1, 'प्रथम': 1,
  dopahar: 2, dophar: 2, dupahar: 2, dopehar: 2, 'दोपहर': 2, 'दूसरी': 2, 'दूसरा': 2, 'द्वितीय': 2,
  shaam: 3, sham: 3, shyam: 3, sandhya: 3, raat: 3, 'शाम': 3, 'संध्या': 3, 'तीसरी': 3, 'तीसरा': 3, 'तृतीय': 3,
  // Roman numerals
  i: 1, ii: 2, iii: 3, iv: 4,
};

/** Maps a clock time (24h hour + minute) to a shift number. */
export function shiftFromClock(hour24: number, minute = 0): number {
  const t = hour24 * 60 + minute;
  if (t < 11 * 60 + 15) return 1; // up to 11:14 -> morning
  if (t < 15 * 60 + 15) return 2; // 11:15 - 15:14 -> afternoon
  return 3; // 15:15 onwards -> evening
}

/** Parses "9", "9:30", "930", "09.30" + optional am/pm into 24h hour & minute. */
function parseClock(raw: string): { h: number; m: number } | null {
  const re = /(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?|baje)?/i;
  const m = re.exec(raw);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const mer = (m[3] || '').toLowerCase().replace(/\./g, '');
  if (h > 24 || min > 59) return null;
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  // No am/pm given: SSC exams never start before 8 or after 6 — treat 1..7 as pm.
  if (!mer && h >= 1 && h <= 7) h += 12;
  if (h === 24) h = 0;
  return { h, m: min };
}

/**
 * Normalises any admin-typed shift text into "Shift N".
 *
 *   "morning" | "Morning shift" | "subah" | "9:00 AM" | "Shift-1" | "1" | "S1"
 *   | "shift 1" | "1st shift" | "first" | "I"                      -> "Shift 1"
 *   "afternoon" | "dopahar" | "12:30 PM" | "Shift 2" | "2nd"       -> "Shift 2"
 *   "evening" | "shaam" | "4 PM" | "Shift 3" | "third"             -> "Shift 3"
 *   "Shift 4"                                                      -> "Shift 4"
 *   ""  / null / undefined                                         -> null
 *   "Day 2 Batch B" (not understood)                               -> "Day 2 Batch B" (kept)
 */
export function normalizeShift(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const original = String(raw).trim();
  if (!original) return null;

  const lower = original.toLowerCase();

  // 1) Already canonical-ish: "shift 1", "shift-2", "shift_3", "shift#1", "s1", "sh2", "shift no. 3"
  const explicit = /^(?:shift|sh|s)\s*(?:no\.?|number|#|-|_|:)?\s*([1-9])\b/.exec(lower);
  if (explicit) return shiftLabel(Number(explicit[1]));

  // 2) "1st shift", "2nd shift", "3 shift", "shift number two"
  const ordinal = /^([1-9])\s*(?:st|nd|rd|th)?\s*(?:shift|sh)?$/.exec(lower);
  if (ordinal) return shiftLabel(Number(ordinal[1]));

  // 3) Words anywhere ("Morning Shift", "shift - evening", "pehli shift subah")
  const tokens = lower.split(/[^a-z0-9\u0900-\u097f]+/).filter(Boolean);

  // Explicit number inside a longer phrase wins over words ("shift 2 afternoon").
  const numInPhrase = /(?:shift|sh)\s*(?:no\.?|number|#|-|_|:)?\s*([1-9])\b/.exec(lower);
  if (numInPhrase) return shiftLabel(Number(numInPhrase[1]));

  for (const tok of tokens) {
    if (tok === 'shift' || tok === 'sh' || tok === 'paper' || tok === 'batch') continue;
    if (!Object.prototype.hasOwnProperty.call(WORD_TO_SHIFT, tok)) continue;
    return shiftLabel(WORD_TO_SHIFT[tok]);
  }

  // 4) A clock time, e.g. "9:00 AM", "12.30 pm", "4pm", "9 baje", "9:00 AM - 10:00 AM"
  if (/\d/.test(lower) && /(?:[:.]\d{2}|am|pm|a\.m|p\.m|baje)/.test(lower)) {
    const first = parseClock(lower);
    if (first) return shiftLabel(shiftFromClock(first.h, first.m));
  }

  // 5) Unknown text: keep exactly what the admin typed so nothing is lost.
  return original.slice(0, 60);
}

/**
 * Same as normalizeShift but returns `undefined` for blank input — handy for
 * DTO-style optional fields (`shift?: string`).
 */
export function normalizeShiftOrUndefined(raw: unknown): string | undefined {
  return normalizeShift(raw) ?? undefined;
}

/** Sort key so lists show Shift 1, Shift 2, Shift 3 ... then anything else. */
export function shiftSortKey(s: string | null | undefined): number {
  const m = /^Shift ([1-9])$/.exec(s ?? '');
  return m ? Number(m[1]) : 99;
}

/** Friendly UI hint: "Shift 1 (Morning)". Display-only, never stored. */
export function shiftDisplayName(s: string | null | undefined): string {
  switch (s) {
    case 'Shift 1': return 'Shift 1 (Morning)';
    case 'Shift 2': return 'Shift 2 (Afternoon)';
    case 'Shift 3': return 'Shift 3 (Evening)';
    default: return s ?? '';
  }
}
