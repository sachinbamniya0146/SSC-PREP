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
  /** NEW (A2): moving average of the latency (ms) of SUCCESSFUL calls; 0 = unknown */
  avgMs?: number;
}

export const MODEL_SKIP_AFTER = 3; // consecutive real failures (not 429) before a model is skipped
export const MODEL_SKIP_MS = 30 * 60 * 1000;

export function newHealth(): ModelHealth {
  return { ok: 0, fail: 0, consecFail: 0, skipUntil: 0, lastError: null, lastAt: 0 };
}

/** Returns the updated health record (pure). */
export function applyModelOutcome(h: ModelHealth | undefined, ok: boolean, error: string | null, now: number, ms?: number): ModelHealth {
  const cur = h ? { ...h } : newHealth();
  cur.lastAt = now;
  if (ok) {
    cur.ok += 1;
    cur.consecFail = 0;
    cur.skipUntil = 0;
    cur.lastError = null;
    if (typeof ms === 'number' && ms > 0) cur.avgMs = cur.avgMs ? Math.round(cur.avgMs * 0.7 + ms * 0.3) : Math.round(ms);
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

// ------------------------------------------------------------------ smart routing (NEW Oct 15 2026, A2)

/** Laplace-smoothed success rate, so 1/1 does not beat 95/100 */
export function successScore(h: ModelHealth | undefined): number {
  if (!h) return 0.5; // unknown models get a fair chance
  return (h.ok + 1) / (h.ok + h.fail + 2);
}

/**
 * Orders models by (success rate, then speed). The catalogue order (family preference) is the tie-break and the
 * base order for models that are still unknown. `offset` rotation is applied AFTER this by the caller.
 */
export function rankModels(list: string[], health: Map<string, ModelHealth>): string[] {
  return list
    .map((m, i) => ({ m, i, s: successScore(health.get(m)), ms: health.get(m)?.avgMs ?? 0 }))
    .sort((a, b) => {
      const ds = Math.round((b.s - a.s) * 10) - 0; // 10 % buckets: tiny differences do not reshuffle the list
      if (ds !== 0) return ds;
      if (a.ms && b.ms && Math.abs(a.ms - b.ms) > 1500) return a.ms - b.ms;
      return a.i - b.i;
    })
    .map((x) => x.m);
}

/** Hard ceiling for ONE generate() call across all keys and models (env AI_CALL_DEADLINE_MS, 1 s..15 min, default 150 s) */
export function callDeadlineMs(): number {
  const n = Number(process.env.AI_CALL_DEADLINE_MS);
  return Number.isFinite(n) && n >= 1_000 ? Math.min(n, 900_000) : 150_000;
}

export type KeyProblem = 'invalid' | 'no_credit' | 'forbidden_model' | 'rate_limit' | 'daily_limit' | 'unknown';

/**
 * What a failing key REALLY means. `verdict` is the answer of GET /key.
 *  401 + invalid key      -> invalid     (key switched off, admin told to replace it)
 *  402                    -> no_credit   (paid model / credit finished — free models may still work)
 *  403 + key valid        -> forbidden_model (ONE model refused; key is fine)
 *  429                    -> rate_limit / daily_limit (OpenRouter free: 50 req/day without credit)
 */
export function classifyKeyProblem(status: number, bodyText: string, verdict: 'valid' | 'invalid' | 'limit' | 'unknown'): KeyProblem {
  const t = String(bodyText || '').toLowerCase();
  if (verdict === 'invalid' || status === 401) return 'invalid';
  if (status === 429) return /per-day|daily|free-models-per-day/.test(t) ? 'daily_limit' : 'rate_limit';
  if (verdict === 'limit') return 'daily_limit';
  if (status === 402) return 'no_credit';
  if (status === 403) return 'forbidden_model';
  return 'unknown';
}

/** Clear Hinglish text for the admin — never contains the key */
export function keyProblemMessage(p: KeyProblem, keyName: string): string {
  const n = redact(keyName);
  switch (p) {
    case 'invalid': return `Key "${n}" OpenRouter ne reject ki (401) — key galat ya revoked hai. Nayi key banakar Admin → API Keys me badlein.`;
    case 'no_credit': return `Key "${n}" ka credit/limit khatam (402). Free models phir bhi chal sakte hain; paid model ke liye OpenRouter me credit daalein.`;
    case 'forbidden_model': return `Key "${n}" sahi hai, par ek model ne request mana ki (403) — dusra model try hota hai. Key band nahi ki gayi.`;
    case 'daily_limit': return `Key "${n}" ka aaj ka free quota khatam. Kal (UTC 00:00) tak rest ya nayi key add karein.`;
    case 'rate_limit': return `Key "${n}" abhi rate-limit par hai (429) — kuch der rest, phir khud chalegi.`;
    default: return `Key "${n}" par unknown error — System Check chalayein.`;
  }
}

/** pacing: when ready keys are fewer than wanted workers, never run more calls than ready keys (min 1) */
export function pacedConcurrency(wanted: number, readyKeys: number, hasGateway: boolean): number {
  if (hasGateway) return Math.max(1, wanted);
  return Math.max(1, Math.min(wanted, readyKeys));
}

/** tiny TTL cache key for identical prompts (djb2) */
export function promptHash(model: string, prompt: string): string {
  let h = 5381;
  const s = `${model}\u0000${prompt}`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}:${s.length}`;
}
