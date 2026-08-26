import fs from 'node:fs';
import { solve, parse, pos, chr } from './solver-coding.mjs';

const rows = JSON.parse(fs.readFileSync('extract/pinnacle/Coding-Decoding.json', 'utf8')).filter(r => !r.has_fig);
const rest = rows.slice(40);

// among "no rule reproduced" that HAVE a clean single word->word or word->num example, categorize
let anagramShiftMix = 0, wordGroupMeans = 0, numToNum = 0, hasExampleWW = 0, hasExampleWN = 0, other = 0;
const samples = [];
for (const q of rest) {
  const r = solve(q);
  if (!r.review || r.reason !== 'no rule reproduced example/given') continue;
  const p = parse(q);
  const t = q.q || '';
  if (/means/i.test(t)) { wordGroupMeans++; continue; }
  if (!p.examples.length) {
    if (/\d.*(coded|written|means)/i.test(t) && /^\d/.test(String(q.a).trim())) numToNum++;
    else other++;
    continue;
  }
  const e = p.examples[0];
  const isWW = /^[A-Z]+$/.test(e.code);
  if (isWW) {
    hasExampleWW++;
    const w = [...e.word], c = [...e.code];
    const anagram = w.length === c.length && [...w].sort().join('') === [...c].sort().join('');
    if (samples.length < 22) samples.push(`bq${q.book_q} [${anagram?'ANAGRAM':'ww'}] ${e.word}->${e.code} | tgt=${p.target} | ${t.slice(0,60)}`);
  } else { hasExampleWN++; if (samples.length < 22) samples.push(`bq${q.book_q} [wn] ${e.word}->${e.code} | tgt=${p.target} | ${t.slice(0,60)}`); }
}
console.log({ wordGroupMeans, numToNum, hasExampleWW, hasExampleWN, other });
console.log('\nsamples of examples we parse but no rule fits:');
samples.forEach(s => console.log('  ' + s));
