/**
 * Smart nudges: PURE rules (no database, no clock) that decide which reminders a student should get right now.
 * The ticker (nudge.service.ts) gathers the facts, this file decides, notifications.service.ts delivers.
 *
 * Rules (one in-app message each, but at most ONE phone push per student per run, the most important one):
 *   RESUME   a test was left running (paused / closed the tab) and its time is not over
 *   STREAK   the student practised yesterday but not yet today (streak 2+): "save your streak"
 *   WEAK     there are weak topics waiting: "10 minutes on <topic>" (every 2nd day)
 *   COMEBACK no practice for 3-30 days (every 3rd day)
 * Daily rules only fire in the student's reminder hour (IST); RESUME fires any time, once per attempt.
 */

export type NudgeKind = 'RESUME' | 'STREAK' | 'WEAK' | 'COMEBACK';

export interface NudgePrefs {
  weakTopic: boolean;
  streak: boolean;
  tests: boolean;
  remindHourIst: number;
  pausedUntil: Date | null;
}

export const DEFAULT_PREFS: NudgePrefs = { weakTopic: true, streak: true, tests: true, remindHourIst: 19, pausedUntil: null };

export interface NudgeFacts {
  now: Date;
  istDay: string; // YYYY-MM-DD in IST
  istHour: number; // 0..23 in IST
  prefs: NudgePrefs;
  openAttempt: { id: string; startedAt: Date; expiresAt: Date | null } | null;
  weakCount: number;
  weakExample: string | null;
  currentStreak: number;
  lastPracticeDay: string | null; // YYYY-MM-DD in IST
  targetExamName: string | null;
}

export interface Nudge {
  kind: NudgeKind;
  title: string;
  body: string;
  url: string;
  dedupeKey: string;
  push: boolean;
}

const MS_DAY = 86_400_000;
const RESUME_AFTER_MS = 15 * 60_000;
const RESUME_MIN_LEFT_MS = 5 * 60_000;

/** Whole days since 1970 for a YYYY-MM-DD key. */
export function dayNumber(day: string): number {
  const t = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isNaN(t) ? NaN : Math.floor(t / MS_DAY);
}

export function daysBetween(fromDay: string, toDay: string): number {
  return dayNumber(toDay) - dayNumber(fromDay);
}

/** A student's reminder hour: whole hour 0..23, anything else falls back to 19 (7 pm). */
export function cleanHour(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 19;
}

export function decideNudges(f: NudgeFacts): Nudge[] {
  const p = f.prefs;
  if (p.pausedUntil && p.pausedUntil.getTime() > f.now.getTime()) return [];
  const out: Nudge[] = [];
  const goal = f.targetExamName ? ` (${f.targetExamName})` : '';

  if (p.tests && f.openAttempt) {
    const a = f.openAttempt;
    const idleMs = f.now.getTime() - a.startedAt.getTime();
    const leftMs = a.expiresAt ? a.expiresAt.getTime() - f.now.getTime() : Infinity;
    if (idleMs >= RESUME_AFTER_MS && leftMs >= RESUME_MIN_LEFT_MS) {
      out.push({
        kind: 'RESUME',
        title: 'Aapka test adhura hai ⏳',
        body: 'Ek test chal raha hai. Time khatam hone se pehle continue karke submit kar do.',
        url: `/test?resume=${a.id}`,
        dedupeKey: `resume:${a.id}`,
        push: true,
      });
    }
  }

  if (f.istHour === p.remindHourIst) {
    const today = dayNumber(f.istDay);
    const gap = f.lastPracticeDay ? daysBetween(f.lastPracticeDay, f.istDay) : null;

    if (p.streak && f.currentStreak >= 2 && gap === 1) {
      out.push({
        kind: 'STREAK',
        title: `🔥 ${f.currentStreak} din ki streak bachao`,
        body: `Aaj abhi tak practice nahi hui${goal}. 10 sawal kar lo, streak bani rahegi.`,
        url: '/question-bank-practice',
        dedupeKey: `streak:${f.istDay}`,
        push: true,
      });
    }

    if (p.weakTopic && f.weakCount > 0 && Number.isFinite(today) && today % 2 === 0 && gap !== 0) {
      const eg = f.weakExample ? `, jaise ${f.weakExample}` : '';
      out.push({
        kind: 'WEAK',
        title: `📉 ${f.weakCount} kamzor topic${f.weakCount > 1 ? 's' : ''} wait kar rahe hain`,
        body: `Test mein galat hue topics${eg}. 10 minute practice se strong ho jayenge.`,
        url: '/weak-topics',
        dedupeKey: `weak:${Math.floor(today / 2)}`,
        push: true,
      });
    }

    if (p.tests && gap !== null && gap >= 3 && gap <= 30 && Number.isFinite(today) && gap % 3 === 0) {
      out.push({
        kind: 'COMEBACK',
        title: `Aapko ${gap} din ho gaye 👋`,
        body: `Chhota sa test ya practice karke wapas track par aao${goal}.`,
        url: '/build-test',
        dedupeKey: `comeback:${f.istDay}`,
        push: true,
      });
    }
  }

  // one phone push per run: the first (most important) one keeps it, the rest stay in the in-app inbox only
  let pushed = false;
  return out.map((n) => {
    const push = n.push && !pushed;
    if (push) pushed = true;
    return { ...n, push };
  });
}
