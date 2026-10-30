/**
 * S48 — pure rules of the test builder (no Nest, no Prisma — table-testable).
 *   - allocateWithCaps : how many questions each topic gets, by the exam's PYQ weightage, never more than the topic has
 *   - pickQuestions    : which questions of a topic: the test half first, ones the student has not seen first
 */

export interface WeightNode {
  key: string;
  /** how often the exam asked this topic in previous years (PYQ count) */
  weight: number;
  /** how many practice questions the topic has for tests */
  available: number;
}

/** Splits `total` over `weights` proportionally (largest remainder), always summing to exactly `total` when there is any weight. */
export function largestRemainder(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (Math.max(0, w) / sum) * total);
  const base = raw.map((r) => Math.floor(r));
  let left = total - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r), w: weights[i] }))
    .sort((a, b) => b.frac - a.frac || b.w - a.w || a.i - b.i);
  for (let k = 0; k < order.length && left > 0; k++, left--) base[order[k].i]++;
  return base;
}

/**
 * Weighted split with capacity: a topic that has fewer questions than its share gives the rest back, and the others share it by weight again.
 * Topics with no weight or no questions get nothing (an exam never asked it, or there is nothing to ask). `short` > 0 only when ALL topics together
 * cannot cover `total`.
 */
export function allocateWithCaps(total: number, nodes: WeightNode[]): { alloc: Record<string, number>; short: number } {
  const alloc: Record<string, number> = {};
  for (const n of nodes) alloc[n.key] = 0;
  let remaining = Math.max(0, Math.floor(total));
  let active = nodes.filter((n) => n.weight > 0 && n.available > 0);
  for (let guard = 0; guard < 50 && remaining > 0 && active.length > 0; guard++) {
    const share = largestRemainder(remaining, active.map((n) => n.weight));
    let gave = 0;
    const next: WeightNode[] = [];
    active.forEach((n, i) => {
      const room = n.available - alloc[n.key];
      const take = Math.min(room, share[i]);
      alloc[n.key] += take;
      gave += take;
      if (n.available - alloc[n.key] > 0) next.push(n);
    });
    remaining -= gave;
    if (gave === 0) break;
    active = next;
  }
  return { alloc, short: remaining };
}

export interface Candidate {
  id: string;
  reserved: boolean;
  seen: boolean;
}

/** Fisher-Yates with an injectable random (a spec passes a fixed one). */
export function shuffled<T>(arr: T[], rnd: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The test half first, questions the student has not met first; each group shuffled. Never returns the same id twice or an id in `used`. */
export function pickQuestions(cands: Candidate[], n: number, used: Set<string> = new Set(), rnd: () => number = Math.random): string[] {
  if (n <= 0) return [];
  const groups: Candidate[][] = [[], [], [], []];
  for (const c of cands) {
    if (used.has(c.id)) continue;
    groups[(c.reserved ? 0 : 2) + (c.seen ? 1 : 0)].push(c);
  }
  const out: string[] = [];
  const taken = new Set<string>();
  for (const g of groups) {
    for (const c of shuffled(g, rnd)) {
      if (out.length >= n) return out;
      if (taken.has(c.id)) continue;
      taken.add(c.id);
      out.push(c.id);
    }
  }
  return out;
}

/** How long a test of `n` questions gets when the student did not choose: 0.6 min per question (same pace as the year-wise tests), 10..180. */
export function defaultMinutes(n: number): number {
  return Math.min(180, Math.max(10, Math.round(n * 0.6)));
}

/** A student's own time choice: whole minutes, 5..300. Anything else falls back to the default for `n` questions. */
export function chosenMinutes(raw: unknown, n: number): number {
  const v = Number(raw);
  if (!Number.isFinite(v) || raw === '' || raw == null) return defaultMinutes(n);
  return Math.min(300, Math.max(5, Math.round(v)));
}
