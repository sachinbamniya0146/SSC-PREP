#!/usr/bin/env node
/* Generate bilingual records for the Series category.
 * Solved -> pinnacle-enhanced/Series.json ; abstained -> _Series.review.json (not imported).
 * Hindi stem is reconstructed from the parsed series (safe, formulaic).
 */
import fs from 'node:fs';
import { solveSeries, parseSeries } from './solver-series.mjs';

const SRC = 'extract/pinnacle/Series.json';
const OUT = 'extract/pinnacle-enhanced/Series.json';
const REVIEW = 'extract/pinnacle-enhanced/_Series.review.json';

const clean = (s) => (s || '')
  .replace(/\s*www\.ssccglpinnacle\.com.*$/is, '')
  .replace(/\s*Download Pinnacle.*$/is, '')
  .replace(/\s+/g, ' ').trim();

function hindiStem(type, toks) {
  const seq = toks.join(', ');
  const noun = type === 'number' ? 'कौन-सी संख्या' : type === 'cluster' ? 'कौन-सा अक्षर-समूह' : 'कौन-सा अक्षर';
  return `निम्नलिखित श्रृंखला में प्रश्नवाचक चिह्न (?) के स्थान पर ${noun} आएगी? ${seq}`;
}
function difficulty(rule) {
  if (/quadratic|×|sum of previous|per-column|interleaved geometric/.test(rule)) return 'hard';
  if (/interleaved|alternating/.test(rule)) return 'medium';
  return 'easy';
}

const src = JSON.parse(fs.readFileSync(SRC, 'utf8')).filter(r => !r.has_fig);
const solved = [], review = [];

for (const s of src) {
  const q = clean(s.q);
  const oa = clean(s.a), ob = clean(s.b), oc = clean(s.c), od = clean(s.d);
  const base = {
    book_q: s.book_q, q, exam: s.exam, date: s.date, shift: s.shift, year: s.year,
    opt_a: oa, opt_b: ob, opt_c: oc, opt_d: od,
    topic: 'Reasoning — Series', has_fig: false,
  };
  const r = solveSeries({ q, opt_a: s.a, opt_b: s.b, opt_c: s.c, opt_d: s.d });
  if (r.review) { review.push({ ...base, needs_review: true, review_note: r.reason }); continue; }
  const p = parseSeries({ q });
  const q_hi = p ? hindiStem(p.type, p.toks) : null;
  if (!q_hi) { review.push({ ...base, ans: r.ans, review_note: 'solved but Hindi stem needs manual phrasing' }); continue; }
  solved.push({
    ...base, q_hi,
    opt_a_hi: oa, opt_b_hi: ob, opt_c_hi: oc, opt_d_hi: od,
    ans: r.ans, expl_en: r.en, expl_hi: r.hi, trick_en: '', trick_hi: '',
    diff: difficulty(r.rule), _rule: r.rule,
  });
}

const stripRule = ({ _rule, ...rest }) => rest;
solved.sort((a, b) => a.book_q - b.book_q);
fs.writeFileSync(OUT, JSON.stringify(solved.map(stripRule), null, 2) + '\n');
fs.writeFileSync(REVIEW, JSON.stringify(review, null, 2) + '\n');

console.log(`Series text-only : ${src.length}`);
console.log(`SOLVED (bilingual): ${solved.length}`);
console.log(`review            : ${review.length}`);
const byRule = {}; for (const r of solved) { const k = r._rule.split(' (')[0]; byRule[k] = (byRule[k] || 0) + 1; }
console.log('by pattern:'); Object.entries(byRule).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}\t${k}`));
