// Rank maths for one test (pure functions, no Nest / Prisma imports so they can be unit-tested alone).
//
// Rules (chosen to be fair and to match how real exams are ranked):
//  * One row per student: their FIRST finished attempt of that test. A retake is practice - the student has seen the
//    answers by then - so it never pushes anybody else down and never occupies a second rank slot.
//  * Order: higher score first; on equal score the faster finisher is ahead; equal on both = same rank (a tie).
//  * rank = 1 + number of students strictly ahead.  percentile = share of students NOT ahead of you (you included).
//  * State rank = the same rule among students who chose the same state.

export interface RankRow {
  attemptId: string;
  userId: string;
  name: string;
  state: string | null;
  score: number;
  accuracy: number;
  durationSec: number;
}

export interface RawAttempt {
  attemptId: string;
  userId: string;
  name: string | null;
  state: string | null;
  score: number | null;
  accuracy: number | null;
  startedAt: Date | string | null;
  submittedAt: Date | string | null;
}

export interface RankPlace {
  rank: number;
  outOf: number;
  percentile: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function durationOf(startedAt: Date | string | null, submittedAt: Date | string | null): number {
  if (!startedAt || !submittedAt) return 0;
  const ms = new Date(submittedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
}

/** Keeps only each student's earliest attempt. `rows` may come in any order. */
export function firstAttemptPerUser(rows: RawAttempt[]): RankRow[] {
  const sorted = [...rows].sort((a, b) => {
    const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return ta - tb || a.attemptId.localeCompare(b.attemptId);
  });
  const seen = new Set<string>();
  const out: RankRow[] = [];
  for (const r of sorted) {
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    out.push({
      attemptId: r.attemptId,
      userId: r.userId,
      name: r.name || 'Student',
      state: r.state || null,
      score: r.score ?? 0,
      accuracy: r.accuracy ?? 0,
      durationSec: durationOf(r.startedAt, r.submittedAt),
    });
  }
  return out;
}

/** true when `a` is strictly ahead of `b`. */
export function isAhead(a: { score: number; durationSec: number }, b: { score: number; durationSec: number }): boolean {
  if (a.score !== b.score) return a.score > b.score;
  // a missing duration (0) must not beat a real one
  const da = a.durationSec > 0 ? a.durationSec : Number.POSITIVE_INFINITY;
  const db = b.durationSec > 0 ? b.durationSec : Number.POSITIVE_INFINITY;
  return da < db;
}

export function sortRows(rows: RankRow[]): RankRow[] {
  return [...rows].sort((a, b) => (isAhead(a, b) ? -1 : isAhead(b, a) ? 1 : a.userId.localeCompare(b.userId)));
}

/** Where a (score, duration) lands among `pool` (pool must NOT already contain the person being placed). */
export function placeAmong(pool: Array<{ score: number; durationSec: number }>, me: { score: number; durationSec: number }): RankPlace {
  let ahead = 0;
  for (const p of pool) if (isAhead(p, me)) ahead++;
  const outOf = pool.length + 1;
  return { rank: ahead + 1, outOf, percentile: round1(((outOf - ahead) / outOf) * 100) };
}

/** Standing of one student inside the (first-attempt) rows. null when the student is not in them. */
export function standingOf(rows: RankRow[], userId: string): RankPlace | null {
  const me = rows.find((r) => r.userId === userId);
  if (!me) return null;
  return placeAmong(rows.filter((r) => r.userId !== userId), me);
}

export function isRetake(rows: RankRow[], userId: string, attemptId: string): boolean {
  const first = rows.find((r) => r.userId === userId);
  return !!first && first.attemptId !== attemptId;
}

/** "Rahul Sharma" -> "Rahul S."  (leaderboards never show full names of other students). */
export function shortName(full: string): string {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Student';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export interface RankedRow extends RankRow {
  rank: number;
}

/** Adds competition ranks (1,2,2,4 ...) to rows that are already sorted best-first. */
export function withRanks(sorted: RankRow[]): RankedRow[] {
  const out: RankedRow[] = [];
  sorted.forEach((r, i) => {
    const prev = out[i - 1];
    const rank = !prev ? 1 : isAhead(prev, r) ? i + 1 : prev.rank;
    out.push({ ...r, rank });
  });
  return out;
}
