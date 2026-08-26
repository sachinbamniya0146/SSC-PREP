import fs from 'node:fs';
import { solve } from './solver-coding.mjs';

const rows = JSON.parse(fs.readFileSync('extract/pinnacle/Coding-Decoding.json', 'utf8')).filter(r => !r.has_fig);
const rest = rows.slice(40);

let solved = 0, review = 0;
const reasons = {};
const solvedSamples = [], byRule = {};
for (const q of rest) {
  const r = solve(q);
  if (r.review) { review++; reasons[r.reason] = (reasons[r.reason] || 0) + 1; }
  else {
    solved++; byRule[r.rule.split(':')[0].split('|')[0]] = (byRule[r.rule.split(':')[0].split('|')[0]] || 0) + 1;
    if (solvedSamples.length < 12) solvedSamples.push({ bq: q.book_q, ans: r.ans, rule: r.rule, q: (q.q || '').slice(0, 70) });
  }
}
console.log(`remaining = ${rest.length}`);
console.log(`SOLVED    = ${solved}  (${(100 * solved / rest.length).toFixed(1)}%)`);
console.log(`review    = ${review}`);
console.log('\nabstention reasons:'); Object.entries(reasons).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}\t${k}`));
console.log('\nsolved by rule family:'); Object.entries(byRule).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}\t${k}`));
console.log('\nsolved samples:'); solvedSamples.forEach(s => console.log(`  bq${s.bq} ${s.ans} [${s.rule}]  ${s.q}`));
