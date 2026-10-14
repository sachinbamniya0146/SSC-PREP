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
