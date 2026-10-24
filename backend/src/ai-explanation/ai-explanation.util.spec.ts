import { RateWindow, SingleFlight, parseExplanation } from './ai-explanation.util';

describe('parseExplanation', () => {
  const en = 'Speed = distance / time = 120 / 6 = 20 m/s. So option C is correct.';
  it('accepts valid JSON with real Hindi', () => {
    const r = parseExplanation(JSON.stringify({ explanation: en, explanationHindi: 'गति = दूरी / समय = 120 / 6 = 20 मी/से। इसलिए विकल्प C सही है।', keyConcepts: ['speed'] }), 'C');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.explanationHindi).toContain('गति');
  });
  it('never copies English into Hindi', () => {
    const r = parseExplanation(JSON.stringify({ explanation: en, explanationHindi: en }), 'C');
    expect(r.ok && r.value.explanationHindi).toBe('');
  });
  it('rejects non-JSON, too short, and key contradiction', () => {
    expect(parseExplanation('just text', 'C')).toMatchObject({ ok: false, reason: 'not_json' });
    expect(parseExplanation('{"explanation":"short"}', 'C')).toMatchObject({ ok: false, reason: 'too_short' });
    expect(parseExplanation(JSON.stringify({ explanation: 'Compute the speed carefully. Hence the answer is B.' }), 'C')).toMatchObject({ ok: false, reason: 'contradicts_key', detail: 'B' });
  });
});
describe('parseExplanation (rich shape)', () => {
  const rich = {
    answer: 'C — 20 m/s',
    answerHindi: 'C — 20 मी/से',
    steps: 'Step 1: Speed = distance / time = 120 / 6 = 20 m/s. Hence, option C is correct.',
    stepsHindi: 'चरण 1: गति = दूरी / समय = 120 / 6 = 20 मी/से। अतः विकल्प C सही है।',
    shortcut: '',
    whyOthers: [{ option: 'A', reason: 'Too small.' }, { option: 'B', reason: 'Ignores units.' }],
    whyOthersHindi: [{ option: 'A', reason: 'बहुत कम है।' }],
    commonMistake: 'Forgetting to divide by time.',
    keyConcepts: ['speed = distance / time'],
    keyConceptsHindi: ['गति = दूरी / समय'],
  };
  it('composes marked sections in both languages', () => {
    const r = parseExplanation(JSON.stringify(rich), 'C');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.explanation).toContain('##STEPS');
      expect(r.value.explanation).toContain('A) Too small.');
      expect(r.value.explanation).not.toContain('##SHORTCUT');
      expect(r.value.explanationHindi).toContain('##CONCEPTS');
    }
  });
  it('does not flag other option letters inside whyOthers as a contradiction', () => {
    const r = parseExplanation(JSON.stringify({ ...rich, whyOthers: [{ option: 'B', reason: 'Option B is wrong because it ignores units.' }] }), 'C');
    expect(r.ok).toBe(true);
  });
  it('still refuses steps that end on another option', () => {
    const r = parseExplanation(JSON.stringify({ ...rich, steps: 'Step 1: compute. Hence, option B is correct.' }), 'C');
    expect(r).toMatchObject({ ok: false, reason: 'contradicts_key' });
  });
});
describe('RateWindow / SingleFlight', () => {
  it('limits per key within the window', () => {
    const r = new RateWindow(2, 1000);
    expect(r.allow('u', 0)).toBe(true);
    expect(r.allow('u', 1)).toBe(true);
    expect(r.allow('u', 2)).toBe(false);
    expect(r.allow('other', 2)).toBe(true);
    expect(r.allow('u', 1500)).toBe(true);
  });
  it('shares one in-flight promise', async () => {
    const sf = new SingleFlight<number>();
    let calls = 0;
    const fn = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return 7; };
    const [a, b] = await Promise.all([sf.run('k', fn), sf.run('k', fn)]);
    expect([a, b, calls]).toEqual([7, 7, 1]);
    await sf.run('k', fn);
    expect(calls).toBe(2);
  });
});
