import fs from 'node:fs';
import { solve } from './solver-coding.mjs';

// ground truth: the 40 hand-verified enhanced questions
const gt = JSON.parse(fs.readFileSync('extract/pinnacle-enhanced/Coding-Decoding.json', 'utf8'));

let agree = 0, review = 0, disagree = 0;
const disagreements = [], reviews = [];
for (const q of gt) {
  if (q.needs_review) continue; // Q11 — no ground-truth answer
  const r = solve(q);
  if (r.review) { review++; reviews.push(q.book_q + ': ' + r.reason); continue; }
  if (r.ans === q.ans) agree++;
  else { disagree++; disagreements.push(`book_q ${q.book_q}: solver=${r.ans} (${r.rule}) vs verified=${q.ans}  | ${q.q.slice(0,70)}`); }
}
console.log(`Ground-truth answered: ${gt.filter(q=>!q.needs_review).length}`);
console.log(`  agree    = ${agree}`);
console.log(`  review   = ${review}  (solver safely abstained)`);
console.log(`  DISAGREE = ${disagree}  <-- must be 0`);
if (disagreements.length) { console.log('\nDISAGREEMENTS:'); disagreements.forEach(d => console.log('  ' + d)); }
if (reviews.length) { console.log('\nabstained on:'); reviews.forEach(d => console.log('  ' + d)); }
