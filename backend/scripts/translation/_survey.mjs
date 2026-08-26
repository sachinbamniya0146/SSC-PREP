import fs from 'node:fs';
const rows = JSON.parse(fs.readFileSync('extract/pinnacle/Coding-Decoding.json', 'utf8')).filter(r => !r.has_fig);
const rest = rows.slice(40); // beyond book_q 40 (already done)
console.log('remaining text-based:', rest.length);

const optIsNumber = o => /^[\d\- ]+$/.test(String(o || '').trim());
const optIsWord = o => /^[A-Za-z]{2,}$/.test(String(o || '').trim());

let cat = { langSubstitution: 0, letterEqNum: 0, wordToCodeWord: 0, wordToCodeNum: 0, other: 0 };
for (const q of rest) {
  const t = q.q || '';
  const optsNum = optIsNumber(q.a) && optIsNumber(q.b);
  const optsWord = optIsWord(q.a) && optIsWord(q.b);
  if (/is called/i.test(t)) cat.langSubstitution++;
  else if (/=\s*\d/.test(t) && optsNum) cat.letterEqNum++;
  else if (/(coded|written)\s+as/i.test(t) && optsWord) cat.wordToCodeWord++;
  else if (/(coded|written)\s+as/i.test(t) && optsNum) cat.wordToCodeNum++;
  else cat.other++;
}
console.log(JSON.stringify(cat, null, 2));

console.log('\n--- sample stems ---');
const step = Math.max(1, Math.floor(rest.length / 20));
for (let i = 0; i < rest.length; i += step) {
  console.log(rest[i].book_q + ': ' + (rest[i].q || '').slice(0, 140));
}
