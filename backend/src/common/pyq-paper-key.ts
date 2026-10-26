/**
 * DATE-WISE + TIER-WISE PYQ MOCKS (Sachin, 26 Oct 2026).
 *
 * ONE real exam paper is identified by these five fields — NOT by paperCode:
 *
 *     examId | examTier | tierPaper (blank = PAPER_1) | examDate | shift (blank = none)
 *
 * Every upload session that carries the same five values joins the SAME mock, so
 * Reasoning today + Maths tomorrow + English/GA later grow one mock (25 -> 50 -> 100).
 * Tier 1 and Tier 2 can never mix, and a differently-spelled paperCode can never split a
 * paper in two. paperCode stays a human-readable label only.
 *
 * Everything here is a PURE function (no DB, no Nest) so it is fully unit-tested.
 */
import { normalizeShiftOrUndefined } from './shift';

export type ExamTier = 'TIER_1' | 'TIER_2';
export type TierPaper = 'PAPER_1' | 'PAPER_2' | 'PAPER_3';

export const DEFAULT_TIER_PAPER: TierPaper = 'PAPER_1';

/**
 * Safety ceiling for a keyed paper (NOT a pattern number): a real SSC paper is at most a
 * few hundred questions, so anything above this is a bad upload. The real "how many
 * questions should this paper have" target comes from the admin-editable ExamPattern.
 */
export const KEYED_PAPER_CEILING = 300;

/** Template-id prefix of a keyed paper. Starts with `pyq-` on purpose so the paywall helper,
 * the /mocks list and the admin tools (all keyed off that prefix) keep treating it as a PYQ mock. */
export const KEYED_TEMPLATE_PREFIX = 'pyq-k-';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3 };

function clean(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase().replace(/[\s_\-.]+/g, ' ').trim();
}

/** Shared "1 | i | one" -> 1..3 reader; returns undefined for anything else. */
function ordinal(token: string): number | undefined {
  if (/^[1-3]$/.test(token)) return Number(token);
  if (token in ROMAN) return ROMAN[token];
  return undefined;
}

/**
 * TIER_1 / tier 1 / Tier-I / T-I / I / 1 -> TIER_1, TIER_2 likewise.
 * Blank -> { tier: undefined, invalid: false }.  Unreadable -> { tier: undefined, invalid: true }
 * (the caller keeps the row but it joins no mock, and shows a warning).
 */
export function normalizeExamTier(raw: unknown): { tier?: ExamTier; invalid: boolean } {
  const v = clean(raw);
  if (!v) return { invalid: false };
  const m = /^(?:tier|t)?\s*([a-z0-9]+)$/.exec(v);
  const n = m ? ordinal(m[1]) : undefined;
  if (n === 1) return { tier: 'TIER_1', invalid: false };
  if (n === 2) return { tier: 'TIER_2', invalid: false };
  return { invalid: true };
}

/** PAPER_1 / paper 1 / Paper-I / 2 / II ... -> PAPER_n. Blank -> undefined (= PAPER_1 for identity). */
export function normalizeTierPaper(raw: unknown): { paper?: TierPaper; invalid: boolean } {
  const v = clean(raw);
  if (!v) return { invalid: false };
  const m = /^(?:paper|p)?\s*([a-z0-9]+)$/.exec(v);
  const n = m ? ordinal(m[1]) : undefined;
  if (n) return { paper: `PAPER_${n}` as TierPaper, invalid: false };
  return { invalid: true };
}

/** Printed question number inside the paper. Blank / non-positive / non-integer -> undefined. */
export function parsePaperQuestionNo(raw: unknown): number | undefined {
  const v = String(raw ?? '').trim();
  if (!/^\d{1,4}(\.0+)?$/.test(v)) return undefined;
  const n = parseInt(v, 10);
  return n >= 1 ? n : undefined;
}

export interface PaperParts {
  examId: string;
  examTier: ExamTier;
  tierPaper?: TierPaper | null;
  examDate: string; // YYYY-MM-DD
  shift?: string | null;
}

/** The effective tierPaper (blank means PAPER_1). */
export function effectiveTierPaper(p?: string | null): TierPaper {
  return p === 'PAPER_2' || p === 'PAPER_3' ? p : DEFAULT_TIER_PAPER;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(v: string | null | undefined): v is string {
  if (!v) return false;
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return dt.getUTCFullYear() === +m[1] && dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3];
}

/** Year / month ("2025-09") of an ISO date; undefined when the date is not valid. */
export function yearOfDate(d: string | null | undefined): number | undefined {
  return isIsoDate(d) ? Number(d.slice(0, 4)) : undefined;
}
export function monthKeyOfDate(d: string | null | undefined): string | undefined {
  return isIsoDate(d) ? d.slice(0, 7) : undefined;
}

/** Canonical shift for identity ('' when there is none). */
export function shiftForKey(shift?: string | null): string {
  return normalizeShiftOrUndefined(shift ?? '') ?? '';
}

/**
 * The identity string of one real paper, or null when the row does not carry enough to be in
 * a mock (needs examId + a valid examTier + a valid examDate; shift may be blank).
 */
export function buildPaperKey(p: {
  examId?: string | null;
  examTier?: string | null;
  tierPaper?: string | null;
  examDate?: string | null;
  shift?: string | null;
}): string | null {
  if (!p.examId) return null;
  const { tier } = normalizeExamTier(p.examTier);
  if (!tier) return null;
  if (!isIsoDate(p.examDate)) return null;
  return [p.examId, tier, effectiveTierPaper(p.tierPaper), p.examDate, shiftForKey(p.shift)].join('|');
}

export function parsePaperKey(key: string): PaperParts | null {
  const a = key.split('|');
  if (a.length !== 5) return null;
  const [examId, tier, paper, examDate, shift] = a;
  if (!examId || (tier !== 'TIER_1' && tier !== 'TIER_2') || !isIsoDate(examDate)) return null;
  return { examId, examTier: tier, tierPaper: effectiveTierPaper(paper), examDate, shift: shift || null };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Stable TestTemplate id of a keyed paper: pyq-k-<exam>-t1[-p2]-<yyyymmdd>-<s#|na>. */
export function templateIdForPaper(p: PaperParts): string {
  const t = p.examTier === 'TIER_2' ? 't2' : 't1';
  const paper = effectiveTierPaper(p.tierPaper);
  const pp = paper === 'PAPER_1' ? '' : `-p${paper.slice(-1)}`;
  const sn = /(\d)/.exec(shiftForKey(p.shift));
  return `${KEYED_TEMPLATE_PREFIX}${slug(p.examId)}-${t}${pp}-${p.examDate.replace(/-/g, '')}-${sn ? `s${sn[1]}` : 'na'}`;
}

export function isKeyedTemplateId(id: string): boolean {
  return id.startsWith(KEYED_TEMPLATE_PREFIX);
}

/** "2025-09-12" -> "12 Sep 2025" */
export function formatIsoDate(d: string): string {
  const m = DATE_RE.exec(d);
  if (!m) return d;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "SSC CGL Tier 1 — 12 Sep 2025 · Shift 2" / "SSC CGL Tier 2 · Paper 1 — 18 Jan 2025". */
export function titleForPaper(examName: string, p: PaperParts): string {
  const tier = p.examTier === 'TIER_2' ? 'Tier 2' : 'Tier 1';
  const paper = effectiveTierPaper(p.tierPaper);
  const showPaper = p.examTier === 'TIER_2' || paper !== 'PAPER_1';
  const head = `${examName} ${tier}${showPaper ? ` · Paper ${paper.slice(-1)}` : ''}`;
  const shift = shiftForKey(p.shift);
  return `${head} — ${formatIsoDate(p.examDate)}${shift ? ` · ${shift}` : ''}`;
}

/**
 * Human paperCode label, e.g. SSC-CGL-T-I-12-Sep-2025-S2 (Tier 2 without shift: SSC-CGL-T-II-18-Jan-2025).
 * `examSlug` is the exam's own slug/short name ("ssc-cgl" or "SSC-CGL").
 */
export function derivePaperCode(examSlug: string, tier: ExamTier, examDate: string, shift?: string | null): string {
  const m = DATE_RE.exec(examDate);
  const date = m ? `${Number(m[3])}-${MONTHS[Number(m[2]) - 1]}-${m[1]}` : examDate;
  const sn = /(\d)/.exec(shiftForKey(shift));
  const base = examSlug.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase();
  return `${base}-${tier === 'TIER_2' ? 'T-II' : 'T-I'}-${date}${sn ? `-S${sn[1]}` : ''}`;
}

/**
 * Pulls tier / date / shift out of a paperCode like SSC-CGL-T-I-12-Sep-2025-S2.
 * Used for backfill and for rows where the date column was left blank (caller marks those derived).
 */
export function parsePaperCode(code: string | null | undefined): { examTier?: ExamTier; examDate?: string; shift?: string } {
  const c = String(code ?? '');
  const out: { examTier?: ExamTier; examDate?: string; shift?: string } = {};
  const t = /(?:^|[-_ ])T[-_ ]?(II|I)(?=[-_ ]|$)/i.exec(c);
  if (t) out.examTier = t[1].toUpperCase() === 'II' ? 'TIER_2' : 'TIER_1';
  const d = /(\d{1,2})[-_ ]([A-Za-z]{3})[-_ ](\d{4})/.exec(c);
  if (d) {
    const mo = MONTHS.findIndex((x) => x.toLowerCase() === d[2].toLowerCase()) + 1;
    if (mo) {
      const iso = `${d[3]}-${String(mo).padStart(2, '0')}-${String(+d[1]).padStart(2, '0')}`;
      if (isIsoDate(iso)) out.examDate = iso;
    }
  }
  const s = /[-_ ]S(\d)(?:$|[-_ ])/i.exec(c);
  if (s) out.shift = `Shift ${s[1]}`;
  return out;
}
