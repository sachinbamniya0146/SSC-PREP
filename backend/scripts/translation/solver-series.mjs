// solver-series.mjs — auto-solve SSC "find the ? in the series" questions (number / letter / letter-cluster).
// Safety: a pattern is COMMITTED only if it reproduces EVERY given term, predicts the hole,
// matches exactly ONE option, and no other confirmed pattern predicts a different value.
// Otherwise -> {review:true, reason}. Never guesses.
import { pos as POS, chr as CHR } from './solver-coding.mjs';

const wrap = n => ((n - 1) % 26 + 26) % 26 + 1;         // keep letter value in 1..26
const isNum = s => /^-?\d+$/.test(s);
const arrEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---- extract the sequence + hole index ----
export function parseSeries(q) {
  const t = String(q.q || '').replace(/\s+/g, ' ').trim();
  // the sequence is the longest comma-separated run that contains a '?'
  const runs = [...t.matchAll(/([A-Za-z0-9]+(?:\s*,\s*[A-Za-z0-9?]+)+|\?(?:\s*,\s*[A-Za-z0-9?]+)+)/g)].map(m => m[0]);
  let seqStr = runs.filter(r => /\?/.test(r)).sort((a, b) => b.length - a.length)[0];
  if (!seqStr) return null;
  const toks = seqStr.split(',').map(s => s.trim()).filter(Boolean);
  const holeIdx = toks.findIndex(s => s === '?');
  if (holeIdx < 0 || toks.length < 3) return null;
  const known = toks.filter((_, i) => i !== holeIdx);
  let type = null;
  if (known.every(isNum)) type = 'number';
  else if (known.every(s => /^[A-Za-z]$/.test(s))) type = 'letter';
  else if (known.every(s => /^[A-Za-z]{2,}$/.test(s)) && new Set(known.map(s => s.length)).size === 1) type = 'cluster';
  else return null;
  return { toks, holeIdx, type };
}

// ---- number pattern engine ----
// For each pattern: derive parameters from terms NOT involving the hole, predict the hole,
// then FILL it and VALIDATE the defining property across the ENTIRE sequence. A prediction is
// kept only if the property holds everywhere — this is what guarantees correctness even when
// the hole is in the middle (terms after the hole are checked too).
function numberPredictions(arr) {
  const n = arr.length, hole = arr.indexOf(null);
  const out = [];
  const known = (i) => i >= 0 && i < n && arr[i] !== null;
  const fill = (v) => { const F = arr.slice(); F[hole] = v; return F; };
  const near = 1e-9;
  const keep = (v, rule, prop) => {
    if (!Number.isFinite(v) || !Number.isInteger(v)) return;
    const F = fill(v);
    if (prop(F)) out.push({ value: v, rule });
  };
  const firstKnownAdjPair = () => { for (let i = 1; i < n; i++) if (known(i) && known(i - 1)) return i; return -1; };

  // properties on a FULLY-FILLED array F
  const propArith = F => { const d = F[1] - F[0]; return F.every((_, i) => i === 0 || F[i] - F[i - 1] === d); };
  const propGeom = F => { if (F[0] === 0) return false; const r = F[1] / F[0]; return F.every((_, i) => i === 0 || F[i - 1] !== 0 && Math.abs(F[i] / F[i - 1] - r) < near); };
  const propQuad = F => { const s = F[2] - 2 * F[1] + F[0]; if (s === 0) return false; return F.every((_, i) => i < 2 || Math.abs((F[i] - 2 * F[i - 1] + F[i - 2]) - s) < near); };
  const propDiffGeom = F => { const D = F.slice(1).map((v, i) => v - F[i]); if (D.some(d => d === 0) || D[0] === 0) return false; const r = D[1] / D[0]; if (Math.abs(r - 1) < near) return false; return D.every((_, i) => i === 0 || Math.abs(D[i] / D[i - 1] - r) < near); };
  const propAlt = F => { const D = F.slice(1).map((v, i) => v - F[i]); const a = D[0], b = D[1]; if (a === b) return false; return D.every((d, i) => d === (i % 2 === 0 ? a : b)); };
  const propRec = (k, c) => F => F.every((_, i) => i === 0 || Math.abs(F[i] - (k * F[i - 1] + c)) < near);
  const propFib = c => F => F.every((_, i) => i < 2 || Math.abs(F[i] - (F[i - 1] + F[i - 2] + c)) < near);

  // 1) arithmetic
  { const i = firstKnownAdjPair(); if (i >= 0) { const d = arr[i] - arr[i - 1]; const a = arr.findIndex(known); keep(arr[a] + d * (hole - a), `arithmetic (common difference ${d >= 0 ? '+' + d : d})`, propArith); } }
  // 2) geometric
  { const i = firstKnownAdjPair(); if (i >= 0 && arr[i - 1] !== 0) { const r = arr[i] / arr[i - 1]; const a = arr.findIndex(known); let v = arr[a]; for (let j = a; j < hole; j++) v *= r; for (let j = a; j > hole; j--) v /= r; keep(Math.round(v), `geometric (ratio ×${r})`, propGeom); } }
  // 3) quadratic (2nd difference constant) — needs >=4 known terms so the parabola is corroborated
  { const pts = arr.map((v, i) => [i, v]).filter(([i]) => i !== hole); if (pts.length >= 4 && arr.every((_, i) => i === hole || known(i))) {
      const [[x1, y1], [x2, y2], [x3, y3]] = pts; const d = (x1 - x2) * (x1 - x3) * (x2 - x3);
      if (d !== 0) { const a = (x3 * (y2 - y1) + x2 * (y1 - y3) + x1 * (y3 - y2)) / d, b = (x3 * x3 * (y1 - y2) + x2 * x2 * (y3 - y1) + x1 * x1 * (y2 - y3)) / d, c = (x2 * x3 * (x2 - x3) * y1 + x3 * x1 * (x3 - x1) * y2 + x1 * x2 * (x1 - x2) * y3) / d;
        const f = i => a * i * i + b * i + c; keep(Math.round(f(hole)), `quadratic (2nd difference constant)`, propQuad); } } }
  // 4) differences are geometric (e.g. +5,+25,+125…)
  { if (arr.every((_, i) => i === hole || known(i)) && n >= 4) {
      // reconstruct via first two known diffs around start
      const D0 = (known(1) && known(0)) ? arr[1] - arr[0] : null, D1 = (known(2) && known(1)) ? arr[2] - arr[1] : null;
      if (D0 !== null && D1 !== null && D0 !== 0) { const r = D1 / D0; if (Math.abs(r - 1) > near) { let F = arr.slice(); // build forward from index0
        let ok = true, prev = arr[0], d = D0; const built = [arr[0]]; for (let i = 1; i < n; i++) { prev = prev + d; built.push(prev); d *= r; } keep(built[hole], `differences are geometric (each gap ×${r})`, propDiffGeom); } } } }
  // 5) alternating two differences (period 2)
  { if (known(0) && known(1) && (known(2))) { const a = arr[1] - arr[0]; // need parity-consistent; derive b from next known diff
      let b = null; for (let i = 2; i < n; i++) if (known(i) && known(i - 1)) { b = arr[i] - arr[i - 1]; break; }
      if (b !== null && a !== b) { const anchor = arr.findIndex(known); let v = arr[anchor]; for (let i = anchor; i < hole; i++) v += (i % 2 === 0 ? a : b); for (let i = anchor; i > hole; i--) v -= ((i - 1) % 2 === 0 ? a : b); keep(v, `alternating differences (${a}, ${b})`, propAlt); } } }
  // 6) recurrence a(n)=k*a(n-1)+c — only "nice" params (k in 2..12 or ½/⅓, |c|<=20)
  { const tri = []; for (let i = 2; i < n; i++) if (known(i) && known(i - 1) && known(i - 2)) tri.push(i);
    if (tri.length >= 1 && known(hole - 1)) {
      // derive from two known adjacent pairs (i-1,i)
      const pairs = []; for (let i = 1; i < n; i++) if (known(i) && known(i - 1)) pairs.push([arr[i - 1], arr[i]]);
      if (pairs.length >= 2) { const [[A, B], [C, D]] = pairs; if (A !== C) { const k = (B - D) / (A - C), c = B - k * A;
        const nice = (Number.isInteger(k) && k >= 2 && k <= 12) || Math.abs(k - 0.5) < near || Math.abs(k - 1 / 3) < near;
        if (nice && Math.abs(c) <= 20 && Number.isInteger(c)) { const kd = Math.abs(k - 0.5) < near ? '÷2' : Math.abs(k - 1 / 3) < near ? '÷3' : '×' + k; keep(k * arr[hole - 1] + c, `each term ${kd}${c >= 0 ? '+' + c : c} of the previous`, propRec(k, c)); } } } } }
  // 7) Fibonacci-like a(n)=a(n-1)+a(n-2)+c  (|c|<=20)
  { const tri = []; for (let i = 2; i < n; i++) if (known(i) && known(i - 1) && known(i - 2)) tri.push(i);
    if (tri.length >= 1 && known(hole - 1) && known(hole - 2)) { const c = arr[tri[0]] - arr[tri[0] - 1] - arr[tri[0] - 2];
      if (Math.abs(c) <= 20 && Number.isInteger(c)) keep(arr[hole - 1] + arr[hole - 2] + c, `sum of previous two${c ? (c > 0 ? ' +' + c : ' ' + c) : ''}`, propFib(c)); } }
  // 8) interleaved: split by parity, each arithmetic or geometric (validated on the FULL subsequence)
  { for (const par of [0, 1]) { const idxs = []; for (let i = 0; i < n; i++) if (i % 2 === par) idxs.push(i); if (!idxs.includes(hole)) continue;
      const vals = idxs.map(i => arr[i]); const local = vals.indexOf(null); const m = vals.length;
      const okPair = (() => { for (let i = 1; i < m; i++) if (vals[i] !== null && vals[i - 1] !== null) return i; return -1; })();
      if (okPair < 0) continue;
      // arithmetic on subsequence
      { const d = vals[okPair] - vals[okPair - 1]; const a0 = vals.findIndex(v => v !== null); let v = vals[a0] + d * (local - a0); const F = vals.slice(); F[local] = v; if (F.every((x, i) => i === 0 || x - F[i - 1] === d)) keep(v, `interleaved arithmetic (every other term, diff ${d})`, () => true); }
      // geometric on subsequence
      if (vals[okPair - 1] !== 0) { const r = vals[okPair] / vals[okPair - 1]; const a0 = vals.findIndex(v => v !== null); let v = vals[a0]; for (let i = a0; i < local; i++) v *= r; for (let i = a0; i > local; i--) v /= r; if (Number.isInteger(v)) { const F = vals.slice(); F[local] = v; if (F[0] !== 0 && F.every((x, i) => i === 0 || F[i - 1] !== 0 && Math.abs(x / F[i - 1] - r) < near)) keep(v, `interleaved geometric (every other term, ×${r})`, () => true); } }
  } }

  // de-dup identical (value,rule)
  const seen = new Set(); return out.filter(p => { const key = p.value + '|' + p.rule; if (seen.has(key)) return false; seen.add(key); return true; });
}

// numeric solve given a numeric option-set
function solveNumberLike(preds, opts, mkExpl) {
  const vals = [...new Set(preds.map(p => p.value))];
  const optNums = opts.map(o => { const m = String(o).replace(/[^\d-]/g, ''); return m === '' ? null : parseInt(m, 10); });
  // predictions that hit exactly one option
  const hits = [];
  for (const p of preds) {
    const idxs = optNums.map((v, i) => v === p.value ? i : -1).filter(i => i >= 0);
    if (idxs.length === 1) hits.push({ ...p, ans: 'ABCD'[idxs[0]] });
  }
  if (!hits.length) return { review: true, reason: 'no pattern hit a single option' };
  const answers = [...new Set(hits.map(h => h.ans))];
  if (answers.length > 1) return { review: true, reason: 'patterns disagree', detail: hits.map(h => h.rule + '=>' + h.ans) };
  const b = hits[0];
  return { ans: b.ans, rule: b.rule, value: b.value, ...mkExpl(b) };
}

export function solveSeries(q) {
  const p = parseSeries(q);
  if (!p) return { review: true, reason: 'could not parse a clean series' };
  const opts = [q.opt_a ?? q.a, q.opt_b ?? q.b, q.opt_c ?? q.c, q.opt_d ?? q.d].map(x => String(x ?? '').trim());
  const { toks, holeIdx, type } = p;

  if (type === 'number') {
    const arr = toks.map(s => s === '?' ? null : parseInt(s, 10));
    const preds = numberPredictions(arr);
    const shown = arr.map(x => x === null ? '?' : x).join(', ');
    return solveNumberLike(preds, opts, b => ({
      en: `Series: ${shown}. Pattern: ${b.rule}. So ? = ${b.value}.`,
      hi: `श्रृंखला: ${shown}. नियम: ${ruleHi(b.rule)}. अतः ? = ${b.value}.`,
    }));
  }

  if (type === 'letter') {
    const arr = toks.map(s => s === '?' ? null : wrap(POS(s)));
    const preds = numberPredictions(arr);
    // map predicted position -> letter, then match option letters
    const hits = [];
    for (const pr of preds) {
      const v = wrap(pr.value); const ch = CHR(v);
      const idxs = opts.map((o, i) => o.toUpperCase() === ch ? i : -1).filter(i => i >= 0);
      if (idxs.length === 1) hits.push({ ...pr, ans: 'ABCD'[idxs[0]], ch });
    }
    if (!hits.length) return { review: true, reason: 'letter series: no pattern hit a single option' };
    const answers = [...new Set(hits.map(h => h.ans))];
    if (answers.length > 1) return { review: true, reason: 'letter series: patterns disagree' };
    const b = hits[0]; const shown = toks.join(', ');
    return { ans: b.ans, rule: b.rule, en: `Letter series (A=1…Z=26): ${shown}. Pattern on positions: ${b.rule}. So ? = ${b.ch}.`, hi: `अक्षर श्रृंखला (A=1…Z=26): ${shown}. स्थितियों पर नियम: ${ruleHi(b.rule)}. अतः ? = ${b.ch}.` };
  }

  if (type === 'cluster') {
    const L = toks.find(s => s !== '?').length;
    if (!opts.every(o => o.replace(/[^A-Za-z]/g, '').length === L)) return { review: true, reason: 'cluster: option length mismatch' };
    // each column is its own letter series
    const cols = [];
    for (let c = 0; c < L; c++) {
      const arr = toks.map(s => s === '?' ? null : wrap(POS(s[c])));
      const preds = numberPredictions(arr);
      if (!preds.length) return { review: true, reason: `cluster column ${c + 1}: no pattern` };
      const vals = [...new Set(preds.map(x => wrap(x.value)))];
      if (vals.length > 1) return { review: true, reason: `cluster column ${c + 1}: ambiguous` };
      cols.push({ ch: CHR(vals[0]), rule: preds[0].rule });
    }
    const predicted = cols.map(c => c.ch).join('');
    const idxs = opts.map((o, i) => o.replace(/[^A-Za-z]/g, '').toUpperCase() === predicted ? i : -1).filter(i => i >= 0);
    if (idxs.length !== 1) return { review: true, reason: 'cluster: prediction matches no single option' };
    const shown = toks.join(', ');
    return { ans: 'ABCD'[idxs[0]], rule: 'per-column letter patterns', en: `Letter-cluster series: ${shown}. Each column follows its own pattern (${cols.map((c, i) => 'col' + (i + 1) + ': ' + c.rule).join('; ')}). So ? = ${predicted}.`, hi: `अक्षर-समूह श्रृंखला: ${shown}. हर स्तंभ का अपना नियम (${cols.map((c, i) => 'स्तंभ' + (i + 1) + ': ' + ruleHi(c.rule)).join('; ')}). अतः ? = ${predicted}.` };
  }

  return { review: true, reason: 'unsupported series type' };
}

function ruleHi(r) {
  return r
    .replace(/arithmetic \(common difference (.+?)\)/, 'समान अंतर ($1) की समांतर श्रेणी')
    .replace(/geometric \(ratio ×(.+?)\)/, 'समान अनुपात (×$1) की गुणोत्तर श्रेणी')
    .replace(/quadratic \(2nd difference constant\)/, 'द्विघात (दूसरा अंतर स्थिर)')
    .replace(/alternating differences \((.+?)\)/, 'क्रमिक बदलते अंतर ($1)')
    .replace(/each term ×(.+?) of the previous/, 'हर पद = पिछला ×$1')
    .replace(/sum of previous two(.*)/, 'पिछले दो पदों का योग$1')
    .replace(/interleaved arithmetic \(every other term, diff (.+?)\)/, 'एकांतर समांतर श्रेणी (अंतर $1)')
    .replace(/interleaved geometric \(every other term, ×(.+?)\)/, 'एकांतर गुणोत्तर श्रेणी (×$1)')
    .replace(/per-column letter patterns/, 'प्रति-स्तंभ अक्षर नियम');
}
