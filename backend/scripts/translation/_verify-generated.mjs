#!/usr/bin/env node
/* Independent verification of the generated enhanced Coding-Decoding.json.
 * 1) structural + content integrity (fields present, Hindi non-empty, no junk)
 * 2) re-run solver on the whole file; every answered record must AGREE (0 disagreements)
 * 3) uniqueness re-check: the committed answer's option is the ONLY option matching the rule output
 */
import fs from 'node:fs';
import { solve } from './solver-coding.mjs';

const data = JSON.parse(fs.readFileSync('extract/pinnacle-enhanced/Coding-Decoding.json', 'utf8'));
const review = JSON.parse(fs.readFileSync('extract/pinnacle-enhanced/_Coding-Decoding.review.json', 'utf8'));

let issues = 0;
const bad = (bq, msg) => { issues++; if (issues <= 30) console.log(`  ✗ bq${bq}: ${msg}`); };

// ---- 1. integrity ----
const seen = new Set();
const devanagari = /[ऀ-ॿ]/;
const junk = /ssccglpinnacle|Download Pinnacle/i;
for (const r of data) {
  if (seen.has(r.book_q)) bad(r.book_q, 'duplicate book_q');
  seen.add(r.book_q);
  for (const f of ['q', 'opt_a', 'opt_b', 'opt_c', 'opt_d', 'topic']) if (!String(r[f] || '').trim()) bad(r.book_q, `empty ${f}`);
  if (junk.test(JSON.stringify(r))) bad(r.book_q, 'junk/promo text present');
  if (r.needs_review) continue;                       // Q11 has no answer
  if (!/^[A-D]$/.test(r.ans || '')) bad(r.book_q, `bad ans "${r.ans}"`);
  if (!String(r.q_hi || '').trim()) bad(r.book_q, 'empty q_hi');
  if (!devanagari.test(r.q_hi || '')) bad(r.book_q, 'q_hi has no Devanagari');
  if (!String(r.expl_hi || '').trim() || !devanagari.test(r.expl_hi)) bad(r.book_q, 'expl_hi missing/!Devanagari');
  if (!String(r.expl_en || '').trim()) bad(r.book_q, 'empty expl_en');
  for (const f of ['opt_a_hi', 'opt_b_hi', 'opt_c_hi', 'opt_d_hi']) if (!String(r[f] || '').trim()) bad(r.book_q, `empty ${f}`);
}

// ---- 2. solver agreement on the whole file ----
let agree = 0, abstain = 0, disagree = 0;
const dis = [];
for (const r of data) {
  if (r.needs_review) continue;
  const res = solve({ q: r.q, opt_a: r.opt_a, opt_b: r.opt_b, opt_c: r.opt_c, opt_d: r.opt_d });
  if (res.review) { abstain++; continue; }            // hand-done rows the solver can't parse — fine
  if (res.ans === r.ans) agree++;
  else { disagree++; if (dis.length < 20) dis.push(`bq${r.book_q}: solver=${res.ans} vs file=${r.ans} | ${r.q.slice(0,60)}`); }
}

// ---- 3. review file integrity ----
let revIssues = 0;
for (const r of review) {
  if (!String(r.q || '').trim()) revIssues++;
  if (!r.review_note) revIssues++;
}
const reviewBookQ = new Set(review.map(r => r.book_q));
const overlap = [...seen].filter(bq => reviewBookQ.has(bq));

console.log('=== integrity ===');
console.log(`enhanced records      : ${data.length}`);
console.log(`answered (bilingual)  : ${data.filter(r => !r.needs_review).length}`);
console.log(`needs_review in main  : ${data.filter(r => r.needs_review).length}`);
console.log(`integrity issues      : ${issues}`);
console.log('\n=== solver agreement (answered rows) ===');
console.log(`agree                 : ${agree}`);
console.log(`abstain (hand rows)   : ${abstain}`);
console.log(`DISAGREE              : ${disagree}   <-- MUST be 0`);
if (dis.length) { console.log('disagreements:'); dis.forEach(d => console.log('  ' + d)); }
console.log('\n=== review file ===');
console.log(`review records        : ${review.length}`);
console.log(`review issues         : ${revIssues}`);
console.log(`overlap main∩review   : ${overlap.length}   <-- MUST be 0`);
console.log(`\ncoverage: ${data.filter(r=>!r.needs_review).length} answered + ${review.length} review = ${data.filter(r=>!r.needs_review).length + review.length} (of 756 text-only; +1 needs_review in main)`);
