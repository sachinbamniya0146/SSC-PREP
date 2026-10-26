/**
 * Offline-safe test submit.
 *
 * Problem: when a student's internet drops during a timed test, the timer keeps running on the device, the final
 * POST /tests/attempts/:id/submit fails, and the student either lost the test or saw an empty result.
 *
 * Fix: (1) every answer change is mirrored to localStorage (a "draft"), (2) when the final submit cannot reach the
 * server it is queued in localStorage together with the moment the student finished (clientSubmittedAt), and
 * (3) the queue is replayed automatically when the network returns — even if the tab was closed in between and the
 * student opens the app again later. The backend honours answers whose finish time was inside the test window.
 */
import { fetchAuth } from "@/lib/api";
import { getApiBase } from "@/lib/api-base";

const QUEUE_KEY = "ssc_pending_submits";
const DRAFT_PREFIX = "ssc_attempt_draft_";
const START_PREFIX = "ssc_attempt_start_";

export type PendingSubmit = {
  attemptId: string;
  answers: { questionId: string; selectedOption: string | null; timeSpentSeconds?: number }[];
  clientSubmittedAt: number;
  queuedAt: number;
  // Sectional-timer attempts: { [questionId]: server-time ms at which the answer was given } so a late
  // replay can be checked against the right section window (see backend canAcceptLateWrite).
  answeredAt?: Record<string, number>;
};

type Draft = { answers: Record<string, string>; timeSpent: Record<string, number>; savedAt: number; answeredAt?: Record<string, number> };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / private mode — nothing else we can do */
  }
}

// ---- drafts (live answers mirrored on the device) ----
export function saveDraft(attemptId: string, answers: Record<string, string>, timeSpent: Record<string, number>, answeredAt?: Record<string, number>) {
  if (typeof window === "undefined" || !attemptId) return;
  write(DRAFT_PREFIX + attemptId, { answers, timeSpent, savedAt: Date.now(), ...(answeredAt ? { answeredAt } : {}) } as Draft);
}
export function loadDraft(attemptId: string): Draft | null {
  if (typeof window === "undefined" || !attemptId) return null;
  return read<Draft | null>(DRAFT_PREFIX + attemptId, null);
}
export function clearDraft(attemptId: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(DRAFT_PREFIX + attemptId);
  } catch {
    /* ignore */
  }
}

// ---- attempt-start stash ----
// A reload / app restart in the middle of a test calls POST /tests/attempts/start again to RESUME the attempt.
// Offline that call fails, and the page used to carry on with NO attempt (answers could never be submitted).
// So the start response (attempt id, server clock, deadline, section plan) is kept here and re-used while offline.
// It is only a resume hint: the server still owns the clock and re-checks every answer on delivery.
export type AttemptStartStash = {
  id: string;
  serverNow?: number;
  startedAt?: string;
  expiresAt?: string;
  plan?: unknown;
  scribe?: boolean;
  stashedAt: number;
  /** the local clock when serverNow was read: lets the page rebuild the server clock offset offline */
  localAt: number;
};

export function saveAttemptStart(key: string, data: Omit<AttemptStartStash, "stashedAt" | "localAt">) {
  if (typeof window === "undefined" || !key || !data?.id) return;
  write(START_PREFIX + key, { ...data, stashedAt: Date.now(), localAt: Date.now() } as AttemptStartStash);
}
/** Returns the stash only while the attempt can still be running (deadline + 10 min of slack for late delivery). */
export function loadAttemptStart(key: string): AttemptStartStash | null {
  if (typeof window === "undefined" || !key) return null;
  const st = read<AttemptStartStash | null>(START_PREFIX + key, null);
  if (!st?.id) return null;
  const end = st.expiresAt ? new Date(st.expiresAt).getTime() : st.stashedAt + 6 * 3600 * 1000;
  const skew = st.serverNow ? st.serverNow - st.localAt : 0;
  if (Date.now() + skew > end + 10 * 60 * 1000) {
    clearAttemptStart(key);
    return null;
  }
  return st;
}
export function clearAttemptStart(key: string) {
  if (typeof window === "undefined" || !key) return;
  try {
    localStorage.removeItem(START_PREFIX + key);
  } catch {
    /* ignore */
  }
}
/** Drop the stash that belongs to an attempt id (after submit), whatever key it was saved under. */
export function clearAttemptStartById(attemptId: string) {
  if (typeof window === "undefined" || !attemptId) return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(START_PREFIX)) continue;
      if (read<AttemptStartStash | null>(k, null)?.id === attemptId) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

/** Old drafts / start stashes of tests that finished long ago would fill localStorage forever. */
export function pruneOfflineJunk(maxAgeDays = 3) {
  if (typeof window === "undefined") return;
  try {
    const pending = new Set(getPendingSubmits().map((p) => p.attemptId));
    const cutoff = Date.now() - maxAgeDays * 86400000;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith(DRAFT_PREFIX)) {
        const id = k.slice(DRAFT_PREFIX.length);
        const d = read<Draft | null>(k, null);
        if (!pending.has(id) && (!d || d.savedAt < cutoff)) localStorage.removeItem(k);
      } else if (k.startsWith(START_PREFIX)) {
        const st = read<AttemptStartStash | null>(k, null);
        if (!st || st.stashedAt < cutoff) localStorage.removeItem(k);
      }
    }
  } catch {
    /* ignore */
  }
}

/** For the status screen: tests still running / waiting on this device. */
export function listLocalAttempts(): { attemptId: string; savedAt: number; answered: number; queued: boolean }[] {
  if (typeof window === "undefined") return [];
  const out: { attemptId: string; savedAt: number; answered: number; queued: boolean }[] = [];
  const pending = new Set(getPendingSubmits().map((p) => p.attemptId));
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(DRAFT_PREFIX)) continue;
      const d = read<Draft | null>(k, null);
      if (!d) continue;
      const id = k.slice(DRAFT_PREFIX.length);
      out.push({ attemptId: id, savedAt: d.savedAt, answered: Object.keys(d.answers || {}).length, queued: pending.has(id) });
    }
  } catch {
    /* ignore */
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

// ---- queue ----
export function getPendingSubmits(): PendingSubmit[] {
  if (typeof window === "undefined") return [];
  const list = read<PendingSubmit[]>(QUEUE_KEY, []);
  return Array.isArray(list) ? list : [];
}
export function hasPendingSubmit(attemptId: string): boolean {
  return getPendingSubmits().some((p) => p.attemptId === attemptId);
}
export function queueSubmit(item: Omit<PendingSubmit, "queuedAt">) {
  const rest = getPendingSubmits().filter((p) => p.attemptId !== item.attemptId);
  write(QUEUE_KEY, [...rest, { ...item, queuedAt: Date.now() }]);
}
function dropPending(attemptId: string) {
  write(
    QUEUE_KEY,
    getPendingSubmits().filter((p) => p.attemptId !== attemptId),
  );
}

/**
 * Try to send every queued submit. Returns the attempt ids that are now safely stored on the server
 * (submitted now, or the server already had them). Network errors keep the item queued for the next try;
 * a permanent rejection (4xx other than "already submitted") is dropped so it can never loop forever.
 */
let flushing: Promise<string[]> | null = null;
export function flushPendingSubmits(): Promise<string[]> {
  // one replay at a time: the manager, the exam screen and the offline hub may all ask at the same moment
  if (!flushing) flushing = flushNow().finally(() => (flushing = null));
  return flushing;
}

async function flushNow(): Promise<string[]> {
  if (typeof window === "undefined") return [];
  const done: string[] = [];
  for (const item of getPendingSubmits()) {
    try {
      const res = await fetchAuth(`${getApiBase()}/tests/attempts/${item.attemptId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: item.answers, clientSubmittedAt: item.clientSubmittedAt, ...(item.answeredAt ? { answeredAt: item.answeredAt } : {}) }),
      });
      if (res.ok) {
        dropPending(item.attemptId);
        clearDraft(item.attemptId);
        clearAttemptStartById(item.attemptId);
        done.push(item.attemptId);
        continue;
      }
      const body = await res.json().catch(() => ({}));
      if (/already submitted/i.test(body?.message || "")) {
        dropPending(item.attemptId);
        clearDraft(item.attemptId);
        clearAttemptStartById(item.attemptId);
        done.push(item.attemptId);
      } else if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408 && res.status !== 429) {
        dropPending(item.attemptId); // permanent rejection
      }
      // 5xx / 401 / 429: keep it, try again later
    } catch {
      /* still offline — keep queued */
    }
  }
  return done;
}
