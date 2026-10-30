// S47 simulation: a 100-question practice submit under the rate limit.
// OLD flow = one request per answered question, counted per IP, 60 / minute; a failed call was shown as WRONG.
// NEW flow = ONE batch request, counted per student. Uses the real common/throttle-key.ts and bank/attempt-batch.ts.
// Run: cd backend && tsx ../scripts/audit/batch-scoring-sim.cjs .
const path = require('path');
const root = path.resolve(process.argv[2] || '.');
const { throttleTracker, throttleLimit } = require(path.join(root, 'src/common/throttle-key.ts'));
const { scoreBatchAnswers } = require(path.join(root, 'src/bank/attempt-batch.ts'));

function makeServer(trackerFn, limitFn) {
  const counts = new Map();
  return (req) => {
    const key = trackerFn(req);
    const n = (counts.get(key) || 0) + 1;
    counts.set(key, n);
    return n <= limitFn(req) ? 200 : 429;
  };
}
let fails = 0;
const check = (name, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + name); if (!ok) fails++; };

const questions = Array.from({ length: 100 }, (_, i) => ({ id: 'q' + i, correctAnswer: 'ABCD'[i % 4] }));
const allRight = questions.map((q) => ({ questionId: q.id, selectedOption: q.correctAnswer.toLowerCase() }));

// OLD: per-IP 60/min, 100 calls, 3 classmates behind the same IP each submitting
const oldServer = makeServer((r) => r.ip, () => 60);
let oldWrong = 0;
for (const user of ['u1']) for (const a of allRight) { const st = oldServer({ ip: '49.36.0.1', user: { userId: user } }); if (st !== 200) oldWrong++; /* old page: failed call => wrong */ }
check('OLD design shows right answers as wrong (' + oldWrong + ' of 100 lost to 429)', oldWrong > 0);

// NEW: one batch request per student, counted per student, 300/min
const newServer = makeServer(throttleTracker, (r) => throttleLimit(r));
let status = [];
for (const u of ['u1', 'u2', 'u3', 'u4', 'u5']) status.push(newServer({ ip: '49.36.0.1', user: { userId: u } }));
check('5 classmates on one IP: every batch request accepted', status.every((s) => s === 200));
const out = scoreBatchAnswers(allRight, questions, () => ({ marks: 2, negative: 0.5 }));
check('100 right answers in the batch: 100 right, 0 wrong, score 200', out.correct === 100 && out.wrong === 0 && out.score === 200);
// even if a student also autosaves / loads pages in the same minute
let ok = 0; for (let i = 0; i < 120; i++) if (newServer({ ip: '49.36.0.1', user: { userId: 'u1' } }) === 200) ok++;
check('a student can still make 120 other requests in the same minute', ok === 120);
// anonymous callers keep the strict limit (brute force on login is not loosened)
const anon = makeServer(throttleTracker, (r) => throttleLimit(r));
let anonOk = 0; for (let i = 0; i < 100; i++) if (anon({ ip: '5.5.5.5' }) === 200) anonOk++;
check('anonymous caller still limited to 60 / minute', anonOk === 60);
console.log(fails ? `\n${fails} FAIL` : '\nALL OK');
process.exit(fails ? 1 : 0);
