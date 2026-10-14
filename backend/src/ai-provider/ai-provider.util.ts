// Pure helpers for the AI provider layer (NEW Oct 15 2026). No Nest / DB imports so they can be unit-tested alone.

/** Hide anything that looks like an API key before it reaches a log, an error message or the admin screen. */
export function redact(text: unknown): string {
  return String(text ?? '')
    .replace(/sk-or-[A-Za-z0-9_-]{8,}/g, 'sk-or-***')
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***')
    .replace(/(api[_-]?key["'\s:=]+)[A-Za-z0-9._-]{8,}/gi, '$1***');
}

/** Exponential backoff: 800ms, 1.6s, 3.2s ... capped at 8s, plus up to 25 % jitter. `rng` is injectable for tests. */
export function retryDelayMs(attempt: number, rng: () => number = Math.random): number {
  const unit = Number(process.env.AI_RETRY_BASE_MS) > 0 ? Number(process.env.AI_RETRY_BASE_MS) : 800;
  const base = Math.min(unit * 10, unit * Math.pow(2, Math.max(0, attempt)));
  return Math.round(base + base * 0.25 * rng());
}

/** Only these HTTP statuses are worth retrying on the SAME model. 429 is handled by rotating, 4xx are final. */
export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 500 || status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 524);
}

export const MAX_RESPONSE_CHARS = 400_000;
export const MAX_RETRIES = 2;
export const MAX_TOKENS_CAP = 6000;

export function clampTokens(requested: number | undefined, fallback = 3000): number {
  const n = Number.isFinite(requested) ? Number(requested) : fallback;
  return Math.min(MAX_TOKENS_CAP, Math.max(16, Math.round(n)));
}

/** Free models start at another position, so repeated verification passes use different models. */
export function rotateModels(list: string[], offset?: number): string[] {
  if (!offset || list.length < 2) return list;
  const k = ((offset % list.length) + list.length) % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
}

/** Keys that are resting after a 429 go to the back of the line (stable otherwise). */
export function orderKeysByCooldown<T extends { id: string }>(pool: T[], cooldown: Map<string, number>, now: number): T[] {
  return pool
    .map((k, i) => ({ k, i, rest: (cooldown.get(k.id) ?? 0) > now ? 1 : 0 }))
    .sort((a, b) => a.rest - b.rest || a.i - b.i)
    .map((x) => x.k);
}

export interface ModelHealth {
  ok: number;
  fail: number;
  consecFail: number;
  skipUntil: number;
  lastError: string | null;
  lastAt: number;
}

export const MODEL_SKIP_AFTER = 3; // consecutive real failures (not 429) before a model is skipped
export const MODEL_SKIP_MS = 30 * 60 * 1000;

export function newHealth(): ModelHealth {
  return { ok: 0, fail: 0, consecFail: 0, skipUntil: 0, lastError: null, lastAt: 0 };
}

/** Returns the updated health record (pure). */
export function applyModelOutcome(h: ModelHealth | undefined, ok: boolean, error: string | null, now: number): ModelHealth {
  const cur = h ? { ...h } : newHealth();
  cur.lastAt = now;
  if (ok) {
    cur.ok += 1;
    cur.consecFail = 0;
    cur.skipUntil = 0;
    cur.lastError = null;
  } else {
    cur.fail += 1;
    cur.consecFail += 1;
    cur.lastError = error ? redact(error).slice(0, 160) : null;
    if (cur.consecFail >= MODEL_SKIP_AFTER) cur.skipUntil = now + MODEL_SKIP_MS;
  }
  return cur;
}

/** Models that are currently skipped are dropped, but never ALL of them (then the full list is tried). */
export function usableModels(list: string[], health: Map<string, ModelHealth>, now: number): string[] {
  const ok = list.filter((m) => (health.get(m)?.skipUntil ?? 0) <= now);
  return ok.length ? ok : list;
}
