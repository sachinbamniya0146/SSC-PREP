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
