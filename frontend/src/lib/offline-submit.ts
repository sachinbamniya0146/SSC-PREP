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

export type PendingSubmit = {
  attemptId: string;
  answers: { questionId: string; selectedOption: string | null; timeSpentSeconds?: number }[];
  clientSubmittedAt: number;
  queuedAt: number;
};

type Draft = { answers: Record<string, string>; timeSpent: Record<string, number>; savedAt: number };

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
export function saveDraft(attemptId: string, answers: Record<string, string>, timeSpent: Record<string, number>) {
  if (typeof window === "undefined" || !attemptId) return;
  write(DRAFT_PREFIX + attemptId, { answers, timeSpent, savedAt: Date.now() } as Draft);
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
export async function flushPendingSubmits(): Promise<string[]> {
  if (typeof window === "undefined") return [];
  const done: string[] = [];
  for (const item of getPendingSubmits()) {
    try {
      const res = await fetchAuth(`${getApiBase()}/tests/attempts/${item.attemptId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: item.answers, clientSubmittedAt: item.clientSubmittedAt }),
      });
      if (res.ok) {
        dropPending(item.attemptId);
        clearDraft(item.attemptId);
        done.push(item.attemptId);
        continue;
      }
      const body = await res.json().catch(() => ({}));
      if (/already submitted/i.test(body?.message || "")) {
        dropPending(item.attemptId);
        clearDraft(item.attemptId);
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
