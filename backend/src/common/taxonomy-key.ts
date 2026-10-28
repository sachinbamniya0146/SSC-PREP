/**
 * Taxonomy (Chapter / Topic / Sub-topic) name normaliser — ONE implementation for every creator.
 *
 * Why: the DB unique is on `slug` only, so "Percentage", "Percentages", "percentage ",
 * "Percentage (प्रतिशत)" or "Profit & Loss" / "Profit and Loss" used to become separate rows.
 * Every place that creates or matches a topic/sub-topic by NAME must go through
 * `normalizeTaxonomyKey()` / `findTaxonomyTwin()` / `makeTaxonomySlug()`.
 *
 * Pure functions, no imports — safe to use from NestJS services, jest specs and (via dist/) plain node scripts.
 */

export interface TaxonomyNameLike {
  name: string;
  nameHindi?: string | null;
}

const DEVANAGARI = /[\u0900-\u097F]/;
const LATIN = /[a-z]/;

/** Words that end in "s" but must not be singularised (kept tiny on purpose; both sides are normalised the same way anyway). */
const KEEP_AS_IS = new Set(['gas', 'bus', 'plus', 'minus', 'class', 'mass', 'chess', 'axis', 'basis', 'analysis', 'physics', 'mathematics', 'statistics', 'economics', 'logic']);

function singularizeWord(w: string): string {
  if (w.length <= 3 || KEEP_AS_IS.has(w) || !/^[a-z]+$/.test(w)) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(sses|shes|ches|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('ss') || w.endsWith('us') || w.endsWith('is')) return w;
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

/** Lowercased words with punctuation/brackets/"&" removed — NOT singularised (used for readable slugs). */
function cleanWords(raw: unknown): string[] {
  let s = String(raw ?? '');
  if (!s.trim()) return [];
  s = s.normalize('NFKC').toLowerCase();
  // zero-width joiners / BOM / non-breaking space
  s = s.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ');
  // bracket groups that contain Devanagari are the "Hindi gloss" of an English name → drop them completely
  s = s.replace(/[(\[{（［][^)\]}）］]*[\u0900-\u097F][^)\]}）］]*[)\]}）］]/g, ' ');
  s = s.replace(/&/g, ' and ').replace(/\+/g, ' plus ');
  // everything that is not a letter / number / combining mark becomes a space (kills punctuation, danda, brackets, hyphens, slashes)
  s = s.replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ');
  const words = s.split(' ').filter(Boolean);
  // a leading article never changes the meaning
  if (words.length > 1 && (words[0] === 'the' || words[0] === 'a' || words[0] === 'an')) words.shift();
  return words;
}

/** Collapses a free-text name into a comparison key: lowercase, no punctuation/brackets, "&"="and", plural → singular. */
export function normalizeTaxonomyKey(raw: unknown): string {
  return cleanWords(raw).map(singularizeWord).join(' ');
}

/** English key if the name has Latin letters, otherwise '' (so Hindi-only names are matched through `hindiKey`). */
export function englishKey(name: unknown): string {
  const k = normalizeTaxonomyKey(name);
  return LATIN.test(k) ? k : '';
}

/** Devanagari-only key (used for the `nameHindi` column and for Hindi-only names). */
export function hindiKey(name: unknown): string {
  const k = normalizeTaxonomyKey(name);
  return DEVANAGARI.test(k) ? k : '';
}

/** Everything we compare a taxonomy row on. */
export interface TaxonomyKeys {
  en: string;
  hi: string;
}

export function taxonomyKeys(name: unknown, nameHindi?: unknown): TaxonomyKeys {
  const hiFromName = hindiKey(name);
  const hiFromCol = hindiKey(nameHindi);
  return { en: englishKey(name), hi: hiFromCol || hiFromName };
}

/** True when two rows are the same topic: same English key, or (when both have one) same Hindi key. */
export function sameTaxonomy(a: TaxonomyNameLike, b: TaxonomyNameLike): boolean {
  const ka = taxonomyKeys(a.name, a.nameHindi);
  const kb = taxonomyKeys(b.name, b.nameHindi);
  if (ka.en && kb.en && ka.en === kb.en) return true;
  if (ka.hi && kb.hi && ka.hi === kb.hi) return true;
  return false;
}

/** Levenshtein distance (iterative, O(n*m), fine for names). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1 similarity of two normalised keys (1 = identical). Order-insensitive for multi-word names ("Time and Work" vs "Work and Time"). */
export function keySimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const sortWords = (s: string) => s.split(' ').sort().join(' ');
  const plain = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const sorted = 1 - levenshtein(sortWords(a), sortWords(b)) / Math.max(a.length, b.length);
  return Math.max(plain, sorted);
}

/** Names at/above this similarity are "probably the same, please look" — never merged automatically. */
export const SIMILAR_THRESHOLD = 0.88;

export interface TwinResult<T> {
  kind: 'exact' | 'hindi' | 'similar';
  row: T;
  score: number;
}

/**
 * Looks for the sibling that already represents `name`.
 *  - exact  : same English key → reuse it (safe to do silently)
 *  - hindi  : English differs but the Hindi key is identical → reuse (the same topic written two ways)
 *  - similar: fuzzy ≥ SIMILAR_THRESHOLD → NOT reused automatically, caller flags / asks
 */
export function findTaxonomyTwin<T extends TaxonomyNameLike>(
  siblings: readonly T[],
  name: string,
  nameHindi?: string | null,
): TwinResult<T> | null {
  const k = taxonomyKeys(name, nameHindi);
  if (!k.en && !k.hi) return null;
  let hindiHit: T | null = null;
  let best: TwinResult<T> | null = null;
  for (const row of siblings) {
    const rk = taxonomyKeys(row.name, row.nameHindi);
    if (k.en && rk.en && k.en === rk.en) return { kind: 'exact', row, score: 1 };
    // a Hindi-only incoming name (no English) can only ever match through Hindi
    if (k.hi && rk.hi && k.hi === rk.hi && !hindiHit) hindiHit = row;
    if (k.en && rk.en && k.en.length >= 5 && rk.en.length >= 5) {
      const score = keySimilarity(k.en, rk.en);
      if (score >= SIMILAR_THRESHOLD && (!best || score > best.score)) best = { kind: 'similar', row, score };
    }
  }
  if (hindiHit) return { kind: 'hindi', row: hindiHit, score: 1 };
  return best;
}

/** FNV-1a 32-bit → 7 base36 chars. Stable, no crypto import. */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0').slice(0, 7);
}

/**
 * Readable URL-safe slug ("Profit & Loss" → profit-and-loss). Duplicates are caught by `findTaxonomyTwin()` BEFORE a row is
 * created; the slug only has to be unique inside its parent. Hindi-only names used to collapse to the same constant
 * ("item") and overwrite each other — they now get `h-<hash of the Hindi key>`.
 */
export function makeTaxonomySlug(name: string, nameHindi?: string | null, fallback = 'item'): string {
  const words = cleanWords(name);
  if (words.some((w) => LATIN.test(w))) {
    const slug = words.join(' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
    if (slug) return slug;
  }
  const hi = hindiKey(name) || hindiKey(nameHindi);
  if (hi) return `h-${shortHash(hi)}`;
  const raw = String(name ?? '').trim();
  return raw ? `${fallback}-${shortHash(raw.toLowerCase())}` : fallback;
}
