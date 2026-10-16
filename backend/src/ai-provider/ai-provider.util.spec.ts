import { MODEL_SKIP_AFTER, applyModelOutcome, clampTokens, isTransientStatus, newHealth, orderKeysByCooldown, redact, retryDelayMs, rotateModels, usableModels } from './ai-provider.util';

describe('provider helpers', () => {
  it('redacts keys everywhere', () => {
    const s = redact('401: Bearer sk-or-v1-abcdef1234567890 and api_key=ABCDEFGH12345678 sk-or-v1-zzzzzzzzzz');
    expect(s).not.toMatch(/abcdef1234567890/);
    expect(s).not.toMatch(/ABCDEFGH12345678/);
    expect(s).not.toMatch(/zzzzzzzzzz/);
  });
  it('backoff grows, is capped and jitter is bounded', () => {
    delete process.env.AI_RETRY_BASE_MS; // integration spec shortens it
    const d = [0, 1, 2, 3, 10].map((a) => retryDelayMs(a, () => 0));
    expect(d).toEqual([800, 1600, 3200, 6400, 8000]);
    expect(retryDelayMs(0, () => 1)).toBe(1000);
  });
  it('only transient statuses are retried', () => {
    for (const s of [408, 500, 502, 503, 504, 522]) expect(isTransientStatus(s)).toBe(true);
    for (const s of [200, 400, 401, 402, 403, 404, 429]) expect(isTransientStatus(s)).toBe(false);
  });
  it('rate-limited keys go last, order otherwise stable', () => {
    const cd = new Map([['k1', 1000]]);
    expect(orderKeysByCooldown([{ id: 'k1' }, { id: 'k2' }, { id: 'k3' }], cd, 500).map((k) => k.id)).toEqual(['k2', 'k3', 'k1']);
    expect(orderKeysByCooldown([{ id: 'k1' }, { id: 'k2' }], cd, 2000).map((k) => k.id)).toEqual(['k1', 'k2']); // cooldown over
  });
  it('model offset rotation + token clamp', () => {
    expect(rotateModels(['a', 'b', 'c'], 1)).toEqual(['b', 'c', 'a']);
    expect(rotateModels(['a', 'b', 'c'], 4)).toEqual(['b', 'c', 'a']);
    expect(rotateModels(['a'], 3)).toEqual(['a']);
    expect(clampTokens(999999)).toBe(6000);
    expect(clampTokens(1)).toBe(16);
    expect(clampTokens(undefined)).toBe(3000);
  });
  it('a model failing 3x in a row is skipped, success resets, never ALL skipped', () => {
    let h = newHealth();
    for (let i = 0; i < MODEL_SKIP_AFTER; i++) h = applyModelOutcome(h, false, 'boom', 1000);
    const map = new Map([['m1', h]]);
    expect(usableModels(['m1', 'm2'], map, 2000)).toEqual(['m2']);
    expect(usableModels(['m1'], map, 2000)).toEqual(['m1']);
    expect(usableModels(['m1', 'm2'], map, 1000 + 31 * 60 * 1000)).toEqual(['m1', 'm2']);
    h = applyModelOutcome(h, true, null, 3000);
    expect(h.skipUntil).toBe(0);
    expect(h.consecFail).toBe(0);
  });
});

import { classifyKeyProblem, keyProblemMessage, pacedConcurrency, promptHash, rankModels, successScore, callDeadlineMs, applyModelOutcome as aom } from './ai-provider.util';

describe('A2 routing + key verdicts', () => {
  it('rank: better success + faster first, unknown in the middle', () => {
    const h = new Map<string, ReturnType<typeof newHealth>>();
    h.set('bad', { ...newHealth(), ok: 1, fail: 9 });
    h.set('good', { ...newHealth(), ok: 40, fail: 1, avgMs: 2000 });
    expect(rankModels(['bad', 'new', 'good'], h)).toEqual(['good', 'new', 'bad']);
    expect(successScore(undefined)).toBe(0.5);
  });
  it('latency average', () => {
    const a = aom(undefined, true, null, 1, 1000);
    expect(aom(a, true, null, 2, 2000).avgMs).toBe(1300);
  });
  it('classifyKeyProblem', () => {
    expect(classifyKeyProblem(401, '', 'invalid')).toBe('invalid');
    expect(classifyKeyProblem(403, 'blocked', 'valid')).toBe('forbidden_model');
    expect(classifyKeyProblem(402, '', 'valid')).toBe('no_credit');
    expect(classifyKeyProblem(429, 'free-models-per-day', 'valid')).toBe('daily_limit');
    expect(classifyKeyProblem(429, 'slow down', 'valid')).toBe('rate_limit');
    expect(classifyKeyProblem(500, '', 'unknown')).toBe('unknown');
  });
  it('messages never leak a key', () => {
    expect(keyProblemMessage('invalid', 'sk-or-v1-abcdefghijkl')).not.toContain('abcdefghijkl');
  });
  it('pacing, deadline, hash', () => {
    expect(pacedConcurrency(4, 2, false)).toBe(2);
    expect(pacedConcurrency(4, 0, false)).toBe(1);
    expect(pacedConcurrency(4, 0, true)).toBe(4);
    delete process.env.AI_CALL_DEADLINE_MS;
    expect(callDeadlineMs()).toBe(150000);
    process.env.AI_CALL_DEADLINE_MS = '2000'; expect(callDeadlineMs()).toBe(2000); delete process.env.AI_CALL_DEADLINE_MS;
    expect(promptHash('m', 'a')).not.toBe(promptHash('m', 'b'));
  });
});
