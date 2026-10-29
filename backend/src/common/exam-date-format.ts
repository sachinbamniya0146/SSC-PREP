// ONE exam-date format for everything an admin types or uploads: DD/MM/YYYY (30 Oct 2026, Sachin: "sirf ek hee format,
// dd/mm/yyyy, mandatory"). Pure helpers - no Nest / Prisma imports - so the rule can be unit-tested on its own.
//
// Why only one: "05/06/2025" is 5 June in India and 6 May in the US. If a file may use several formats the server has to
// guess, and a wrong guess saves a real paper under the wrong date without any error. So the server never guesses: a date
// is accepted only as DD/MM/YYYY (2-digit day, 2-digit month, 4-digit year, "/" between), and anything else fails the row
// with a message that says exactly what to write instead.
//
// Inside the database the date is still stored as YYYY-MM-DD (sorts correctly, used in paper keys). Only the INPUT
// (Excel / CSV / JSON / Word rows, bulk-update sheets, the manual date box) and the OUTPUT files (exports that are meant to be
// uploaded again) use DD/MM/YYYY. That keeps stored data and paper keys stable.

export const EXAM_DATE_FORMAT = 'DD/MM/YYYY';
export const EXAM_DATE_EXAMPLE = '12/09/2025';

const DMY = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (n: number) => String(n).padStart(2, '0');

function realDate(y: number, m: number, d: number): boolean {
  if (y < MIN_YEAR || y > MAX_YEAR || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "2025-09-12" -> "12/09/2025" (anything that is not a stored ISO date comes back as ""). */
export function isoToDmy(iso: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '').trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** "12/09/2025" -> "2025-09-12", or null when it is not a real DD/MM/YYYY date. No other format is understood. */
export function dmyToIso(raw: unknown): string | null {
  const m = DMY.exec(String(raw ?? '').trim());
  if (!m) return null;
  const d = +m[1];
  const mo = +m[2];
  const y = +m[3];
  return realDate(y, mo, d) ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * When the wrong text is still an unambiguous date, tell the admin exactly what to write instead.
 * "2025-09-12" (year first) and "12-09-2025" / "12.09.2025" (day first, other separator) can only mean one date;
 * "12 Sep 2025" names the month. A single-digit day/month ("5/6/2025") is NOT converted - it is ambiguous to a reader.
 */
function suggestionFor(v: string): string | null {
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v)) && realDate(+m[1], +m[2], +m[3])) return `${pad(+m[3])}/${pad(+m[2])}/${m[1]}`;
  if ((m = /^(\d{2})[-.](\d{2})[-.](\d{4})$/.exec(v)) && realDate(+m[3], +m[2], +m[1])) return `${m[1]}/${m[2]}/${m[3]}`;
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[\s,.-]+([A-Za-z]{3,9})\.?[\s,.-]+(\d{4})$/.exec(v))) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0 && realDate(+m[3], mi + 1, +m[1])) return `${pad(+m[1])}/${pad(mi + 1)}/${m[3]}`;
  }
  return null;
}

/**
 * THE rule. Blank -> undefined (the column is optional: a practice row has no date). A valid DD/MM/YYYY -> "YYYY-MM-DD".
 * Anything else throws an Error whose message is shown to the admin as it is.
 * `now` is only for tests. A date after tomorrow (IST tolerance) is refused: a PYQ is a paper that was already held.
 */
export function parseExamDate(raw: unknown, now: number = Date.now()): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (raw instanceof Date) {
    throw new Error(`Invalid examDate: the cell holds a date VALUE, not text. Format the examDate column as Text and type the date as ${EXAM_DATE_FORMAT} (e.g. ${EXAM_DATE_EXAMPLE}).`);
  }
  const v = String(raw).trim();
  if (!v) return undefined;

  const iso = dmyToIso(v);
  if (iso) {
    const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
    if (t > now + 86_400_000) throw new Error(`Invalid examDate "${v}": this date is in the future - a PYQ paper has already been held. Check the day, month and year.`);
    return iso;
  }

  // A number such as 45912 is how Excel stores a real date cell. It is refused on purpose: Excel decides day/month order from
  // the computer's language, so the same typed "12/09/2025" can silently become 9 December on another PC.
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    throw new Error(`Invalid examDate "${v}": the cell holds an Excel date VALUE. Select the examDate column -> Format Cells -> Text, then type the date as ${EXAM_DATE_FORMAT} (e.g. ${EXAM_DATE_EXAMPLE}).`);
  }
  const hint = suggestionFor(v);
  const calendarProblem = DMY.test(v) ? ' That day does not exist in the calendar (or the year is outside 2000-2100).' : '';
  throw new Error(
    `Invalid examDate "${v}": write it as ${EXAM_DATE_FORMAT} only (two digits for day and month, four for the year, "/" between), e.g. ${EXAM_DATE_EXAMPLE}.` +
      (hint ? ` Write ${hint} instead.` : '') +
      calendarProblem,
  );
}

/** Same rule, but returns null instead of throwing (null = blank OR invalid; use parseExamDate when the reason matters). */
export function tryParseExamDate(raw: unknown, now?: number): string | null {
  try {
    return parseExamDate(raw, now) ?? null;
  } catch {
    return null;
  }
}
