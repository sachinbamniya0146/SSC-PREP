import { ANSWER_SCHEMA, HINDI_SCHEMA, canStopEarly, digitsPreserved, etaSeconds, extractJson, hindiRatio, isEmptyText, minAgreeFor, normalizeLetter, parseAnswer, tally, validate } from './ai-job.logic';
import { normalizeShift } from '../common/shift';
import { dateAppearsInText } from '../pyq-dates/pyq-date.util';

describe('vote / consensus', () => {
  it('5/5 agree is accepted', () => {
    const t = tally(['A', 'A', 'A', 'A', 'A'], 3);
    expect(t.accepted).toBe(true);
    expect(t.winner).toBe('A');
    expect(t.count).toBe(5);
  });
  it('3/5 is accepted, 2/5 split is NOT', () => {
    expect(tally(['A', 'A', 'B', 'A', 'C'], 3).accepted).toBe(true);
    const t = tally(['A', 'A', 'B', 'B', 'C'], 3);
    expect(t.accepted).toBe(false);
    expect(t.winner).toBeNull(); // tie never wins
  });
  it('invalid passes (null) never count as votes', () => {
    const t = tally([null, 'A', null, 'A', 'A'], 3);
    expect(t.accepted).toBe(true);
    expect(t.invalid).toBe(2);
    expect(tally([null, null, 'A', 'A', null], 3).accepted).toBe(false);
  });
  it('minAgreeFor', () => {
    expect(minAgreeFor(5)).toBe(3);
    expect(minAgreeFor(3)).toBe(2);
    expect(minAgreeFor(1)).toBe(1);
  });
  it('early stop never changes the decision', () => {
    expect(canStopEarly(['A', 'A', 'A'], 5, 3)).toEqual({ stop: true, reason: 'agreed' });
    expect(canStopEarly(['A', 'B'], 5, 3).stop).toBe(false);
    expect(canStopEarly(['A', 'B', 'C', 'D'], 5, 3)).toEqual({ stop: true, reason: 'impossible' });
    // exhaustive: whenever it stops as "agreed", finishing the remaining passes can never produce another accepted winner
    const letters = ['A', 'B', 'C'];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
      const votes = [letters[a], letters[b], letters[c]];
      if (canStopEarly(votes, 5, 3).reason !== 'agreed') continue;
      for (const x of letters) for (const y of letters) {
        const full = tally([...votes, x, y], 3);
        expect(full.winner).toBe(tally(votes, 3).winner);
      }
    }
  });
});

describe('JSON extraction + strict schema', () => {
  it('extracts plain, fenced and chatty JSON', () => {
    expect(extractJson('{"answer":"B"}')).toEqual({ answer: 'B' });
    expect(extractJson('```json\n{"answer":"C"}\n```')).toEqual({ answer: 'C' });
    expect(extractJson('Sure! Here: {"answer":"D","reason":"x"} hope it helps')).toEqual({ answer: 'D', reason: 'x' });
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('')).toBeNull();
  });
  it('rejects wrong type / enum / missing / too short', () => {
    expect(parseAnswer('{"answer":"E"}', ANSWER_SCHEMA).value).toBeNull();
    expect(parseAnswer('{"answer":2}', ANSWER_SCHEMA).value).toBeNull();
    expect(parseAnswer('{"reason":"x"}', ANSWER_SCHEMA).value).toBeNull();
    expect(parseAnswer('{"answer":"B"}', ANSWER_SCHEMA).value).toEqual({ answer: 'B' });
    expect(validate(HINDI_SCHEMA, { optionsHi: ['a', 'b'] }).ok).toBe(false); // needs exactly 4
    expect(validate({ type: 'number', min: 0, max: 1 }, 1.5).ok).toBe(false);
    expect(validate({ type: 'number', min: 0, max: 1, integer: true }, 0.5).ok).toBe(false);
  });
  it('letters / empties / hindi helpers', () => {
    expect(normalizeLetter('(b)')).toBe('B');
    expect(normalizeLetter('Option c')).toBe('C');
    expect(normalizeLetter('3')).toBe('C');
    expect(normalizeLetter('E')).toBeNull();
    expect(isEmptyText('')).toBe(true);
    expect(isEmptyText('  ')).toBe(true);
    expect(isEmptyText('x')).toBe(false);
    expect(hindiRatio('यह एक प्रश्न है')).toBeGreaterThan(0.9);
    expect(hindiRatio('this is english')).toBe(0);
    expect(digitsPreserved('Find 25% of 480', '480 का 25% ज्ञात कीजिए')).toBe(true);
    expect(digitsPreserved('Find 25% of 480', '480 का 52% ज्ञात कीजिए')).toBe(false);
    expect(digitsPreserved('Find 12', '१२ ज्ञात कीजिए')).toBe(true);
  });
  it('eta', () => {
    expect(etaSeconds(100, 6, 2)).toBe(300);
    expect(etaSeconds(100, null, 2)).toBeNull();
  });
});

describe('date-in-evidence rule (existing) and shift normaliser (existing)', () => {
  it('date must literally be in the text', () => {
    expect(dateAppearsInText('2025-09-12', 'exam held on 12th September 2025 in shift 2')).toBe(true);
    expect(dateAppearsInText('2025-09-12', 'Sep 12, 2025')).toBe(true);
    expect(dateAppearsInText('2025-09-12', '12/09/2025')).toBe(true);
    expect(dateAppearsInText('2025-09-12', 'held in September 2025')).toBe(false);
    expect(dateAppearsInText('2025-09-13', 'exam held on 12th September 2025')).toBe(false);
  });
  it('shift names', () => {
    expect(normalizeShift('Shift-1')).toBe('Shift 1');
    expect(normalizeShift('morning')).toBe('Shift 1');
    expect(normalizeShift('dopahar')).toBe('Shift 2');
    expect(normalizeShift('4:30 PM')).toBe('Shift 3');
    expect(normalizeShift('')).toBeNull();
    expect(normalizeShift('Day 2 Batch B')).toBe('Day 2 Batch B');
  });
});

import { BACK_TRANSLATION_MIN, backTranslationScore, bootSummaryLine, confidenceOf, isStuck, minConfidence, solutionContradictsKey } from './ai-job.logic';

describe('A2 quality gates', () => {
  it('confidenceOf', () => {
    expect(confidenceOf(3, 3, 5)).toBe(1);
    expect(confidenceOf(3, 5, 5)).toBe(0.6);
    expect(confidenceOf(2, 2, 5)).toBe(0.67);
    expect(confidenceOf(0, 3, 5)).toBe(0);
  });
  it('minConfidence default + env', () => {
    delete process.env.AI_MIN_CONFIDENCE;
    expect(minConfidence()).toBe(0.6);
    process.env.AI_MIN_CONFIDENCE = '0.8';
    expect(minConfidence()).toBe(0.8);
    process.env.AI_MIN_CONFIDENCE = 'x';
    expect(minConfidence()).toBe(0.6);
    delete process.env.AI_MIN_CONFIDENCE;
  });
  it('solutionContradictsKey', () => {
    expect(solutionContradictsKey('Speed = 60. Hence the answer is B.', 'B')).toBeNull();
    expect(solutionContradictsKey('Speed = 60. Hence the answer is (C).', 'B')).toBe('C');
    expect(solutionContradictsKey('So correct option: d', 'D')).toBeNull();
    expect(solutionContradictsKey('उत्तर: A है', 'B')).toBe('A');
    expect(solutionContradictsKey('No letter named at the end', 'B')).toBeNull();
    expect(solutionContradictsKey('anything', 'zzz')).toBeNull();
  });
  it('backTranslationScore', () => {
    expect(backTranslationScore('The capital of France is Paris', 'Paris is the capital city of France')).toBeGreaterThanOrEqual(0.8);
    expect(backTranslationScore('A train travels 120 km in 2 hours', 'The boy eats mango')).toBeLessThan(BACK_TRANSLATION_MIN);
    expect(backTranslationScore('120', 'x')).toBe(1);
  });
  it('isStuck + bootSummaryLine', () => {
    expect(isStuck({ status: 'RUNNING', startedAtMs: 0, nowMs: 700000, maxMs: 600000 })).toBe(true);
    expect(isStuck({ status: 'RUNNING', startedAtMs: 100000, nowMs: 200000, maxMs: 600000 })).toBe(false);
    expect(isStuck({ status: 'PENDING', startedAtMs: 0, nowMs: 700000, maxMs: 600000 })).toBe(false);
    expect(bootSummaryLine({ requeuedItems: 2, requeuedJobs: 1, resumable: 1, keysActive: 3, keysRevived: 1 })).toContain('3 key active');
  });
});

import { classifyFailReason, GOLDEN_SET } from './ai-ops.service';
describe('ai-ops', () => {
  it('classifyFailReason', () => {
    expect(classifyFailReason('timeout')).toBe('Timeout');
    expect(classifyFailReason('429: slow down')).toBe('Rate limit / busy (429)');
    expect(classifyFailReason('Key "x" OpenRouter ne reject ki (401)')).toBe('Key invalid (401)');
    expect(classifyFailReason('zzz')).toBe('Other');
  });
  it('golden set is well-formed', () => {
    for (const g of GOLDEN_SET) { expect(g.options).toHaveLength(4); expect('ABCD').toContain(g.answer); }
  });
});
