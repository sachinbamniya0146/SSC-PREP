/**
 * Math text normaliser (Oct 3 2026).
 *
 * "maths me jese 2 ki power 2 ... to vo power 2 shi se show ho, excel se import
 * krunga to bhi" — an Excel cell (or a typed question) usually carries a power
 * as plain text:  2^2  ,  x^-1  ,  10^{3}  ,  a^(n+1)  ,  5**2 .  Shown as-is
 * that looks broken. This helper rewrites them into real Unicode superscripts
 * (2²  x⁻¹  10³  aⁿ⁺¹  5²) and  H_2O / a_1  into subscripts (H₂O  a₁).
 *
 * Unicode (not HTML <sup>) on purpose: it is plain text, so it renders
 * identically in the test screen, results, PDF export, bookmarks, Telegram…
 * with zero change to any screen.
 *
 * Safe by design:
 *  - markdown picture lines  ![solution](https://…_1.png)  and bare URLs /
 *    data: URIs are never touched (an underscore in a file name stays).
 *  - only exponents made of characters that HAVE a superscript glyph are
 *    converted; anything else (e.g. a^q) is left exactly as typed.
 *  - idempotent: running it twice gives the same text.
 */

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  n: 'ⁿ', i: 'ⁱ', x: 'ˣ', y: 'ʸ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', k: 'ᵏ', m: 'ᵐ', p: 'ᵖ', r: 'ʳ', t: 'ᵗ',
};

const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  n: 'ₙ', i: 'ᵢ', x: 'ₓ', a: 'ₐ', e: 'ₑ', o: 'ₒ', k: 'ₖ', m: 'ₘ', p: 'ₚ', r: 'ᵣ', t: 'ₜ',
};

function mapAll(s: string, table: Record<string, string>): string | null {
  let out = '';
  for (const ch of s) {
    const m = table[ch];
    if (!m) return null; // a character with no glyph -> leave the whole expression untouched
    out += m;
  }
  return out;
}

// Pieces that must never be rewritten (picture markdown, URLs, data URIs).
const PROTECTED = /(!\[[^\]]*\]\([^)]*\)|https?:\/\/[^\s)]+|data:[a-z]+\/[^\s)]+)/gi;

function convertPlain(text: string): string {
  let t = text;

  // 5**2  ->  5^2   (python / calculator style)
  t = t.replace(/(\d|\))\s?\*\*\s?(-?\d+)/g, '$1^$2');

  // x^{10}  x^(n+1)  — braces / parentheses form
  t = t.replace(/\^\s?\{([^{}]{1,12})\}/g, (m, e: string) => mapAll(e.replace(/\s+/g, ''), SUP) ?? m);
  t = t.replace(/\^\s?\(([^()]{1,12})\)/g, (m, e: string) => {
    const mapped = mapAll(e.replace(/\s+/g, ''), SUP);
    return mapped ?? m;
  });

  // x^2  x^-3  x^+1  x^n  — plain form (digits with optional sign, or a single letter)
  t = t.replace(/\^\s?([+\-−]?\d{1,4})(?![\d])/g, (m, e: string) => mapAll(e, SUP) ?? m);
  t = t.replace(/\^\s?([nixyabcdekmprt])(?![A-Za-z])/g, (m, e: string) => mapAll(e, SUP) ?? m);

  // H_2O  a_1  x_{10}  log_2   — subscripts (letter/closing bracket + _ + digits)
  t = t.replace(/([A-Za-z)\]])_\{([0-9+\-nixaeokmprt]{1,6})\}/g, (m, base: string, e: string) => {
    const mapped = mapAll(e, SUB);
    return mapped ? base + mapped : m;
  });
  t = t.replace(/([A-Za-z)\]])_(\d{1,3})(?![A-Za-z0-9_])/g, (m, base: string, e: string) => {
    const mapped = mapAll(e, SUB);
    return mapped ? base + mapped : m;
  });
  return t;
}

/** Rewrites 2^2 / 10^{3} / x^-1 / H_2O … into 2² / 10³ / x⁻¹ / H₂O. Returns the input unchanged when there is nothing to do. */
export function normalizeMathText(input: string | null | undefined): string {
  if (input === null || input === undefined) return '';
  const text = String(input);
  if (!text || (!text.includes('^') && !text.includes('_') && !text.includes('**'))) return text;
  const parts = text.split(PROTECTED);
  // split() with a capturing group keeps the protected pieces at the odd indexes
  return parts.map((p, i) => (i % 2 === 1 ? p : convertPlain(p))).join('');
}

/** Applies normalizeMathText to every text field of one question-shaped object (in place). */
export function normalizeQuestionMath(q: any): void {
  if (!q || typeof q !== 'object') return;
  for (const k of ['questionText', 'questionTextHindi', 'explanation', 'explanationHindi']) {
    if (typeof q[k] === 'string') q[k] = normalizeMathText(q[k]);
  }
  if (Array.isArray(q.options)) {
    for (const o of q.options) {
      if (!o || typeof o !== 'object') continue;
      if (typeof o.text === 'string') o.text = normalizeMathText(o.text);
      if (typeof o.textHi === 'string') o.textHi = normalizeMathText(o.textHi);
    }
  }
}
