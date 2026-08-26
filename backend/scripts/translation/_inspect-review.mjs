import fs from 'node:fs';
import { solve, parse } from './solver-coding.mjs';

const rows = JSON.parse(fs.readFileSync('extract/pinnacle/Coding-Decoding.json', 'utf8')).filter(r => !r.has_fig);
const rest = rows.slice(40);

const noTarget = [], noRule = [], noMatch = [];
for (const q of rest) {
  const r = solve(q);
  if (!r.review) continue;
  if (r.reason === 'no target parsed') noTarget.push(q);
  else if (r.reason === 'no rule reproduced example/given') noRule.push(q);
  else noMatch.push(q);
}
const show = (arr, n, label) => {
  console.log(`\n===== ${label} (${arr.length}) — showing ${Math.min(n, arr.length)} =====`);
  for (let i = 0; i < Math.min(n, arr.length); i++) {
    const q = arr[i]; const p = parse(q);
    console.log(`bq${q.book_q}: ${(q.q || '').slice(0, 110)}`);
    console.log(`   opts: ${[q.a, q.b, q.c, q.d].map(x => String(x).slice(0,18)).join(' | ')}`);
    console.log(`   parsed: examples=${JSON.stringify(p.examples)} givens=${JSON.stringify(p.givens)} target=${p.target} targetCode=${p.targetCode}`);
  }
};
show(noTarget, 10, 'NO TARGET PARSED');
show(noRule, 16, 'NO RULE REPRODUCED');
