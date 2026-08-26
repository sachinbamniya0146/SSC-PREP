// solver-coding.mjs — auto-solve + verify SSC Coding-Decoding questions.
// A rule is COMMITTED only if it (a) reproduces every example/given in the stem
// AND (b) yields exactly one option, AND (c) no other confirmed rule disagrees.
// Otherwise the question is flagged for review (never guessed).
// Exposes solve(q) -> {ans, rule, en, hi} | {review:true, reason}

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const pos = c => c.toUpperCase().charCodeAt(0) - 64;   // A=1..Z=26
export const chr = n => A[((n - 1) % 26 + 26) % 26];         // 1->A wrap
const letters = s => [...String(s).toUpperCase()].filter(c => /[A-Z]/.test(c));
const isAlpha = s => /^[A-Z]+$/i.test(String(s).trim());
const cleanTok = s => String(s).toUpperCase().replace(/[^A-Z]/g, '');
const normCode = s => String(s).toUpperCase().replace(/\s/g, '');
const optNum = o => /^[\d]+(?:[-\s]\d+)*$/.test(String(o || '').trim());
const STOP = new Set(['WORD', 'CODE', 'LANGUAGE', 'WHICH', 'THAT', 'SAME', 'THEN', 'HOW', 'WILL', 'WOULD', 'THE', 'IN', 'IS', 'ARE', 'AS', 'FOR', 'WHAT', 'CERTAIN', 'CODED', 'WRITTEN']);

// ---------- parse ----------
export function parse(q) {
  const t = (q.q || '').replace(/\s+/g, ' ').trim();

  // decode target code: "which word ... (be) coded/written as CODE"  OR "CODE is the code for which word"
  let targetCode = null;
  let dm = t.match(/which\s+word\s+(?:will|would|is|can)?\s*(?:be\s+)?(?:coded|written|represented|denoted)\s+as\s*['‘"]?([A-Z0-9]+(?:[-\s][0-9]+)*)['’"]?/i)
       || t.match(/word\s+(?:will|would|is|can)?\s*(?:be\s+)?(?:coded|written)\s+as\s*['‘"]?([A-Z0-9]+(?:[-\s][0-9]+)*)['’"]?/i);
  if (dm) targetCode = normCode(dm[1]);

  // examples: WORD (is/are)? (written|coded|..) as CODE
  // IMPORTANT: only scan the PREMISE (before the question part) so the target
  // clause ("how will MOTHER be written as ...") isn't mis-read as an example.
  const qTrigger = t.search(/\b(?:how\s+(?:will|would|is|shall|can|well)|which\s+word|what\s+(?:is|will|would)|then\s+['‘"]?[A-Z]{2,}['’"]?\s*=)/i);
  const premise = qTrigger > 0 ? t.slice(0, qTrigger) : t;
  const examples = [];
  const re = /['‘"]?\b([A-Za-z]{2,})\b['’"]?\s*(?:is|are)?\s*(?:written|coded|represented|denoted)\s+as\s*['‘"]?([A-Za-z0-9]+(?:[-\s][0-9]+)*)['’"]?/gi;
  let m;
  while ((m = re.exec(premise)) !== null) {
    const word = cleanTok(m[1]);
    const code = normCode(m[2]);
    if (STOP.has(word)) continue;
    if (targetCode && code === targetCode) continue; // that's the decode target, not an example
    if (word.length < 2) continue;
    examples.push({ word, code });
  }

  // "If A = 4 and C = 6" / "AS = 19 and BAT = 40" givens
  const givens = [];
  const gre = /\b([A-Za-z]{1,})\s*=\s*(\d+)/g;
  let g;
  while ((g = gre.exec(t)) !== null) {
    const w = cleanTok(g[1]); if (!w) continue;
    givens.push({ word: w, num: parseInt(g[2], 10) });
  }

  // encode target word
  let target = null;
  const W = `['‘"]?(?:the\\s+word\\s+)?['‘"]?([A-Za-z]{2,})['’"]?`;
  const tg =
      t.match(/how\s+(?:will|would|can|shall)?\s*(?:you\s+)?(?:be\s+)?(?:code|write)\s+(?:the\s+word\s+)?['‘"]?([A-Za-z]{2,})['’"]?/i) // "how will you code/write 'Power'"
   || t.match(new RegExp(`how\\s+(?:will|would|is|shall|can)\\s+${W}\\s+(?:be\\s+)?(?:coded|written|represented|denoted)`, 'i'))
   || t.match(new RegExp(`how\\s+${W}\\s+(?:will|would|shall|is)\\s+(?:be\\s+)?(?:coded|written)`, 'i')) // "how MATHS would be written"
   || t.match(/code\s+for\s+(?:the\s+word\s+)?['‘"]?([A-Za-z]{2,})['’"]?/i)
   || t.match(new RegExp(`how\\s+is\\s+${W}\\s+(?:coded|written)`, 'i'))
   || t.match(/what\s+is\s+['‘"]?([A-Za-z]{2,})['’"]?\s+(?:coded|written)/i)                       // "what is 'ROVER' coded as"
   || t.match(/,?\s*then\s+['‘"]?([A-Za-z]{2,})['’"]?\s*=/i)                                        // "then TALL = ?"
   || t.match(/['‘"]?([A-Za-z]{2,})['’"]?\s*=\s*[_?]/)                                              // "BANK = ___"
   || t.match(/['‘"]([A-Za-z]{2,})['’"]\s+is\s+(?:coded|written)\s+as\s*[_.]/i);                    // "'MANGO' is coded as ___"
  if (tg) {
    const cand = cleanTok(tg[1]);
    if (!STOP.has(cand)) target = cand;
  }

  // "third/last/first letter of the code for WORD" → {target, pickIndex}
  let pickIndex = null;
  const pk = t.match(/(first|second|third|fourth|fifth|sixth|last)\s+(?:alphabet|letter)\s+(?:in|of)\s+the\s+code\s+for\s+(?:the\s+word\s+)?['‘"]?([A-Za-z]{2,})/i);
  if (pk) {
    const ord = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, last: -1 };
    pickIndex = ord[pk[1].toLowerCase()];
    target = cleanTok(pk[2]);
  }

  return { text: t, examples, givens, target, targetCode, pickIndex };
}

// ---------- cipher rules: return encoder fns confirmed on examples ----------
// Each returns list of {rule, enc(word)->string, en(target,out), hi(target,out)}
function letterCiphers(examples) {
  const exs = examples.filter(e => isAlpha(e.code));
  if (!exs.length) return [];
  const out = [];
  const okAll = (fn) => exs.every(e => {
    const w = letters(e.word), c = letters(e.code);
    return w.length === c.length && w.map((ch, i) => fn(ch, i, w)).join('') === c.join('');
  });
  const e0w = letters(exs[0].word), e0c = letters(exs[0].code);

  // uniform shift
  if (e0w.length === e0c.length) {
    const k = ((pos(e0c[0]) - pos(e0w[0])) % 26 + 26) % 26;
    const fn = ch => chr(pos(ch) + k);
    if (okAll(fn)) { const kk = k > 13 ? k - 26 : k;
      out.push({ rule: 'shift', enc: w => letters(w).map(fn).join(''),
        en: (tg, o) => `Each letter shifts ${kk >= 0 ? '+' + kk : kk} (e.g. ${e0w[0]}→${e0c[0]}); so ${tg} → ${o}.`,
        hi: (tg, o) => `हर अक्षर ${kk >= 0 ? '+' + kk : kk} खिसकता है (जैसे ${e0w[0]}→${e0c[0]}); अतः ${tg} → ${o}.` }); }
  }
  // atbash
  { const fn = ch => chr(27 - pos(ch));
    if (okAll(fn)) out.push({ rule: 'atbash', enc: w => letters(w).map(fn).join(''),
      en: (tg, o) => `Atbash: each letter → same position from the END (A↔Z, B↔Y …); so ${tg} → ${o}.`,
      hi: (tg, o) => `Atbash: हर अक्षर → अंत से उसी स्थान वाला अक्षर (A↔Z, B↔Y …); अतः ${tg} → ${o}.` }); }
  // alternating shift period 2
  if (e0w.length >= 2 && e0w.length === e0c.length) {
    const k0 = ((pos(e0c[0]) - pos(e0w[0])) % 26 + 26) % 26;
    const k1 = ((pos(e0c[1]) - pos(e0w[1])) % 26 + 26) % 26;
    if (k0 !== k1) { const fn = (ch, i) => chr(pos(ch) + (i % 2 === 0 ? k0 : k1));
      if (okAll(fn)) { const s0 = k0 > 13 ? k0 - 26 : k0, s1 = k1 > 13 ? k1 - 26 : k1;
        out.push({ rule: 'alt-shift', enc: w => letters(w).map(fn).join(''),
          en: (tg, o) => `Odd positions shift ${s0 >= 0 ? '+' + s0 : s0}, even positions shift ${s1 >= 0 ? '+' + s1 : s1} (verified on ${e0w.join('')}→${e0c.join('')}); so ${tg} → ${o}.`,
          hi: (tg, o) => `विषम स्थान ${s0 >= 0 ? '+' + s0 : s0}, सम स्थान ${s1 >= 0 ? '+' + s1 : s1} खिसकते हैं (${e0w.join('')}→${e0c.join('')} पर सत्यापित); अतः ${tg} → ${o}.` }); } }
  }
  // reversal + optional uniform shift
  if (e0w.length === e0c.length) {
    const rev0 = [...e0w].reverse();
    const k = ((pos(e0c[0]) - pos(rev0[0])) % 26 + 26) % 26;
    const ok = exs.every(e => { const ww = letters(e.word), cc = letters(e.code);
      if (ww.length !== cc.length) return false;
      return [...ww].reverse().map(ch => chr(pos(ch) + k)).join('') === cc.join(''); });
    if (ok) { const kk = k > 13 ? k - 26 : k;
      out.push({ rule: 'reverse', enc: w => [...letters(w)].reverse().map(ch => chr(pos(ch) + k)).join(''),
        en: (tg, o) => `The word is reversed${k ? ` then shifted ${kk >= 0 ? '+' + kk : kk}` : ''} (verified on ${e0w.join('')}→${e0c.join('')}); so ${tg} → ${o}.`,
        hi: (tg, o) => `शब्द उल्टा किया जाता है${k ? ` फिर ${kk >= 0 ? '+' + kk : kk} खिसकाया जाता है` : ''} (${e0w.join('')}→${e0c.join('')} पर सत्यापित); अतः ${tg} → ${o}.` }); }
  }
  // fixed permutation (letters rearranged; same multiset). Derive from a distinct-letter example.
  {
    const src = exs.find(e => { const w = letters(e.word); return new Set(w).size === w.length && letters(e.code).length === w.length; });
    if (src) {
      const w = letters(src.word), c = letters(src.code);
      if ([...w].sort().join('') === [...c].sort().join('')) {
        const idx = {}; w.forEach((ch, i) => idx[ch] = i);
        const perm = c.map(ch => idx[ch]);
        const ok = exs.every(e => { const ww = letters(e.word), cc = letters(e.code);
          return ww.length === perm.length && perm.map(p => ww[p]).join('') === cc.join(''); });
        if (ok) out.push({ rule: 'permutation', enc: word => { const a = letters(word); return a.length === perm.length ? perm.map(p => a[p]).join('') : ' '; },
          en: (tg, o) => `The letters are rearranged into a fixed order — code position i takes word letter ${perm.map(p => p + 1).join(',')} (verified on ${w.join('')}→${c.join('')}); so ${tg} → ${o}.`,
          hi: (tg, o) => `अक्षरों को एक निश्चित क्रम में पुनर्व्यवस्थित किया जाता है — कोड स्थान i पर शब्द का अक्षर ${perm.map(p => p + 1).join(',')} (${w.join('')}→${c.join('')} पर सत्यापित); अतः ${tg} → ${o}.` });
      }
    }
  }
  // named positional-shift patterns (parameter-free: shift depends on position index).
  // Safe even with 1 example because the pattern is fixed, not fitted to the data.
  {
    const pats = [
      { key: '+i',   f: i => i + 1,     en: 'shifted forward by its position (1st +1, 2nd +2, …)',  hi: 'अपनी स्थिति के बराबर आगे (पहला +1, दूसरा +2, …)' },
      { key: '-i',   f: i => -(i + 1),  en: 'shifted back by its position (1st −1, 2nd −2, …)',      hi: 'अपनी स्थिति के बराबर पीछे (पहला −1, दूसरा −2, …)' },
      { key: '+i0',  f: i => i,         en: 'shifted forward by (position−1): +0, +1, +2, …',        hi: '(स्थिति−1) आगे: +0, +1, +2, …' },
      { key: '-i0',  f: i => -i,        en: 'shifted back by (position−1): −0, −1, −2, …',           hi: '(स्थिति−1) पीछे: −0, −1, −2, …' },
    ];
    for (const p of pats) { const fn = (ch, i) => chr(pos(ch) + p.f(i));
      if (okAll(fn)) out.push({ rule: `pos-shift:${p.key}`, enc: w => letters(w).map(fn).join(''),
        en: (tg, o) => `Each letter is ${p.en} (verified on ${e0w.join('')}→${e0c.join('')}); so ${tg} → ${o}.`,
        hi: (tg, o) => `हर अक्षर ${p.hi} (${e0w.join('')}→${e0c.join('')} पर सत्यापित); अतः ${tg} → ${o}.` });
    }
  }
  // arbitrary per-position shift vector — only trusted with >= 2 examples (so the vector is corroborated, not fitted).
  if (exs.length >= 2) {
    const L = e0w.length;
    if (exs.every(e => letters(e.word).length === L && letters(e.code).length === L)) {
      const vec = e0w.map((ch, i) => ((pos(e0c[i]) - pos(ch)) % 26 + 26) % 26);
      const notConst = new Set(vec).size > 1;                 // uniform/alt already covered; only add if it's a real vector
      const fn = (ch, i) => chr(pos(ch) + vec[i]);
      if (notConst && okAll(fn)) { const disp = vec.map(v => { const s = v > 13 ? v - 26 : v; return s >= 0 ? '+' + s : '' + s; });
        out.push({ rule: 'pos-vec', enc: w => letters(w).length === L ? letters(w).map(fn).join('') : ' ',
          en: (tg, o) => `Each position has its own fixed shift ${disp.join(',')} (read off and confirmed on ${exs.length} examples, e.g. ${e0w.join('')}→${e0c.join('')}); so ${tg} → ${o}.`,
          hi: (tg, o) => `हर स्थान का अपना निश्चित बदलाव ${disp.join(',')} (${exs.length} उदाहरणों पर सत्यापित, जैसे ${e0w.join('')}→${e0c.join('')}); अतः ${tg} → ${o}.` }); }
    }
  }
  return out;
}

function numberCiphers(examples, dashHint) {
  const exs = examples.filter(e => optNum(e.code));
  if (!exs.length) return [];
  const out = [];
  const dash = dashHint || exs.some(e => /-/.test(e.code));
  const posFns = [
    { key: 'pos', f: n => n, en: 'position (A=1…Z=26)', hi: 'स्थिति (A=1…Z=26)' },
    { key: 'rev', f: n => 27 - n, en: 'reverse position (A=26…Z=1)', hi: 'उल्टी स्थिति (A=26…Z=1)' },
  ];
  // concat variants, optionally reversing the word first
  const pres = [{ key: '', rev: false }, { key: 'reverse then ', rev: true }];
  for (const pre of pres) for (const pf of posFns) for (const k of [0, 1, 2, 3, -1, -2]) {
    const f = n => pf.f(n) + k;
    const enc = w => { const a = letters(w); const seq = pre.rev ? [...a].reverse() : a; return seq.map(ch => f(pos(ch))).join(dash ? '-' : ''); };
    if (exs.every(e => enc(e.word) === e.code)) {
      const kt = k ? (k > 0 ? ' + ' + k : ' − ' + (-k)) : '';
      out.push({ rule: `num:${pre.rev ? 'rev-' : ''}${pf.key}${k}`, enc,
        en: (tg, o) => `${pre.rev ? 'Reverse the word, then each' : 'Each'} letter → ${pf.en}${kt}, joined${dash ? ' with dashes' : ''} (verified); ${tg} → ${o}.`,
        hi: (tg, o) => `${pre.rev ? 'शब्द उल्टा करें, फिर हर' : 'हर'} अक्षर → ${pf.hi}${kt}, जोड़ा गया${dash ? ' (डैश सहित)' : ''} (सत्यापित); ${tg} → ${o}.` });
    }
  }
  // aggregates (fixed)
  const aggs = [
    { key: 'sum', f: ns => ns.reduce((a, b) => a + b, 0), en: 'sum of positions', hi: 'स्थितियों का योग' },
    { key: 'product', f: ns => ns.reduce((a, b) => a * b, 1), en: 'product of positions', hi: 'स्थितियों का गुणनफल' },
    { key: 'sum*2', f: ns => 2 * ns.reduce((a, b) => a + b, 0), en: '2 × sum of positions', hi: '2 × स्थितियों का योग' },
  ];
  for (const ag of aggs) if (exs.every(e => String(ag.f(letters(e.word).map(pos))) === e.code)) {
    out.push({ rule: `agg:${ag.key}`, enc: w => String(ag.f(letters(w).map(pos))),
      en: (tg, o) => `The code = ${ag.en} (verified); for ${tg} it is ${o}.`,
      hi: (tg, o) => `कोड = ${ag.hi} (सत्यापित); ${tg} के लिए ${o}.` });
  }
  // derived sum + k  (needs >= 2 examples so k isn't free-fit)
  if (exs.length >= 2 && exs.every(e => /^\d+$/.test(e.code))) {
    const sum = w => letters(w).map(pos).reduce((a, b) => a + b, 0);
    const k = parseInt(exs[0].code, 10) - sum(exs[0].word);
    if (Number.isFinite(k) && exs.every(e => sum(e.word) + k === parseInt(e.code, 10))) {
      out.push({ rule: `agg:sum${k >= 0 ? '+' + k : k}`, enc: w => String(sum(w) + k),
        en: (tg, o) => `The code = (sum of positions) ${k >= 0 ? '+ ' + k : '− ' + (-k)} (verified on the examples); for ${tg} it is ${o}.`,
        hi: (tg, o) => `कोड = (स्थितियों का योग) ${k >= 0 ? '+ ' + k : '− ' + (-k)} (उदाहरणों पर सत्यापित); ${tg} के लिए ${o}.` });
    }
  }
  // substitution map (letter->digit) when |word|==|digits|
  { const map = {}; let ok = true;
    for (const e of exs) { const w = letters(e.word), d = e.code.replace(/-/g, '');
      if (w.length !== d.length) { ok = false; break; }
      w.forEach((ch, i) => { if (map[ch] !== undefined && map[ch] !== d[i]) ok = false; map[ch] = d[i]; }); }
    if (ok && Object.keys(map).length) out.push({ rule: 'num:substitution', _map: map,
      enc: w => letters(w).every(ch => map[ch] !== undefined) ? letters(w).map(ch => map[ch]).join('') : ' ',
      en: (tg, o) => `Each letter maps to a fixed digit (${Object.entries(map).map(([k, v]) => k + '=' + v).join(', ')}); so ${tg} → ${o}.`,
      hi: (tg, o) => `हर अक्षर एक निश्चित अंक (${Object.entries(map).map(([k, v]) => k + '=' + v).join(', ')}); अतः ${tg} → ${o}.` });
  }
  return out;
}

// letter=value rules from "If A=4..." givens
function givenRules(givens) {
  if (givens.length < 1) return [];
  const out = [];
  const vFns = [];
  for (const k of [0, 1, 2, 3, -1, -2, 3]) vFns.push({ f: n => n + k, en: `position${k ? (k > 0 ? '+' + k : '−' + (-k)) : ''}`, hi: `स्थिति${k ? (k > 0 ? '+' + k : '−' + (-k)) : ''}` });
  for (const mul of [2, 3]) vFns.push({ f: n => n * mul, en: `${mul}×position`, hi: `${mul}×स्थिति` });
  vFns.push({ f: n => 27 - n, en: 'reverse position (27−pos)', hi: 'उल्टी स्थिति (27−pos)' });
  const combs = [
    { key: 'concat', c: vs => vs.join(''), en: 'concatenated', hi: 'जोड़कर' },
    { key: 'sum', c: vs => String(vs.reduce((a, b) => a + b, 0)), en: 'summed', hi: 'योग' },
    { key: 'product', c: vs => String(vs.reduce((a, b) => a * b, 1)), en: 'multiplied', hi: 'गुणा' },
  ];
  for (const v of vFns) for (const cb of combs) {
    const enc = w => cb.c(letters(w).map(ch => v.f(pos(ch))));
    if (givens.every(g => enc(g.word) === String(g.num))) {
      out.push({ rule: `given:${v.en}|${cb.key}`, enc,
        en: (tg, o) => `Each letter → ${v.en}; values are then ${cb.en} (verified on the givens); so ${tg} = ${o}.`,
        hi: (tg, o) => `हर अक्षर → ${v.hi}; फिर मान ${cb.hi} किए जाते हैं (दिए गए मानों पर सत्यापित); अतः ${tg} = ${o}.` });
    }
  }
  return out;
}

function matchOption(out, opts) {
  const keys = ['A', 'B', 'C', 'D'];
  const hits = [];
  opts.forEach((o, i) => { if (out !== ' ' && normCode(o) === normCode(out)) hits.push(keys[i]); });
  return hits;
}

export function solve(q) {
  const opts = [q.opt_a ?? q.a, q.opt_b ?? q.b, q.opt_c ?? q.c, q.opt_d ?? q.d].map(x => String(x ?? ''));
  const { examples, givens, target, targetCode, pickIndex } = parse(q);
  const dashHint = opts.some(o => /-/.test(o));

  // build confirmed ciphers
  let ciphers = [...letterCiphers(examples), ...numberCiphers(examples, dashHint)];
  if (givens.length) ciphers = ciphers.concat(givenRules(givens));
  if (!ciphers.length) return { review: true, reason: 'no rule reproduced example/given' };

  const committed = [];

  if (targetCode) {
    // DECODE: encode each option-word, find which equals targetCode
    const keys = ['A', 'B', 'C', 'D'];
    for (const c of ciphers) {
      const hits = [];
      opts.forEach((o, i) => { if (isAlpha(o.replace(/\s/g, '')) && normCode(c.enc(o)) === targetCode) hits.push(keys[i]); });
      if (hits.length === 1) committed.push({ ...c, ans: hits[0], _decodeWord: opts[keys.indexOf(hits[0])] });
    }
    if (!committed.length) return { review: true, reason: 'decode: no option encodes to target code' };
    const answers = [...new Set(committed.map(c => c.ans))];
    if (answers.length > 1) return { review: true, reason: 'decode ambiguous', detail: committed.map(c => c.rule + '=>' + c.ans) };
    const b = committed[0];
    const w = cleanTok(b._decodeWord);
    return { ans: b.ans, rule: b.rule, en: b.en(w, targetCode) + ` (${w} is the only option that encodes to ${targetCode}.)`, hi: b.hi(w, targetCode) + ` (${w} ही एकमात्र विकल्प है जो ${targetCode} बनाता है.)` };
  }

  if (!target) return { review: true, reason: 'no target parsed' };

  // "nth letter of the code for TARGET" — compute code, pick the requested letter
  if (pickIndex !== null && pickIndex !== undefined) {
    for (const c of ciphers) {
      const full = c.enc(target);
      if (full === ' ' || !full.length) continue;
      const ch = pickIndex === -1 ? full[full.length - 1] : full[pickIndex - 1];
      if (ch === undefined) continue;
      const hits = matchOption(ch, opts);
      if (hits.length === 1) committed.push({ ...c, ans: hits[0], out: full, pick: ch });
    }
    if (!committed.length) return { review: true, reason: 'pick-letter: no single option' };
    const ans = [...new Set(committed.map(c => c.ans))];
    if (ans.length > 1) return { review: true, reason: 'pick-letter ambiguous' };
    const b = committed[0];
    const ordTxt = pickIndex === -1 ? 'last' : `#${pickIndex}`;
    return { ans: b.ans, rule: b.rule, en: `${b.en(target, b.out)} The ${ordTxt} letter of the code is ${b.pick}.`, hi: `${b.hi(target, b.out)} कोड का ${ordTxt} अक्षर ${b.pick} है.` };
  }

  // ENCODE: apply each cipher to target, match to a single option
  for (const c of ciphers) {
    const o = c.enc(target);
    const hits = matchOption(o, opts);
    if (hits.length === 1) committed.push({ ...c, ans: hits[0], out: o });
  }
  if (!committed.length) return { review: true, reason: 'rule found but output matches no single option' };
  const answers = [...new Set(committed.map(c => c.ans))];
  if (answers.length > 1) return { review: true, reason: 'ambiguous: rules disagree', detail: committed.map(c => c.rule + '=>' + c.ans) };
  const b = committed[0];
  return { ans: b.ans, rule: b.rule, en: b.en(target, b.out), hi: b.hi(target, b.out) };
}
