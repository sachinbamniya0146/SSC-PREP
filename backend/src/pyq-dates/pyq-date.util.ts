/**
 * Pure helper functions of the PYQ date-mapping feature (NEW Oct 7 2026).
 * No database, no network here — everything is deterministic so it can be unit-tested.
 */

export type Tier = 'TIER_1' | 'TIER_2';

const MONTHS_FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
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

/** Looks for a tier mention inside free text (paper code, exam name, title ...). First recognisable mention wins. */
export function detectTier(...texts: Array<string | null | undefined>): Tier | null {
  for (const t of texts) {
    if (!t) continue;
    const s = String(t);
    // "Tier 2", "Tier-II", "Tier_2" — check II / 2 BEFORE I / 1
    if (/tier[\s_\-.]*(?:2|ii|two)(?![a-z0-9])/i.test(s)) return 'TIER_2';
    if (/tier[\s_\-.]*(?:1|i|one)(?![a-z0-9])/i.test(s)) return 'TIER_1';
    // paper codes like "SSC-CGL-T-II-12-Sep-2025-S1" / "CGL_T2_..."
    if (/(?:^|[^a-z0-9])t[\s_\-.]?(?:2|ii)(?=[^a-z0-9]|$)/i.test(s)) return 'TIER_2';
    if (/(?:^|[^a-z0-9])t[\s_\-.]?(?:1|i)(?=[^a-z0-9]|$)/i.test(s)) return 'TIER_1';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export function isValidIsoDate(s: unknown, minYear = 2010): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = +s.slice(0, 4);
  const m = +s.slice(5, 7);
  const d = +s.slice(8, 10);
  const maxYear = new Date().getUTCFullYear() + 1;
  if (y < minYear || y > maxYear) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
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

/**
 * Anti-hallucination guard: does the evidence text literally contain this calendar date in any
 * common written form? ("12 Sep 2025", "12th September, 2025", "Sep 12, 2025", "12/09/2025",
 * "12-09-2025", "2025-09-12" ...). A date the AI "found" that is NOT in the text it was given is rejected.
 */
export function dateAppearsInText(iso: string, text: string): boolean {
  if (!isValidIsoDate(iso) || !text) return false;
  const y = iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  const d = +iso.slice(8, 10);
  const dd = `0?${d}`;
  const mm = `0?${m}`;
  const names = [MONTHS_FULL[m - 1], MONTHS_ABBR[m - 1]];
  if (m === 9) names.push('sept');
  const mon = `(?:${Array.from(new Set(names)).join('|')})\\.?`;
  const sep = `[\\s\\-/.,]*`;
  const patterns = [
    `(?<![0-9])${dd}(?:st|nd|rd|th)?${sep}(?:of\\s+)?${mon}${sep}${y}(?![0-9])`,
    `\\b${mon}${sep}${dd}(?:st|nd|rd|th)?${sep}${y}(?![0-9])`,
    `(?<![0-9])${dd}[\\-/.]${mm}[\\-/.]${y}(?![0-9])`,
    `(?<![0-9])${y}[\\-/.]${mm}[\\-/.]${dd}(?![0-9])`,
  ];
  return patterns.some((p) => new RegExp(p, 'i').test(text));
}

const DATE_MENTION_RE = new RegExp(
  [
    // 12 Sep 2025 / 12th September, 2025
    `\\b\\d{1,2}(?:st|nd|rd|th)?[\\s\\-/.,]*(?:of\\s+)?(?:${MONTHS_FULL.join('|')}|${MONTHS_ABBR.join('|')}|sept)\\.?[\\s\\-/.,]*\\d{4}\\b`,
    // Sep 12, 2025
    `\\b(?:${MONTHS_FULL.join('|')}|${MONTHS_ABBR.join('|')}|sept)\\.?[\\s\\-/.,]*\\d{1,2}(?:st|nd|rd|th)?[\\s\\-/.,]+\\d{4}\\b`,
    // 12/09/2025, 12-09-2025, 12.09.2025
    `(?<![0-9])\\d{1,2}[\\-/.]\\d{1,2}[\\-/.]\\d{4}(?![0-9])`,
    // 2025-09-12
    `(?<![0-9])\\d{4}[\\-/.]\\d{1,2}[\\-/.]\\d{1,2}(?![0-9])`,
  ].join('|'),
  'gi',
);

/** Every date-looking mention in a text with its position — used to pick the date nearest to the question. */
export function findDateMentions(text: string, limit = 400): Array<{ index: number; raw: string; iso: string | null }> {
  const out: Array<{ index: number; raw: string; iso: string | null }> = [];
  const re = new RegExp(DATE_MENTION_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < limit) {
    out.push({ index: m.index, raw: m[0], iso: toIsoDate(m[0].replace(/\s+/g, ' ').trim()) });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
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

/** lower-case, letters/digits only, single spaces — used to find the question inside a page. */
export function normText(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function words(s: string, from: number, count: number): string {
  return normText(s).split(' ').filter(Boolean).slice(from, from + count).join(' ');
}

/** "Q.12) What is ..." -> "What is ..." and strips markup the editor may have left in the text. */
export function cleanQuestionText(s: string): string {
  return stripHtml(String(s ?? ''))
    .replace(/^\s*(?:q(?:uestion)?\.?\s*)?\d{1,3}\s*[.):\-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface QueryInput {
  questionText: string;
  questionTextHindi?: string | null;
  options: Array<{ key?: string; text?: string }>;
  examName: string;
  examCode?: string | null;
  year: number | null;
  shift?: string | null;
  tier?: Tier | null;
}

/**
 * Up to `count` DIFFERENT web-search queries for one question. Pass i uses query i, so the
 * verification passes do not just repeat one search (that would not be "independent").
 */
export function buildQueries(q: QueryInput, count = 5): string[] {
  const text = cleanQuestionText(q.questionText);
  const examShort = (q.examCode || q.examName || 'SSC').replace(/^SSC\s*/i, '').trim() || 'SSC';
  const tierTxt = q.tier === 'TIER_2' ? 'Tier 2' : q.tier === 'TIER_1' ? 'Tier 1' : '';
  const yearTxt = q.year ? String(q.year) : '';
  const shiftTxt = q.shift ? String(q.shift) : '';
  const optTexts = q.options.map((o) => stripHtml(String(o?.text ?? ''))).filter((t) => t && t.length <= 60);

  const firstWords = (n: number) => text.split(/\s+/).slice(0, n).join(' ');
  const lastWords = (n: number) => text.split(/\s+/).slice(-n).join(' ');

  const list: string[] = [];
  list.push(`"${firstWords(14)}" SSC ${examShort} ${tierTxt} ${yearTxt}`);
  list.push(`${firstWords(9)} SSC ${examShort} ${tierTxt} ${yearTxt} previous year question ${shiftTxt} exam date`);
  if (optTexts.length >= 2) list.push(`"${optTexts[0]}" "${optTexts[1]}" ${firstWords(5)} SSC ${examShort} PYQ`);
  const hindi = cleanQuestionText(q.questionTextHindi || '');
  if (hindi) list.push(`${hindi.split(/\s+/).slice(0, 12).join(' ')} SSC ${examShort} ${yearTxt}`);
  else list.push(`"${lastWords(10)}" SSC ${examShort} ${yearTxt} PYQ`);
  list.push(`${firstWords(6)} ${examShort} ${tierTxt} ${yearTxt} ${shiftTxt} memory based paper answer key`);
  list.push(`${lastWords(7)} SSC ${examShort} ${yearTxt} shift ${shiftTxt} solved paper`);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of list) {
    const cleaned = l.replace(/\s+/g, ' ').trim().slice(0, 240);
    const key = cleaned.toLowerCase();
    if (cleaned.length < 12 || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= count) break;
  }
  return out.length ? out : [`SSC ${examShort} ${yearTxt} previous year paper`];
}

// ---------------------------------------------------------------------------
// AI answer parsing
// ---------------------------------------------------------------------------

export interface RawPassAnswer {
  found: boolean;
  examDate: string | null;
  year: number | null;
  tier: Tier | null;
  shift: string | null;
  sourceIndex: number | null;
  quote: string | null;
  confidence: number | null;
}

/** Tolerant JSON reader: strips ``` fences / chatter around the object. Returns null when nothing usable. */
export function parsePassAnswer(raw: string): RawPassAnswer | null {
  if (!raw) return null;
  let t = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  t = t.slice(a, b + 1);
  let o: any;
  try {
    o = JSON.parse(t);
  } catch {
    try {
      o = JSON.parse(t.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== 'object') return null;
  const found = o.found === true || String(o.found).toLowerCase() === 'true';
  const iso = toIsoDate(o.examDate ?? o.exam_date ?? o.date);
  const yearNum = Number(o.year);
  const conf = Number(o.confidence);
  const srcIdx = Number(o.sourceIndex ?? o.source_index ?? o.source);
  return {
    found,
    examDate: iso,
    year: Number.isFinite(yearNum) && yearNum > 1990 && yearNum < 2100 ? yearNum : iso ? +iso.slice(0, 4) : null,
    tier: normalizeTier(o.tier),
    shift: o.shift ? String(o.shift).slice(0, 40) : null,
    sourceIndex: Number.isFinite(srcIdx) && srcIdx > 0 ? Math.floor(srcIdx) : null,
    quote: o.quote ? String(o.quote).slice(0, 240) : null,
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null,
  };
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

export type PassVerdict = 'accepted' | 'no_date' | 'unsupported' | 'year_mismatch' | 'no_results' | 'search_failed' | 'error';

export interface PassRecord {
  index: number; // 1-based
  query: string;
  verdict: PassVerdict;
  reason?: string;
  model?: string | null;
  keyName?: string | null;
  examDate: string | null;
  year: number | null;
  tier: Tier | null;
  shift: string | null;
  quote: string | null;
  sourceUrl: string | null;
  confidence: number | null;
  strong: boolean; // the question text itself was found on a fetched page
  hits: number;
  evidenceChars: number;
  sources: Array<{ url: string; title: string }>;
  ms: number;
}

export type MapDecision = 'MAPPED' | 'NEEDS_REVIEW' | 'NOT_FOUND';

export interface VoteResult {
  decision: MapDecision;
  date: string | null;
  year: number | null;
  agree: number;
  strongAgree: number;
  confidence: number | null;
  tier: Tier | null;
  note: string;
  /** how many accepted passes voted for each date */
  tally: Record<string, number>;
}

/**
 * Turns the finished passes into a decision.
 *  - A pass only counts ("accepted") when the date is a real calendar date, is literally present in
 *    the evidence, and its YEAR equals the question's year.
 *  - MAPPED needs `minAgree` accepted passes on ONE date (and no other date with the same count).
 *  - 2+ accepted votes but not enough  -> NEEDS_REVIEW (admin decides).
 *  - dates were found but all in another year -> NEEDS_REVIEW with a clear "year mismatch" note.
 */
export function decideFromPasses(passes: PassRecord[], minAgree: number, questionYear: number | null, priorTier: Tier | null): VoteResult {
  const accepted = passes.filter((p) => p.verdict === 'accepted' && p.examDate);
  const tally: Record<string, number> = {};
  const strongTally: Record<string, number> = {};
  for (const p of accepted) {
    tally[p.examDate!] = (tally[p.examDate!] ?? 0) + 1;
    if (p.strong) strongTally[p.examDate!] = (strongTally[p.examDate!] ?? 0) + 1;
  }
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1] || (strongTally[b[0]] ?? 0) - (strongTally[a[0]] ?? 0));

  // tier: exam / paper-code says it -> trusted; otherwise the majority of the passes (needs 2 votes)
  let tier: Tier | null = priorTier;
  if (!tier) {
    const tv: Record<string, number> = {};
    for (const p of passes) if (p.tier && (p.verdict === 'accepted' || p.verdict === 'year_mismatch' || p.verdict === 'no_date')) tv[p.tier] = (tv[p.tier] ?? 0) + 1;
    const top = Object.entries(tv).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2) tier = top[0] as Tier;
  }

  const total = passes.length || 1;
  if (ranked.length === 0) {
    const mismatch = passes.filter((p) => p.verdict === 'year_mismatch' && p.examDate);
    if (mismatch.length >= Math.min(2, minAgree)) {
      const byDate: Record<string, number> = {};
      for (const p of mismatch) byDate[p.examDate!] = (byDate[p.examDate!] ?? 0) + 1;
      const top = Object.entries(byDate).sort((a, b) => b[1] - a[1])[0];
      return {
        decision: 'NEEDS_REVIEW',
        date: top[0],
        year: +top[0].slice(0, 4),
        agree: top[1],
        strongAgree: 0,
        confidence: null,
        tier,
        note: `Internet par date ${top[0]} mili, par question ka year ${questionYear ?? '—'} hai — year match nahi hua, isliye apply nahi kiya.`,
        tally: byDate,
      };
    }
    const failed = passes.filter((p) => p.verdict === 'search_failed' || p.verdict === 'error').length;
    return {
      decision: 'NOT_FOUND',
      date: null,
      year: null,
      agree: 0,
      strongAgree: 0,
      confidence: null,
      tier,
      note: failed === passes.length ? 'Search/AI sabhi passes me fail hua.' : 'Internet par is question ki exam date saaf nahi mili (evidence me date nahi thi).',
      tally,
    };
  }

  const [topDate, topCount] = ranked[0];
  const tie = ranked.length > 1 && ranked[1][1] === topCount;
  const strongAgree = strongTally[topDate] ?? 0;
  const base = topCount / total;
  const confidence = Math.round(base * (0.8 + 0.2 * (topCount ? strongAgree / topCount : 0)) * 100) / 100;

  if (topCount >= minAgree && !tie) {
    return {
      decision: 'MAPPED',
      date: topDate,
      year: +topDate.slice(0, 4),
      agree: topCount,
      strongAgree,
      confidence,
      tier,
      note: `${topCount}/${total} passes ne same date confirm ki (year ${topDate.slice(0, 4)} match).`,
      tally,
    };
  }
  if (topCount >= 2) {
    return {
      decision: 'NEEDS_REVIEW',
      date: topDate,
      year: +topDate.slice(0, 4),
      agree: topCount,
      strongAgree,
      confidence,
      tier,
      note: tie
        ? `Do dates barabar votes pe hain (${ranked.map((r) => `${r[0]}: ${r[1]}`).join(', ')}) — admin check kare.`
        : `Sirf ${topCount}/${total} passes agree hue (kam se kam ${minAgree} chahiye) — admin check kare.`,
      tally,
    };
  }
  return {
    decision: 'NOT_FOUND',
    date: topDate,
    year: +topDate.slice(0, 4),
    agree: topCount,
    strongAgree,
    confidence,
    tier,
    note: `Sirf 1 pass me date (${topDate}) mili — bharosemand nahi, isliye apply nahi ki.`,
    tally,
  };
}

/** minimum agreeing passes for a given number of passes (5 -> 3, 4 -> 3, 3 -> 2) */
export function minAgreeFor(passes: number): number {
  return Math.floor(passes / 2) + 1;
}
