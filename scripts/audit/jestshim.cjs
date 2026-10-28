const assert = require('node:assert/strict');
let pass = 0, fail = 0; const failures = []; const stack = [];
const tests = [];
globalThis.describe = (name, fn) => { stack.push(name); fn(); stack.pop(); };
globalThis.it = globalThis.test = (name, fn) => { tests.push({ name: [...stack, name].join(' > '), fn }); };
globalThis.beforeEach = globalThis.afterEach = globalThis.beforeAll = globalThis.afterAll = () => {};
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
    toThrow: () => { let t = false; try { actual(); } catch { t = true; } chk(t, 'expected throw'); },
    toBeCloseTo: (e, d = 2) => chk(Math.abs(actual - e) < Math.pow(10, -d) / 2, `expected ${actual} close to ${e}`),
    toMatchObject: (e) => { let ok = true; try { assert.partialDeepStrictEqual ? assert.partialDeepStrictEqual(actual, e) : assert.deepEqual(actual, e); } catch { ok = false; } chk(ok, 'toMatchObject'); },
  };
  return m;
};
globalThis.expect = (a) => { const m = mk(a, false); m.not = mk(a, true); return m; };
globalThis.__run = async () => {
  for (const t of tests) { try { await t.fn(); pass++; } catch (e) { fail++; failures.push(t.name + ' :: ' + e.message); } }
  console.log(`PASS ${pass}  FAIL ${fail}`); failures.forEach(f => console.log('  FAIL', f)); process.exitCode = fail ? 1 : 0;
};
