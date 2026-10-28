// Study plan - pure helpers for the "Aaj" (today) screen: IST day keys, the last-7-days activity strip, the active-day
// streak and the "am I on track?" estimate. No Nest, no Prisma: everything here is plain arithmetic so it can be
// unit-tested (study-plan-pace.util.spec.ts) and the numbers on the screen can be reproduced by hand.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/** "YYYY-MM-DD" of the IST calendar day that contains this instant (same rule as istDateKey() in gamification.service). */
export function istKey(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Start (00:00 IST) of the IST day `key`, as a UTC instant. */
export function istDayStart(key: string): Date {
  return new Date(new Date(`${key}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
}

/** The last `n` IST day keys, oldest first, the last one being `todayKey`. Pure date-key arithmetic (no time zones involved). */
export function lastDayKeys(todayKey: string, n: number): string[] {
  const base = new Date(`${todayKey}T00:00:00.000Z`).getTime();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(base - i * DAY_MS).toISOString().slice(0, 10));
  return out;
}

/** Questions answered per IST day. `rows` = one entry per test / practice attempt: when it started and how many questions were answered in it. */
export function bucketAnswered(rows: { startedAt: Date; answered: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!(r.answered > 0)) continue;
    const k = istKey(r.startedAt);
    m.set(k, (m.get(k) ?? 0) + r.answered);
  }
  return m;
}

/**
 * Days in a row (up to `maxDays`) with at least one answered question, counted back from today.
 * Today is allowed to be empty while the day is still running: the streak then counts from yesterday (same grace the
 * dashboard streak has), and breaks at the first empty day.
 */
export function activeStreak(counts: Map<string, number>, todayKey: string, maxDays: number): number {
  const keys = lastDayKeys(todayKey, maxDays).reverse(); // today first
  let i = 0;
  if (!((counts.get(keys[0]) ?? 0) > 0)) i = 1;
  let streak = 0;
  for (; i < keys.length; i++) {
    if ((counts.get(keys[i]) ?? 0) > 0) streak++;
    else break;
  }
  return streak;
}

export type PaceStatus = 'NO_DATA' | 'JUST_STARTED' | 'AHEAD' | 'ON_TRACK' | 'BEHIND';

export interface Pace {
  status: PaceStatus;
  /** chapters that should be covered by today if the student studied evenly until the revision reserve starts */
  expectedChapters: number;
  /** chapters already completed (95%+) or marked finished and waiting for their test */
  coveredChapters: number;
  /** covered - expected (negative = behind) */
  delta: number;
  elapsedDays: number;
  totalDays: number;
}

/**
 * "Am I on track?" - an ESTIMATE, not a promise.
 *  - the runway is start date -> exam date; the last ~20% (at least 3 days, only when the runway is longer than 10 days) is kept
 *    for revision and full mocks, the same reserve the daily plan uses;
 *  - the syllabus is expected to be covered evenly over the remaining study days;
 *  - AHEAD / BEHIND need a gap of at least 2 chapters, so one chapter either way is still "on track".
 */
export function paceOf(input: {
  totalChapters: number;
  completeChapters: number;
  selfMarkedChapters: number;
  startKey: string;
  targetKey: string;
  todayKey: string;
}): Pace {
  const day = (k: string) => Math.round(new Date(`${k}T00:00:00.000Z`).getTime() / DAY_MS);
  const totalDays = Math.max(1, day(input.targetKey) - day(input.startKey));
  const elapsedDays = Math.min(totalDays, Math.max(0, day(input.todayKey) - day(input.startKey)));
  const reserve = totalDays > 10 ? Math.max(3, Math.round(totalDays * 0.2)) : 0;
  const studyDays = Math.max(1, totalDays - reserve);
  const covered = Math.max(0, input.completeChapters) + Math.max(0, input.selfMarkedChapters);
  const expected = Math.round(Math.max(0, input.totalChapters) * Math.min(1, elapsedDays / studyDays));
  const delta = covered - expected;
  let status: PaceStatus;
  if (input.totalChapters <= 0) status = 'NO_DATA';
  else if (elapsedDays === 0) status = 'JUST_STARTED';
  else if (delta >= 2) status = 'AHEAD';
  else if (delta <= -2) status = 'BEHIND';
  else status = 'ON_TRACK';
  return { status, expectedChapters: expected, coveredChapters: covered, delta, elapsedDays, totalDays };
}

export const DAILY_TARGET_MIN = 25;
export const DAILY_TARGET_MAX = 100;

/** Daily practice target for a plan: 25-100 questions, rounded to steps of 5 (a free student can do 5 sets x 25 a day, and 100 is a hard-but-real day). */
export function clampDailyTarget(raw: number): number {
  const n = Number.isFinite(raw) ? raw : 0;
  return Math.min(DAILY_TARGET_MAX, Math.max(DAILY_TARGET_MIN, Math.round(n / 5) * 5));
}
