const assert = require('node:assert/strict');
let pass = 0, fail = 0; const failures = []; const stack = [];
const tests = [];
// beforeEach / afterEach hooks are kept per describe block and run around every test (session 29: they were no-ops, so a spec that clears
// a cache in beforeEach saw stale state and failed here although jest passes it)
const hooks = [{ before: [], after: [] }];
globalThis.describe = (name, fn) => { stack.push(name); hooks.push({ before: [], after: [] }); fn(); hooks.pop(); stack.pop(); };
globalThis.it = globalThis.test = (name, fn) => {
  const before = hooks.flatMap((h) => h.before), after = hooks.flatMap((h) => h.after).reverse();
  tests.push({ name: [...stack, name].join(' > '), fn, before, after });
};
globalThis.beforeEach = (fn) => { hooks[hooks.length - 1].before.push(fn); };
globalThis.afterEach = (fn) => { hooks[hooks.length - 1].after.push(fn); };
globalThis.beforeAll = globalThis.afterAll = () => {};
// it.each(rows)(name, fn): one test per row; %s placeholders are filled from the row
globalThis.it.each = globalThis.test.each = (rows) => (name, fn) => {
  for (const row of rows) {
    const args = Array.isArray(row) ? row : [row];
    let k = 0;
    const title = name.replace(/%[sdifjo]/g, () => String(args[k++]));
    globalThis.it(title, () => fn(...args));
  }
};
const mk = (actual, neg) => {
  const chk = (ok, msg) => { if (neg ? ok : !ok) throw new Error((neg ? 'NOT ' : '') + msg); };
  const m = {
    toBe: (e) => chk(Object.is(actual, e), `expected ${JSON.stringify(actual)} toBe ${JSON.stringify(e)}`),
    toEqual: (e) => { let ok = true; try { assert.deepEqual(actual, e); } catch { ok = false; } chk(ok, `expected ${JSON.stringify(actual)} toEqual ${JSON.stringify(e)}`); },
    toStrictEqual: (e) => { let ok = true; try { assert.deepStrictEqual(actual, e); } catch { ok = false; } chk(ok, `expected ${JSON.stringify(actual)} toStrictEqual ${JSON.stringify(e)}`); },
    toBeNull: () => chk(actual === null, `expected ${JSON.stringify(actual)} toBeNull`),
    toBeUndefined: () => chk(actual === undefined, `expected ${JSON.stringify(actual)} toBeUndefined`),
    toBeDefined: () => chk(actual !== undefined, `expected defined`),
    toBeTruthy: () => chk(!!actual, `expected truthy`), toBeFalsy: () => chk(!actual, `expected falsy`),
    toContain: (e) => chk(actual.includes(e), `expected ${JSON.stringify(actual)} toContain ${JSON.stringify(e)}`),
    toHaveLength: (n) => chk(actual.length === n, `expected length ${actual.length} toBe ${n}`),
    toBeGreaterThan: (n) => chk(actual > n, `expected ${actual} > ${n}`), toBeLessThan: (n) => chk(actual < n, `expected ${actual} < ${n}`),
    toBeGreaterThanOrEqual: (n) => chk(actual >= n, `expected ${actual} >= ${n}`), toBeLessThanOrEqual: (n) => chk(actual <= n, `expected ${actual} <= ${n}`),
    toMatch: (r) => chk(r.test(actual), `expected ${actual} toMatch ${r}`),
    toThrow: (want) => { let t = false, err; try { actual(); } catch (e) { t = true; err = e; } chk(t && throwMatches(err, want), 'expected throw' + (want ? ' matching ' + String(want) : '')); },
    toBeInstanceOf: (c) => chk(actual instanceof c, `expected instance of ${c && c.name}`),
    toBeCloseTo: (e, d = 2) => chk(Math.abs(actual - e) < Math.pow(10, -d) / 2, `expected ${actual} close to ${e}`),
    toMatchObject: (e) => { let ok = true; try { assert.partialDeepStrictEqual ? assert.partialDeepStrictEqual(actual, e) : assert.deepEqual(actual, e); } catch { ok = false; } chk(ok, 'toMatchObject'); },
  };
  return m;
};
const throwMatches = (err, want) => (want === undefined ? true : typeof want === 'string' ? String(err && err.message).includes(want) : want instanceof RegExp ? want.test(String(err && err.message)) : typeof want === 'function' ? err instanceof want : true);
// expect(promise).rejects.toThrow(..) / .rejects.toBeInstanceOf(..) / .resolves.toX(..): the matcher runs on the awaited value
const asyncMatchers = (p, kind) => new Proxy({}, { get: (_t, name) => async (...args) => {
  let value, threw = false;
  try { value = await p; } catch (e) { value = e; threw = true; }
  if (kind === 'rejects' && !threw) throw new Error('expected the promise to reject, it resolved');
  if (kind === 'resolves' && threw) throw new Error('expected the promise to resolve, it rejected: ' + (value && value.message));
  if (kind === 'rejects' && name === 'toThrow') return mk(() => { throw value; }, false).toThrow(...args);
  return mk(value, false)[name](...args);
} });
globalThis.expect = (a) => { const m = mk(a, false); m.not = mk(a, true); m.rejects = asyncMatchers(a, 'rejects'); m.resolves = asyncMatchers(a, 'resolves'); return m; };
// jest.useFakeTimers / setSystemTime / useRealTimers: only the clock (Date), which is all the specs use
{
  const RealDate = Date; let fixed = null;
  class FakeDate extends RealDate { constructor(...a) { if (a.length === 0 && fixed !== null) super(fixed); else super(...a); } static now() { return fixed !== null ? fixed : RealDate.now(); } }
  globalThis.jest = {
    mock: () => {},
    useFakeTimers: () => { fixed = RealDate.now(); globalThis.Date = FakeDate; return globalThis.jest; },
    setSystemTime: (t) => { fixed = +new RealDate(t); },
    useRealTimers: () => { fixed = null; globalThis.Date = RealDate; return globalThis.jest; },
  };
}
globalThis.__run = async () => {
  for (const t of tests) { try { for (const h of t.before) await h(); try { await t.fn(); } finally { for (const h of t.after) await h(); } pass++; } catch (e) { fail++; failures.push(t.name + ' :: ' + e.message); } }
  console.log(`PASS ${pass}  FAIL ${fail}`); failures.forEach(f => console.log('  FAIL', f)); process.exitCode = fail ? 1 : 0;
};
