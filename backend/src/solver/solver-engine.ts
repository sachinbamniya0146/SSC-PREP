/**
 * Deterministic MCQ solver for SSC Quant/Reasoning (v5 §37 VERIFIED_COMPUTED).
 *
 * Pure TypeScript — no Nest/Prisma deps so it can be unit-tested standalone.
 * Every pattern derives the answer by computation from the question text and
 * only reports a result when it maps to EXACTLY ONE option (unambiguous).
 * No LLM anywhere: an answer marked VERIFIED_COMPUTED by this engine is an
 * independent re-derivation, exactly what the spec requires.
 */

export interface SolverOption {
  key: string;
  text: string;
  isCorrect?: boolean;
}

export interface SolveResult {
  solved: boolean;
  optionKey?: string; // matched option key (e.g. "C")
  optionText?: string;
  evidence?: string; // human-readable derivation ("24/2+1=13 => 38/2+1=20")
  reason?: string; // when not solved
}

// ---------- text normalization ----------

const UNI_MAP: Record<string, string> = {
  '×': '*', '÷': '/', '−': '-', '–': '-', '—': '-', '।': ' ',
  '…': '...', '%': '%',
};

export function normText(s: string): string {
  let out = s.toLowerCase();
  for (const [k, v] of Object.entries(UNI_MAP)) out = out.split(k).join(v);
  return out.replace(/\s+/g, ' ').trim();
}

/** Normalize an option's text for comparison. */
export function normOption(s: string): string {
  return normText(s).replace(/\s*:\s*/g, ':').trim();
}

/** Parse a numeric literal: decimal, fraction "a/b", percent "n%". Null if not numeric. */
export function numVal(s: string): number | null {
  const t = normText(s).trim();
  if (!t) return null;
  const frac = t.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (frac) {
    const d = parseFloat(frac[2]);
    return d === 0 ? null : parseFloat(frac[1]) / d;
  }
  const pct = t.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (pct) return parseFloat(pct[1]) / 100;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

// ---------- safe arithmetic evaluator (recursive descent) ----------

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'lp' } | { t: 'rp' } | { t: 'pct' };

function tokenize(expr: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  const s = expr.replace(/\s+/g, '');
  while (i < s.length) {
    const c = s[i];
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < s.length && (s[j] >= '0' && s[j] <= '9' || s[j] === '.')) j++;
      const v = parseFloat(s.slice(i, j));
      if (!Number.isFinite(v)) return null;
      toks.push({ t: 'num', v });
      i = j;
    } else if (c === '(') { toks.push({ t: 'lp' }); i++; }
    else if (c === ')') { toks.push({ t: 'rp' }); i++; }
    else if (c === '%') { toks.push({ t: 'pct' }); i++; }
    else if ('+-*/'.includes(c)) { toks.push({ t: 'op', v: c }); i++; }
    else return null; // anything else → not a clean expression
  }
  return toks;
}

function evalExpr(toks: Tok[], pos: { i: number }, minPrec: number): number | null {
  // parse unary +/-
  let left: number | null = null;
  const first: Tok | undefined = toks[pos.i];
  if (first && first.t === 'op' && (first.v === '+' || first.v === '-')) {
    const op = first.v;
    pos.i++;
    const v = evalExpr(toks, pos, 2);
    if (v === null) return null;
    left = op === '-' ? -v : v;
  } else if (first && first.t === 'num') {
    left = first.v; pos.i++;
  } else if (first && first.t === 'lp') {
    pos.i++;
    left = evalExpr(toks, pos, 0);
    if (left === null || toks[pos.i]?.t !== 'rp') return null;
    pos.i++;
  } else return null;

  while (toks[pos.i]) {
    const tok: Tok = toks[pos.i];
    if (tok.t === 'rp') break;
    if (tok.t === 'pct') {
      // postfix percent
      if (minPrec > 2) break;
      pos.i++;
      left = left! / 100;
      continue;
    }
    if (tok.t !== 'op') return null;
    const prec = tok.v === '+' || tok.v === '-' ? 1 : 2;
    if (prec < minPrec) break;
    const op = tok.v;
    pos.i++;
    const rhs = evalExpr(toks, pos, prec + 1);
    if (rhs === null) return null;
    if (op === '+') left = left! + rhs;
    else if (op === '-') left = left! - rhs;
    else if (op === '*') left = left! * rhs;
    else if (op === '/') { if (rhs === 0) return null; left = left! / rhs; }
  }
  return left;
}

/** Evaluate a safe arithmetic expression like "25*4/5+6". Returns null on any risk. */
export function safeEval(expr: string): number | null {
  const toks = tokenize(expr);
  if (!toks || toks.length === 0) return null;
  const pos = { i: 0 };
  const v = evalExpr(toks, pos, 0);
  if (v === null) return null;
  if (pos.i !== toks.length) return null; // trailing junk
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 1e9) / 1e9;
}

const fmt = (n: number): string => {
  const r = Math.round(n * 1e6) / 1e6;
  return Number.isInteger(r) ? String(r) : String(r);
};

/** Compare a computed value against an option's text (numeric or string). */
function matchValue(computed: number, opt: string): boolean {
  const on = numVal(opt);
  if (on !== null) return Math.abs(on - computed) < 1e-6;
  return false;
}

function uniqueOptionKey(computed: number, options: SolverOption[]): string | null {
  const hits = options.filter((o) => matchValue(computed, o.text));
  return hits.length === 1 ? hits[0].key : null;
}

function exactOptionKey(text: string, options: SolverOption[]): string | null {
  const want = normOption(text);
  const hits = options.filter((o) => normOption(o.text) === want || normOption(o.text) === want.replace(/\s/g, ''));
  return hits.length === 1 ? hits[0].key : null;
}

// ---------- pattern registry ----------

type Pattern = {
  id: string;
  solve: (t: string, options: SolverOption[]) => { key: string; evidence: string } | null;
};

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

const patterns: Pattern[] = [
  // 1. Arithmetic expression: "25 × 4 ÷ 5 + 6", "25*4/5+6", "Simplify: (15+5)×2"
  {
    id: 'arithmetic',
    solve: (t, options) => {
      // compact spaces around operators so "25 * 4 / 5" → "25*4/5"
      const compact = t.replace(/\s*([+\-*/])\s*/g, '$1');
      const m = compact.match(/(?<![a-z0-9])(\d+(?:\.\d+)?|[()+\-*/.])+(?![a-z0-9])/);
      if (!m) return null;
      const expr = m[0].replace(/\s+/g, '');
      // must look like a complete expression: starts with digit/(, has a binary op
      if (!/^[\d(]/.test(expr)) return null;
      if (!/\d\s*[+\-*/]\s*\d/.test(expr.replace(/[()]/g, ''))) return null;
      // balanced parens
      let depth = 0;
      for (const c of expr) {
        if (c === '(') depth++;
        else if (c === ')') { depth--; if (depth < 0) return null; }
      }
      if (depth !== 0) return null;
      const v = safeEval(expr);
      if (v === null) return null;
      const key = uniqueOptionKey(v, options);
      if (!key) return null;
      return { key, evidence: `${expr} = ${fmt(v)}` };
    },
  },

  // 2. Percent: "X% of Y", "Y का X%", chained "X% of Y% of Z" → product
  {
    id: 'percentOf',
    solve: (t, options) => {
      if (!/%/.test(t)) return null;
      // chained: "20% of 45% of 800"
      const chain = t.match(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/);
      if (chain) {
        const v = (parseFloat(chain[1]) / 100) * (parseFloat(chain[2]) / 100) * parseFloat(chain[3]);
        const key = uniqueOptionKey(Math.round(v * 1e6) / 1e6, options);
        if (key) return { key, evidence: `${chain[1]}% of ${chain[2]}% of ${chain[3]} = ${fmt(v)}` };
      }
      const m =
        t.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of|का)?\s*(\d+(?:\.\d+)?)/) ??
        t.match(/(\d+(?:\.\d+)?)\s*(?:of|का)\s*(\d+(?:\.\d+)?)\s*%/);
      if (!m) return null;
      let a: number; let b: number; // a = percent, b = base
      if (m[0].includes('%') && /\d\s*%/.test(m[0])) {
        a = parseFloat(m[1]);
        b = parseFloat(m[2]);
      } else {
        b = parseFloat(m[1]);
        a = parseFloat(m[2]);
      }
      const v = Math.round((a / 100) * b * 1e6) / 1e6;
      const key = uniqueOptionKey(v, options);
      if (!key) return null;
      return { key, evidence: `${a}% of ${b} = ${fmt(v)}` };
    },
  },

  // 3. Percentage change: "increase 200 by 25%" / "decrease 200 by 25%"
  {
    id: 'percentChange',
    solve: (t, options) => {
      const inc = t.match(/(?:increase|badhao|बढ़ाओ|वृद्धि|add)\s*(\d+(?:\.\d+)?)\s*(?:by|se)?\s*(\d+(?:\.\d+)?)\s*%/i);
      const dec = t.match(/(?:decrease|reduce|ghatao|घटाओ|कमी|subtract)\s*(\d+(?:\.\d+)?)\s*(?:by|se)?\s*(\d+(?:\.\d+)?)\s*%/i);
      const m = inc || dec;
      if (!m) return null;
      const base = parseFloat(m[1]);
      const pct = parseFloat(m[2]) / 100;
      const v = inc ? base * (1 + pct) : base * (1 - pct);
      const key = uniqueOptionKey(v, options);
      if (!key) return null;
      return { key, evidence: `${inc ? 'increase' : 'decrease'} ${base} by ${m[2]}% = ${fmt(v)}` };
    },
  },

  // 4. Ratio simplification: "24 : 36" → "2:3"
  {
    id: 'ratioSimplify',
    solve: (t, options) => {
      if (!/ratio|अनुपात|:/.test(t)) return null;
      const m = t.match(/(\d+)\s*:\s*(\d+)/);
      if (!m) return null;
      const [a, b] = [parseInt(m[1]), parseInt(m[2])];
      if (a <= 0 || b <= 0) return null;
      const g = gcd(a, b);
      const want = `${a / g}:${b / g}`;
      const key = exactOptionKey(want, options) ?? exactOptionKey(`${a}:${b}`, options);
      if (!key) return null;
      return { key, evidence: `gcd(${a},${b})=${g} => ${a}:${b} = ${want}` };
    },
  },

  // 5. Number series: "2, 4, 8, 16, ?" (AP / GP / squares / cubes / +2,+4,+6...)
  {
    id: 'numberSeries',
    solve: (t, options) => {
      const m = t.match(/(\d+(?:\s*,\s*\d+){2,})\s*(?:,|\.\.|\.{2,})?\s*(?:\?|_+)/);
      if (!m) return null;
      const nums = m[1].split(',').map((x) => parseInt(x.trim(), 10));
      if (nums.length < 3 || nums.some((n) => !Number.isFinite(n))) return null;

      const tryNext = (): number | null => {
        // arithmetic with constant diff
        const d1 = nums[1] - nums[0];
        if (nums.every((n, i) => i === 0 || nums[i] - nums[i - 1] === d1)) return nums[nums.length - 1] + d1;
        // geometric with constant ratio
        if (nums[0] !== 0) {
          const r = nums[1] / nums[0];
          if (nums.every((n, i) => i === 0 || Math.abs(nums[i] / nums[i - 1] - r) < 1e-9)) {
            return nums[nums.length - 1] * r;
          }
        }
        // second differences constant (quadratic)
        const diffs = nums.slice(1).map((n, i) => n - nums[i]);
        const dd = diffs.slice(1).map((n, i) => n - diffs[i]);
        if (dd.length >= 1 && dd.every((x) => x === dd[0])) {
          return nums[nums.length - 1] + diffs[diffs.length - 1] + dd[0];
        }
        // squares / cubes of consecutive ints
        const roots = nums.map((n) => Math.round(Math.sqrt(n)));
        if (roots.every((r, i) => r * r === nums[i] && (i === 0 || r === roots[0] + i))) {
          const nextR = roots[roots.length - 1] + 1;
          return nextR * nextR;
        }
        const cb = nums.map((n) => Math.round(Math.cbrt(n)));
        if (cb.every((r, i) => r * r * r === nums[i] && (i === 0 || r === cb[0] + i))) {
          const nextC = cb[cb.length - 1] + 1;
          return nextC * nextC * nextC;
        }
        // alternating +1,+3,+5... (odd increments) common in SSC
        const incs = nums.slice(1).map((n, i) => n - nums[i]);
        if (incs.length >= 2 && incs.every((x, i) => x === incs[0] + 2 * i)) {
          return nums[nums.length - 1] + incs[incs.length - 1] + 2;
        }
        return null;
      };

      const next = tryNext();
      if (next === null || !Number.isFinite(next)) return null;
      const key = uniqueOptionKey(next, options);
      if (!key) return null;
      const seq = nums.join(', ');
      return { key, evidence: `series ${seq}, ? → next = ${fmt(next)}` };
    },
  },

  // 6. Letter series: "A, C, E, G, ?" (single letters, positive or negative step)
  {
    id: 'letterSeries',
    solve: (t, options) => {
      const m = t.match(/([A-Za-z](?:\s*,\s*[A-Za-z]){2,})\s*(?:,)?\s*(?:\?|_+)/);
      if (!m) return null;
      const letters = m[1].split(',').map((x) => x.trim().toUpperCase());
      if (letters.length < 3) return null;
      const pos = letters.map((l) => l.charCodeAt(0) - 64);
      if (pos.some((p) => p < 1 || p > 26)) return null;
      const step = pos[1] - pos[0];
      if (step === 0) return null;
      if (!pos.every((p, i) => i === 0 || p - pos[i - 1] === step)) return null;
      const nextPos = ((pos[pos.length - 1] + step - 1 + 26) % 26) + 1;
      const nextLetter = String.fromCharCode(64 + nextPos);
      const key = exactOptionKey(nextLetter, options);
      if (!key) return null;
      return { key, evidence: `letters ${letters.join(', ')} step ${step} → ${nextLetter}` };
    },
  },

  // 7. Coding-decoding (uniform letter shift): "CAT is coded as DBU ... DOG"
  {
    id: 'codingDecode',
    solve: (t, options) => {
      const m = t.match(/([A-Za-z]{3,})\s+(?:is\s+)?coded\s+as\s+([A-Za-z]{3,})/i);
      if (!m) return null;
      const [src, enc] = [m[1].toUpperCase(), m[2].toUpperCase()];
      if (src.length !== enc.length) return null;
      const shifts: number[] = [];
      for (let i = 0; i < src.length; i++) {
        shifts.push(((enc.charCodeAt(i) - src.charCodeAt(i) + 26) % 26 + 26) % 26);
      }
      if (!shifts.every((s) => s === shifts[0])) return null;
      const shift = shifts[0];
      if (shift === 0) return null;
      // candidate target words: 3+ letters, not stopwords, not src/enc
      const stop = new Set(['coded', 'as', 'is', 'will', 'be', 'how', 'what', 'the', 'for', 'and', 'cat', 'क्या', 'होगा', 'कोड']);
      const words = t.toUpperCase().replace(/\?/g, ' ').split(/[^A-Z]+/).filter((w) => w.length >= 3);
      const candidates = words.filter((w) => !stop.has(w.toLowerCase()) && w !== src && w !== enc);
      const matched: { key: string; out: string }[] = [];
      for (const target of candidates) {
        if (target.length !== src.length) continue;
        let out = '';
        let ok = true;
        for (let i = 0; i < target.length; i++) {
          const p = target.charCodeAt(i) - 64;
          if (p < 1 || p > 26) { ok = false; break; }
          out += String.fromCharCode(64 + ((p - 1 + shift) % 26) + 1);
        }
        if (!ok) continue;
        const key = exactOptionKey(out, options);
        if (key) matched.push({ key, out });
      }
      if (matched.length !== 1) return null;
      return { key: matched[0].key, evidence: `shift +${shift}: ${src}→${enc}, so ${candidates.find((c) => c.length === src.length)}→${matched[0].out}` };
    },
  },

  // 8. Average: "average of 2, 4, 6, 8" / "144, 169, 196, 225 and 256"
  {
    id: 'average',
    solve: (t, options) => {
      const m = t.match(/(?:average|औसत|mean)\s*(?:of|का)?\s*([\d]+(?:\s*(?:,|and|और)\s*[\d]+)+)/i);
      if (!m) return null;
      const nums = (m[1].match(/\d+(?:\.\d+)?/g) || []).map(parseFloat);
      if (nums.length < 2) return null;
      const v = nums.reduce((a, b) => a + b, 0) / nums.length;
      const key = uniqueOptionKey(Math.round(v * 1e6) / 1e6, options);
      if (!key) return null;
      return { key, evidence: `avg(${nums.join(',')}) = ${fmt(v)}` };
    },
  },

  // 9. Linear equation: "3x + 4 = 19" → x=5
  {
    id: 'linearEq',
    solve: (t, options) => {
      const m = t.match(/(\d+(?:\.\d+)?)\s*x\s*([+-])\s*(\d+(?:\.\d+)?)\s*=\s*(\d+(?:\.\d+)?)/i);
      if (!m) return null;
      const [a, sign, b, c] = [parseFloat(m[1]), m[2], parseFloat(m[3]), parseFloat(m[4])];
      if (a === 0) return null;
      const x = sign === '+' ? (c - b) / a : (c + b) / a;
      const key = uniqueOptionKey(x, options);
      if (!key) return null;
      return { key, evidence: `${a}x ${sign} ${b} = ${c} → x = ${fmt(x)}` };
    },
  },

  // 10. Simple interest: "SI on 1000 at 5% per annum for 2 years" → 100
  {
    id: 'simpleInterest',
    solve: (t, options) => {
      if (!/simple interest|साधारण ब्याज/.test(t)) return null;
      const p = t.match(/(?:on|principal|मूलधन|पर)\s*(?:rs\.?|₹)?\s*(\d{3,})/i);
      const r = t.match(/(\d+(?:\.\d+)?)\s*(?:%|percent|प्रतिशत)/i);
      const y = t.match(/(\d+(?:\.\d+)?)\s*(?:years?|year|saal|वर्ष|साल)/i);
      if (!p || !r || !y) return null;
      const si = (parseFloat(p[1]) * parseFloat(r[1]) * parseFloat(y[1])) / 100;
      const v = Math.round(si * 1e6) / 1e6;
      const key = uniqueOptionKey(v, options);
      if (!key) return null;
      return { key, evidence: `SI = ${p[1]} × ${r[1]}% × ${y[1]}y / 100 = ${fmt(v)}` };
    },
  },
];

/** Run all patterns; first unambiguous match wins. */
export function solveQuestion(text: string, options: SolverOption[]): SolveResult {
  const t = normText(text);
  if (!options || options.length === 0) {
    return { solved: false, reason: 'no options' };
  }
  for (const p of patterns) {
    try {
      const r = p.solve(t, options);
      if (r) return { solved: true, optionKey: r.key, evidence: r.evidence };
    } catch {
      /* pattern must never throw */
    }
  }
  return { solved: false, reason: 'no deterministic pattern matched' };
}