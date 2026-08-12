/**
 * Self-test for solver-engine — run: node --experimental-strip-types src/solver/solver-self-test.ts
 * Validates patterns against real SSC-style questions with known answers.
 */
import { solveQuestion, safeEval } from '../src/solver/solver-engine.ts';
import type { SolverOption } from '../src/solver/solver-engine.ts';

const opts = (...texts: string[]): SolverOption[] =>
  ['A', 'B', 'C', 'D'].map((k, i) => ({ key: k, text: texts[i] }));

const cases: { name: string; q: string; options: SolverOption[]; expectKey: string; expectSolved: boolean }[] = [
  {
    name: 'arithmetic 1',
    q: 'Simplify: 25 × 4 ÷ 5 + 6',
    options: opts('20', '26', '24', '30'),
    expectKey: 'B',
    expectSolved: true,
  },
  {
    name: 'arithmetic 2 (mixed)',
    q: 'Find the value of 12 + 8 × 3 - 4',
    options: opts('56', '32', '28', '36'),
    expectKey: 'B',
    expectSolved: true,
  },
  {
    name: 'arithmetic 3 (brackets)',
    q: 'Solve: (15 + 5) × 2',
    options: opts('30', '40', '35', '25'),
    expectKey: 'B',
    expectSolved: true,
  },
  {
    name: 'percent of',
    q: 'What is 15% of 240?',
    options: opts('30', '36', '40', '48'),
    expectKey: 'B',
    expectSolved: true,
  },
  {
    name: 'percent of hindi',
    q: '240 का 25% क्या होगा?',
    options: opts('40', '50', '60', '80'),
    expectKey: 'C',
    expectSolved: true,
  },
  {
    name: 'percent increase',
    q: 'Increase 200 by 25%',
    options: opts('225', '250', '240', '230'),
    expectKey: 'B',
    expectSolved: true,
  },
  {
    name: 'percent decrease',
    q: 'Decrease 400 by 10%',
    options: opts('380', '360', '390', '340'),
    expectKey: 'B',
    expectSolved: true,
  },
  {
    name: 'ratio simplify',
    q: 'Simplify the ratio 24 : 36',
    options: opts('3:4', '2:3', '4:5', '5:6'),
    expectKey: 'B',
    expectSolved: true,
  },
  {
    name: 'series AP',
    q: 'Find the next number in the series: 2, 4, 8, 16, ?',
    options: opts('24', '28', '32', '30'),
    expectKey: 'C',
    expectSolved: true,
  },
  {
    name: 'series quadratic',
    q: 'Find the next term: 1, 4, 9, 16, ?',
    options: opts('20', '24', '25', '30'),
    expectKey: 'C',
    expectSolved: true,
  },
  {
    name: 'letter series',
    q: 'Find the next letter in the series: A, C, E, G, ?',
    options: opts('H', 'I', 'J', 'K'),
    expectKey: 'B',
    expectSolved: true,
  },
  {
    name: 'coding decode',
    q: 'If CAT is coded as DBU, how will DOG be coded?',
    options: opts('EOH', 'EPH', 'FPH', 'EOG'),
    expectKey: 'B',
    expectSolved: true,
  },
  {
    name: 'average',
    q: 'Find the average of 2, 4, 6, 8, 10',
    options: opts('5', '6', '7', '8'),
    expectKey: 'B',
    expectSolved: true,
  },
  {
    name: 'linear equation',
    q: 'If 3x + 4 = 19, find the value of x',
    options: opts('3', '4', '5', '6'),
    expectKey: 'C',
    expectSolved: true,
  },
  {
    name: 'simple interest',
    q: 'Find the simple interest on 1000 at 5% per annum for 2 years',
    options: opts('50', '100', '150', '200'),
    expectKey: 'B',
    expectSolved: true,
  },
  {
    name: 'chained percent (real DB)',
    q: 'What is 20% of 45% of 800 grams?',
    options: opts('64', '72', '80', '76'),
    expectKey: 'B',
    expectSolved: true,
  },
  {
    name: 'average with and (real DB)',
    q: 'What is the average of 144, 169, 196, 225 and 256?',
    options: opts('184', '190', '196', '198'),
    expectKey: 'D',
    expectSolved: true,
  },
  {
    name: 'ambiguous analogy — must NOT solve',
    q: 'Select the option related to the third number in the same way as the second is related to the first: 24 : 13 :: 38 : ?',
    options: opts('23', '17', '20', '25'),
    expectKey: '',
    expectSolved: false,
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const r = solveQuestion(c.q, c.options);
  const ok = r.solved === c.expectSolved && (!c.expectSolved || r.optionKey === c.expectKey);
  if (ok) {
    pass++;
    console.log(`PASS ${c.name}: ${r.evidence}`);
  } else {
    fail++;
    console.log(`FAIL ${c.name}: expected ${c.expectSolved ? c.expectKey : 'unsolved'} got ${r.solved ? r.optionKey : `unsolved (${r.reason})`}`);
  }
}

// safeEval sanity
const ev = (e: string, want: number | null) => {
  const got = safeEval(e);
  const ok = got === want || (got !== null && want !== null && Math.abs(got - want) < 1e-9);
  console.log(`${ok ? 'PASS' : 'FAIL'} safeEval(${e}) = ${got} (want ${want})`);
  ok ? pass++ : fail++;
};
ev('25*4/5+6', 26);
ev('2+8*3-4', 22);
ev('(15+5)*2', 40);
ev('100*15%', 15);
ev('2**3', null); // power not supported → reject
ev('sqrt(4)', null); // function call → reject
ev('', null);
ev('1/0', null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
