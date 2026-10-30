import { allocateWithCaps, chosenMinutes, defaultMinutes, largestRemainder, pickQuestions } from './test-blueprint';

describe('test builder rules (S48)', () => {
  it('largest remainder always sums to the total', () => {
    expect(largestRemainder(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(largestRemainder(25, [50, 30, 20]).reduce((a, b) => a + b, 0)).toBe(25);
    expect(largestRemainder(0, [1, 2])).toEqual([0, 0]);
    expect(largestRemainder(5, [0, 0])).toEqual([0, 0]);
  });
  it('topics are asked in proportion to how often the exam asked them', () => {
    const r = allocateWithCaps(10, [{ key: 'a', weight: 60, available: 99 }, { key: 'b', weight: 30, available: 99 }, { key: 'c', weight: 10, available: 99 }]);
    expect(r.alloc).toEqual({ a: 6, b: 3, c: 1 });
    expect(r.short).toBe(0);
  });
  it('a topic the exam never asked (weight 0) gets nothing, even if it has many questions', () => {
    const r = allocateWithCaps(10, [{ key: 'asked', weight: 5, available: 50 }, { key: 'never', weight: 0, available: 500 }]);
    expect(r.alloc.never).toBe(0);
    expect(r.alloc.asked).toBe(10);
  });
  it('a topic with too few questions gives the rest to the others, by weight', () => {
    const r = allocateWithCaps(10, [{ key: 'a', weight: 50, available: 2 }, { key: 'b', weight: 30, available: 99 }, { key: 'c', weight: 20, available: 99 }]);
    expect(r.alloc.a).toBe(2);
    expect(r.alloc.b + r.alloc.c).toBe(8);
    expect(r.alloc.b).toBeGreaterThan(r.alloc.c);
    expect(r.short).toBe(0);
  });
  it('short is reported only when every topic together cannot cover the total', () => {
    const r = allocateWithCaps(10, [{ key: 'a', weight: 1, available: 3 }, { key: 'b', weight: 1, available: 2 }]);
    expect(r.alloc).toEqual({ a: 3, b: 2 });
    expect(r.short).toBe(5);
  });
  it('never gives a topic more than it has, whatever the weights', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({ key: 'n' + i, weight: (i + 1) * 3, available: (i % 4) + 1 }));
    const r = allocateWithCaps(40, nodes);
    for (const n of nodes) expect(r.alloc[n.key]).toBeLessThanOrEqual(n.available);
    expect(Object.values(r.alloc).reduce((a, b) => a + b, 0) + r.short).toBe(40);
  });

  const cands = [
    { id: 'r1', reserved: true, seen: false },
    { id: 'r2', reserved: true, seen: true },
    { id: 'v1', reserved: false, seen: false },
    { id: 'v2', reserved: false, seen: true },
  ];
  const fixed = () => 0.3;
  it('the test half is used first, unseen before seen, then the visible half', () => {
    expect(pickQuestions(cands, 1, new Set(), fixed)).toEqual(['r1']);
    expect(pickQuestions(cands, 2, new Set(), fixed)).toEqual(['r1', 'r2']);
    expect(pickQuestions(cands, 3, new Set(), fixed)).toEqual(['r1', 'r2', 'v1']);
    expect(pickQuestions(cands, 9, new Set(), fixed)).toHaveLength(4);
  });
  it('a question already in the test is never picked again', () => {
    const got = pickQuestions(cands, 4, new Set(['r1', 'v1']), fixed);
    expect(got).not.toContain('r1');
    expect(got).not.toContain('v1');
    expect(new Set(got).size).toBe(got.length);
  });
  it('minutes: the default is 0.6 per question within 10..180; a choice is clamped to 5..300; junk falls back', () => {
    expect(defaultMinutes(100)).toBe(60);
    expect(defaultMinutes(5)).toBe(10);
    expect(defaultMinutes(1000)).toBe(180);
    expect(chosenMinutes(45, 100)).toBe(45);
    expect(chosenMinutes(1, 100)).toBe(5);
    expect(chosenMinutes(9999, 100)).toBe(300);
    expect(chosenMinutes('abc', 100)).toBe(60);
    expect(chosenMinutes('', 100)).toBe(60);
    expect(chosenMinutes(null, 20)).toBe(12);
  });
});

describe('allocateWithCaps coverAll', () => {
  const nodes = [
    { key: 'a', weight: 90, available: 50 },
    { key: 'b', weight: 5, available: 50 },
    { key: 'c', weight: 5, available: 50 },
    { key: 'd', weight: 0, available: 50 }, // never asked: still nothing
    { key: 'e', weight: 10, available: 0 }, // nothing to ask: still nothing
  ];
  it('without coverAll a tiny topic can get nothing', () => {
    const r = allocateWithCaps(10, nodes);
    expect(r.alloc.b + r.alloc.c).toBeLessThan(3);
  });
  it('with coverAll every asked topic that has questions gets at least one, the rest follows the weights', () => {
    const r = allocateWithCaps(10, nodes, true);
    expect(r.alloc.b).toBeGreaterThanOrEqual(1);
    expect(r.alloc.c).toBeGreaterThanOrEqual(1);
    expect(r.alloc.a).toBeGreaterThan(r.alloc.b);
    expect(r.alloc.d).toBe(0);
    expect(r.alloc.e).toBe(0);
    expect(r.alloc.a + r.alloc.b + r.alloc.c).toBe(10);
    expect(r.short).toBe(0);
  });
  it('with fewer questions than topics the weights decide', () => {
    const r = allocateWithCaps(2, nodes, true);
    expect(r.alloc.a + r.alloc.b + r.alloc.c).toBe(2);
    expect(r.alloc.a).toBe(2);
  });
  it('a one-question topic is not over-filled', () => {
    const r = allocateWithCaps(10, [{ key: 'x', weight: 1, available: 1 }, { key: 'y', weight: 1, available: 100 }], true);
    expect(r.alloc.x).toBe(1);
    expect(r.alloc.y).toBe(9);
  });
});
