import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { AdminApiKeyService } from '../admin-api-keys/admin-api-keys.service';
import {
  MAX_RESPONSE_CHARS,
  MAX_RETRIES,
  ModelHealth,
  applyModelOutcome,
  clampTokens,
  isTransientStatus,
  orderKeysByCooldown,
  redact,
  retryDelayMs,
  rotateModels,
  usableModels,
} from './ai-provider.util';

export interface AiGenerateResult {
  content: string;
  model: string;
  source: 'USER_KEY' | 'ADMIN_KEY' | 'GATEWAY';
  adminKeyId?: string;
  adminKeyName?: string;
}

/** Options every caller can pass. `feature` is what the admin sees in the key usage log. */
export interface AiGenerateOptions {
  userApiKey?: string | null;
  provider?: string;
  jsonResponse?: boolean;
  maxTokens?: number;
  /** NEW (Oct 7 2026): name of the feature that makes the call, e.g. 'AI_EXPLANATION'. Logged per key. */
  feature?: string;
  /** NEW: start the free-model list at another position, so repeated verification passes use different models. */
  modelOffset?: number;
  /** NEW (Oct 15 2026): per-request timeout in ms (default 45 s). */
  timeoutMs?: number;
  /** NEW (Oct 15 2026): free-text label of what is being worked on, shown in the live status ("Q#123 · pass 2/5"). */
  note?: string;
}

/** NEW (Oct 14 2026): what the admin sees LIVE on Admin → API Keys. */
export interface LiveCall {
  id: number;
  keyId: string | null;
  keyName: string;
  feature: string;
  model: string | null;
  startedAt: number;
  note: string | null;
}
export interface LiveEvent {
  at: number;
  keyId: string | null;
  keyName: string;
  feature: string;
  model: string | null;
  success: boolean;
  ms: number;
  error: string | null;
}
const MAX_EVENTS = 40;

export interface KeyTestResult {
  ok: boolean;
  status: 'working' | 'invalid' | 'rate_limited' | 'error';
  message: string;
  model?: string;
}

// ---------------------------------------------------------------------------
// Free models only (rewritten Oct 3 2026)
//
// OpenRouter keeps renaming / retiring its ":free" models, so a hard-coded list
// goes stale and every call fails. Now the list is read LIVE from OpenRouter's
// public catalogue (only models whose prompt AND completion price are 0 and whose
// id ends in ":free"), cached for an hour, with the old static list as a fallback.
// An OPENROUTER_MODEL env value (must end in ":free") is still tried first.
// ---------------------------------------------------------------------------
const FALLBACK_FREE_MODELS: string[] = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemini-2.0-flash-exp:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'meta-llama/llama-3.1-8b-instruct:free',
];
// families that follow instructions + JSON + Hindi best, tried first when present
const PREFERRED = ['llama-3.3-70b', 'gemini', 'qwen', 'deepseek', 'gpt-oss', 'nemotron', 'mistral', 'llama'];

const MODELS_TTL_MS = 60 * 60 * 1000;
const KEY_COOLDOWN_MS = 90 * 1000; // a rate-limited key rests for 90 s, then is used again
const REQUEST_TIMEOUT_MS = 45_000;
const HEALTH_EVERY_MS = 60 * 60 * 1000; // NEW: model health check once an hour
// NEW: OPENROUTER_BASE_URL lets tests (and a proxy) point at another host; default = real OpenRouter
const openRouterBase = () => (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');

/** 401/403 = the key itself is wrong/revoked. 429 = only a rate limit — NEVER a dead key. */
function looksDead(status: number, bodyText: string): boolean {
  if (status === 401 || status === 403) return true;
  if (status === 402) return true; // no credit at all
  if (status === 429) return false;
  const t = bodyText.toLowerCase();
  return t.includes('invalid api key') || t.includes('no auth credentials') || t.includes('user not found');
}

type CallOutcome =
  | { kind: 'ok'; content: string }
  | { kind: 'dead'; detail: string }
  | { kind: 'rate' }
  | { kind: 'nojson' }
  | { kind: 'transient'; detail: string }
  | { kind: 'fail'; detail: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

@Injectable()
export class AiProviderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiProviderService.name);
  private modelsCache: { at: number; list: string[] } | null = null;
  private readonly cooldown = new Map<string, number>();
  private readonly activeCalls = new Map<number, LiveCall>();
  private readonly events: LiveEvent[] = [];
  private readonly modelHealth = new Map<string, ModelHealth>();
  private healthTimer: NodeJS.Timeout | null = null;
  private healthFirst: NodeJS.Timeout | null = null;
  private lastHealthAt: number | null = null;
  private seq = 0;

  constructor(private readonly adminApiKeys: AdminApiKeyService) {}

  onModuleInit() {
    if ((process.env.AI_MODEL_HEALTH || '').toLowerCase() === 'off') return;
    this.healthFirst = setTimeout(() => void this.runModelHealthCheck(), 2 * 60 * 1000);
    this.healthFirst.unref?.();
    this.healthTimer = setInterval(() => void this.runModelHealthCheck(), HEALTH_EVERY_MS);
    this.healthTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.healthFirst) clearTimeout(this.healthFirst);
  }

  // ---------------------------------------------------------------- gateway (optional OpenAI-compatible fallback)

  gatewayConfig(): { baseUrl: string; apiKey: string; model: string } | null {
    const baseUrl = (process.env.OPENAI_BASE_URL || '').trim().replace(/\/+$/, '');
    const apiKey = (process.env.OPENAI_API_KEY || '').trim();
    if (!baseUrl || !apiKey) return null;
    return { baseUrl, apiKey, model: (process.env.OPENAI_MODEL || 'openrouter/free').trim() };
  }

  /** the free models that will be tried, best first */
  async getFreeModels(force = false): Promise<string[]> {
    const env = (process.env.OPENROUTER_MODEL || '').trim();
    const head = env && env.endsWith(':free') ? [env] : [];
    if (!force && this.modelsCache && Date.now() - this.modelsCache.at < MODELS_TTL_MS) return [...head, ...this.modelsCache.list.filter((m) => m !== env)];
    let list: string[] = [];
    try {
      const res = await fetch(`${openRouterBase()}/models`, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const data: any = await res.json();
        list = (data?.data ?? [])
          .filter((m: any) => typeof m?.id === 'string' && m.id.endsWith(':free') && Number(m?.pricing?.prompt ?? 1) === 0 && Number(m?.pricing?.completion ?? 1) === 0)
          // text-in/text-out chat models only
          .filter((m: any) => !Array.isArray(m?.architecture?.output_modalities) || m.architecture.output_modalities.includes('text'))
          .sort((a: any, b: any) => {
            const ra = PREFERRED.findIndex((p) => a.id.includes(p));
            const rb = PREFERRED.findIndex((p) => b.id.includes(p));
            return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || (Number(b.context_length) || 0) - (Number(a.context_length) || 0);
          })
          .map((m: any) => m.id as string)
          .slice(0, 8);
      }
    } catch {
      /* offline / blocked -> fallback list below */
    }
    const fromCatalogue = list.length > 0;
    if (!fromCatalogue) list = [...FALLBACK_FREE_MODELS];
    this.modelsCache = { at: Date.now(), list };
    return [...head, ...list.filter((m) => m !== env)];
  }

  /** NEW: same list, but models that failed 3 times in a row are skipped for 30 minutes. */
  async getUsableModels(): Promise<string[]> {
    return usableModels(await this.getFreeModels(), this.modelHealth, Date.now());
  }

  // ---------------------------------------------------------------- live status (NEW Oct 14 2026)

  private beginCall(keyId: string | null, keyName: string, feature: string, note?: string): LiveCall {
    const call: LiveCall = { id: ++this.seq, keyId, keyName, feature, model: null, startedAt: Date.now(), note: note ?? null };
    this.activeCalls.set(call.id, call);
    return call;
  }

  private endCall(call: LiveCall, success: boolean, error?: string | null) {
    this.activeCalls.delete(call.id);
    this.events.unshift({
      at: Date.now(),
      keyId: call.keyId,
      keyName: call.keyName,
      feature: call.feature,
      model: call.model,
      success,
      ms: Date.now() - call.startedAt,
      error: error ? redact(error).slice(0, 200) : null,
    });
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
  }

  /** How many keys can take work right now (active, not resting) — the job engine sizes its concurrency with this. */
  async keyAvailability(provider = 'openrouter'): Promise<{ active: number; ready: number; resting: number; minRestSec: number }> {
    let pool: Array<{ id: string }> = [];
    try {
      pool = await this.adminApiKeys.getRotationPool(provider);
    } catch {
      /* DB hiccup */
    }
    const now = Date.now();
    const resting = pool.filter((k) => (this.cooldown.get(k.id) ?? 0) > now);
    const minRest = resting.length ? Math.min(...resting.map((k) => this.cooldown.get(k.id)! - now)) : 0;
    return { active: pool.length, ready: pool.length - resting.length, resting: resting.length, minRestSec: Math.ceil(minRest / 1000) };
  }

  /** Real-time picture for the admin screen: which key is working on what right now, which key is resting, last calls. */
  async getLiveStatus() {
    const now = Date.now();
    let keys: Array<{ id: string; keyName: string; isActive: boolean; isPrimary: boolean; lastErrorMessage: string | null; exhaustedAt: Date | null }> = [];
    try {
      keys = (await this.adminApiKeys.getKeys('openrouter')) as typeof keys;
    } catch {
      /* DB hiccup: still return the in-memory part */
    }
    const active = Array.from(this.activeCalls.values());
    const gw = this.gatewayConfig();
    return {
      now,
      working: active.length,
      active: active.map((c) => ({ keyId: c.keyId, keyName: c.keyName, feature: c.feature, model: c.model, note: c.note, runningSec: Math.round((now - c.startedAt) / 1000) })),
      keys: keys.map((k) => {
        const call = active.find((c) => c.keyId === k.id);
        const restUntil = this.cooldown.get(k.id) ?? 0;
        const restSec = restUntil > now ? Math.ceil((restUntil - now) / 1000) : 0;
        const state = !k.isActive ? 'off' : call ? 'working' : restSec > 0 ? 'resting' : 'idle';
        return {
          id: k.id,
          keyName: k.keyName,
          isActive: k.isActive,
          isPrimary: k.isPrimary,
          state,
          restSec,
          feature: call?.feature ?? null,
          model: call?.model ?? null,
          note: call?.note ?? null,
          runningSec: call ? Math.round((now - call.startedAt) / 1000) : 0,
          lastError: k.isActive ? null : k.lastErrorMessage,
        };
      }),
      gateway: gw ? { configured: true, model: gw.model } : { configured: false, model: null },
      lastHealthAt: this.lastHealthAt,
      models: this.getModelStats(),
      recent: this.events.slice(0, 25),
    };
  }

  /** Per-model success rate since the last restart + whether it is currently skipped. */
  getModelStats() {
    const now = Date.now();
    return Array.from(this.modelHealth.entries())
      .map(([model, h]) => ({
        model,
        ok: h.ok,
        fail: h.fail,
        successRate: h.ok + h.fail > 0 ? Math.round((h.ok / (h.ok + h.fail)) * 100) : null,
        skippedForSec: h.skipUntil > now ? Math.ceil((h.skipUntil - now) / 1000) : 0,
        lastError: h.lastError,
      }))
      .sort((a, b) => (b.successRate ?? -1) - (a.successRate ?? -1));
  }

  private recordModel(model: string, ok: boolean, error: string | null) {
    this.modelHealth.set(model, applyModelOutcome(this.modelHealth.get(model), ok, error, Date.now()));
  }

  /** Hourly: one tiny real request per top free model with ONE ready key. Models that fail are skipped for a while. */
  async runModelHealthCheck(): Promise<{ checked: number; ok: number; failed: number; skipped: string[] }> {
    const out = { checked: 0, ok: 0, failed: 0, skipped: [] as string[] };
    try {
      const pool = await this.adminApiKeys.getRotationPool('openrouter');
      const now = Date.now();
      const key = pool.find((k) => (this.cooldown.get(k.id) ?? 0) <= now);
      if (!key) return out;
      this.lastHealthAt = now;
      const models = (await this.getFreeModels()).slice(0, 6);
      for (const model of models) {
        const r = await this.callOnce(`${openRouterBase()}/chat/completions`, this.openRouterHeaders(key.apiKey), model, 'Reply with exactly one word: OK', { maxTokens: 8, timeoutMs: 20_000 });
        out.checked++;
        if (r.kind === 'ok') {
          out.ok++;
          this.recordModel(model, true, null);
        } else if (r.kind === 'dead') {
          break; // the key itself is bad: tells us nothing about the model
        } else if (r.kind === 'rate') {
          continue; // busy is not broken
        } else {
          out.failed++;
          this.recordModel(model, false, 'detail' in r ? r.detail : 'no JSON mode / empty');
        }
      }
      const t = Date.now();
      out.skipped = Array.from(this.modelHealth.entries()).filter(([, h]) => h.skipUntil > t).map(([m]) => m);
    } catch (e) {
      this.logger.warn(`model health check failed: ${redact((e as Error).message)}`);
    }
    return out;
  }

  // ---------------------------------------------------------------- generate

  /**
   * Generate a completion, preferring the caller's own OpenRouter key and falling back to
   * the admin key pool (free models only). A rate-limited key just rests for a minute and the
   * next key is used; ONLY a key that OpenRouter rejects as invalid is switched off.
   * NEW (Oct 15 2026): transient errors are retried with backoff, models that keep failing are skipped,
   * and an optional OpenAI-compatible gateway (OPENAI_BASE_URL/OPENAI_API_KEY/OPENAI_MODEL) is the last fallback.
   */
  async generate(prompt: string, opts: AiGenerateOptions = {}): Promise<AiGenerateResult> {
    const provider = opts.provider ?? 'openrouter';
    const feature = (opts.feature || 'GENERAL').toUpperCase();
    const models = rotateModels(await this.getUsableModels(), opts.modelOffset);

    if (opts.userApiKey) {
      const t0 = Date.now();
      const live = this.beginCall(null, 'Student own key', feature, opts.note);
      const result = await this.tryModels(opts.userApiKey, prompt, models, { ...opts, onModel: (m) => { live.model = m; } });
      this.endCall(live, !!result.content, result.content ? null : result.detail || result.reason);
      await this.adminApiKeys.logUsage({
        keyId: null,
        keyName: 'Student own key',
        feature,
        model: result.content ? result.model : null,
        success: !!result.content,
        errorMessage: result.content ? null : redact(result.detail || result.reason || 'failed'),
        latencyMs: Date.now() - t0,
      });
      if (result.content) return { content: result.content, model: result.model!, source: 'USER_KEY' };
      this.logger.warn('User-supplied OpenRouter key failed on all free models; falling back to admin pool.');
    }

    const pool = await this.adminApiKeys.getRotationPool(provider);
    if (pool.length === 0) {
      const viaGw = await this.viaGateway(prompt, opts, feature);
      if (viaGw) return viaGw;
      throw new ServiceUnavailableException('Koi AI API key add nahi hai. Admin → API Keys me OpenRouter key daalein.');
    }

    const now = Date.now();
    // keys that are resting after a 429 go to the back of the line (still tried if nothing else works)
    const ordered = orderKeysByCooldown(pool, this.cooldown, now);

    for (const key of ordered) {
      const t0 = Date.now();
      const live = this.beginCall(key.id, key.keyName, feature, opts.note);
      const result = await this.tryModels(key.apiKey, prompt, models, { ...opts, onModel: (m) => { live.model = m; } });
      this.endCall(live, !!result.content, result.content ? null : result.detail || result.reason);
      const latencyMs = Date.now() - t0;
      if (result.content) {
        this.cooldown.delete(key.id);
        await this.adminApiKeys.reportUsage(key.id, true);
        await this.adminApiKeys.logUsage({ keyId: key.id, keyName: key.keyName, feature, model: result.model, success: true, latencyMs });
        return { content: result.content, model: result.model!, source: 'ADMIN_KEY', adminKeyId: key.id, adminKeyName: key.keyName };
      }
      if (result.reason === 'rate_limited') this.cooldown.set(key.id, Date.now() + KEY_COOLDOWN_MS);
      const errorMessage = redact(result.detail || (result.reason === 'dead' ? 'OpenRouter ne key reject ki (invalid / no credit)' : 'free models abhi busy (rate limit) — thodi der baad dobara chalegi'));
      await this.adminApiKeys.reportUsage(key.id, false, { exhausted: result.reason === 'dead', errorMessage });
      await this.adminApiKeys.logUsage({ keyId: key.id, keyName: key.keyName, feature, model: null, success: false, errorMessage, latencyMs });
    }

    const viaGw = await this.viaGateway(prompt, opts, feature);
    if (viaGw) return viaGw;
    throw new ServiceUnavailableException('Sabhi AI keys abhi busy ya band hain. Thodi der baad try karein ya nayi key add karein.');
  }

  /** Optional OpenAI-compatible gateway; null when it is not configured or it failed. */
  private async viaGateway(prompt: string, opts: AiGenerateOptions, feature: string): Promise<AiGenerateResult | null> {
    const gw = this.gatewayConfig();
    if (!gw) return null;
    const t0 = Date.now();
    const live = this.beginCall(null, 'Gateway (OPENAI_BASE_URL)', feature, opts.note);
    live.model = gw.model;
    const r = await this.callWithRetry(`${gw.baseUrl}/chat/completions`, { 'Content-Type': 'application/json', Authorization: `Bearer ${gw.apiKey}` }, gw.model, prompt, {
      jsonResponse: opts.jsonResponse,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs,
    });
    const ok = r.kind === 'ok';
    const detail = ok ? null : r.kind === 'rate' ? 'gateway rate limited (429)' : r.kind === 'nojson' ? 'gateway: bad request' : 'detail' in r ? r.detail : 'failed';
    this.endCall(live, ok, detail);
    await this.adminApiKeys.logUsage({ keyId: null, keyName: 'Gateway (OPENAI_BASE_URL)', feature, model: ok ? gw.model : null, success: ok, errorMessage: detail ? redact(detail) : null, latencyMs: Date.now() - t0 });
    if (r.kind === 'ok') return { content: r.content, model: gw.model, source: 'GATEWAY' };
    return null;
  }

  /** "Test gateway": one tiny real request. Never throws. */
  async testGateway(): Promise<{ configured: boolean; ok: boolean; message: string; model?: string }> {
    const gw = this.gatewayConfig();
    if (!gw) return { configured: false, ok: false, message: 'OPENAI_BASE_URL / OPENAI_API_KEY set nahi hai (optional).' };
    const r = await this.callWithRetry(`${gw.baseUrl}/chat/completions`, { 'Content-Type': 'application/json', Authorization: `Bearer ${gw.apiKey}` }, gw.model, 'Reply with exactly one word: OK', { maxTokens: 16, timeoutMs: 25_000 });
    if (r.kind === 'ok') return { configured: true, ok: true, message: 'Gateway chal raha hai ✅', model: gw.model };
    const why = r.kind === 'dead' ? r.detail : r.kind === 'rate' ? 'rate limited (429)' : 'detail' in r ? r.detail : 'bad request';
    return { configured: true, ok: false, message: redact(why) };
  }

  /** "Test key" button: one tiny real request. Never throws. */
  async testKey(apiKey: string, ctx?: { keyId?: string; keyName?: string }): Promise<KeyTestResult> {
    const key = String(apiKey || '').trim();
    if (!key) return { ok: false, status: 'error', message: 'Key khaali hai.' };
    const models = await this.getUsableModels();
    const t0 = Date.now();
    const live = this.beginCall(ctx?.keyId ?? null, ctx?.keyName ?? 'Key test', 'KEY_TEST');
    const r = await this.tryModels(key, 'Reply with exactly one word: OK', models, { maxTokens: 16, onModel: (m) => { live.model = m; } });
    this.endCall(live, !!r.content, r.content ? null : r.detail || r.reason);
    if (ctx?.keyName) {
      await this.adminApiKeys.logUsage({
        keyId: ctx.keyId ?? null,
        keyName: ctx.keyName,
        feature: 'KEY_TEST',
        model: r.content ? r.model : null,
        success: !!r.content,
        errorMessage: r.content ? null : redact(r.detail || r.reason || 'failed'),
        latencyMs: Date.now() - t0,
      });
    }
    if (r.content) return { ok: true, status: 'working', message: 'Key sahi chal rahi hai ✅', model: r.model };
    if (r.reason === 'dead') return { ok: false, status: 'invalid', message: redact(r.detail || 'OpenRouter ne key accept nahi ki (galat ya band key).') };
    if (r.reason === 'rate_limited') return { ok: false, status: 'rate_limited', message: 'Key sahi hai par free models abhi busy hain — thodi der baad phir test karein.' };
    return { ok: false, status: 'error', message: redact(r.detail || 'Test fail hua — internet / OpenRouter check karein.') };
  }

  // ---------------------------------------------------------------- low level

  private openRouterHeaders(apiKey: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://sscprephub.in',
      'X-Title': 'SSC Prep Hub',
    };
  }

  /** ONE HTTP request, classified. Size-guarded and time-boxed. */
  private async callOnce(
    url: string,
    headers: Record<string, string>,
    model: string,
    prompt: string,
    opts: { jsonResponse?: boolean; maxTokens?: number; timeoutMs?: number },
  ): Promise<CallOutcome> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: clampTokens(opts.maxTokens),
          ...(opts.jsonResponse ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > MAX_RESPONSE_CHARS * 2) return { kind: 'fail', detail: 'response too large' };
      const text = await response.text().catch(() => '');
      if (!response.ok) {
        const detail = redact(`${response.status}: ${text.slice(0, 160)}`);
        if (looksDead(response.status, text)) return { kind: 'dead', detail: `OpenRouter ne key reject ki (${response.status})` };
        if (response.status === 429) return { kind: 'rate' };
        if (response.status === 400 && opts.jsonResponse) return { kind: 'nojson' }; // model has no JSON mode
        if (isTransientStatus(response.status)) return { kind: 'transient', detail };
        return { kind: 'fail', detail };
      }
      if (text.length > MAX_RESPONSE_CHARS) return { kind: 'fail', detail: 'response too large' };
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        return { kind: 'transient', detail: 'invalid JSON envelope from provider' };
      }
      const msg = data?.choices?.[0]?.message;
      const content = typeof msg?.content === 'string' && msg.content.trim() ? msg.content : '';
      return content ? { kind: 'ok', content } : { kind: 'fail', detail: 'empty answer' };
    } catch (e) {
      // timeout / network: worth a retry
      return { kind: 'transient', detail: redact((e as Error)?.name === 'TimeoutError' ? 'timeout' : (e as Error)?.message || 'network error') };
    }
  }

  /** callOnce + exponential backoff for transient errors only (and a JSON-mode -> plain-mode fallback). */
  private async callWithRetry(
    url: string,
    headers: Record<string, string>,
    model: string,
    prompt: string,
    opts: { jsonResponse?: boolean; maxTokens?: number; timeoutMs?: number },
  ): Promise<CallOutcome> {
    let jsonMode = !!opts.jsonResponse;
    let attempt = 0;
    for (;;) {
      const r = await this.callOnce(url, headers, model, prompt, { ...opts, jsonResponse: jsonMode });
      if (r.kind === 'nojson' && jsonMode) {
        jsonMode = false;
        continue;
      }
      if (r.kind === 'transient' && attempt < MAX_RETRIES) {
        await sleep(retryDelayMs(attempt));
        attempt++;
        continue;
      }
      return r;
    }
  }

  /**
   * Tries the free models in order with ONE key.
   *  dead         -> the key itself is rejected (401/403/402): stop, rotate to the next key
   *  rate_limited -> models answered 429 / were busy: key is fine, rest it for a bit
   */
  private async tryModels(
    apiKey: string,
    prompt: string,
    models: string[],
    opts: { jsonResponse?: boolean; maxTokens?: number; timeoutMs?: number; onModel?: (model: string) => void },
  ): Promise<{ content?: string; model?: string; reason?: 'dead' | 'rate_limited' | 'error'; detail?: string }> {
    let sawRateLimit = false;
    let lastDetail = '';
    for (const model of models) {
      opts.onModel?.(model);
      const r = await this.callWithRetry(`${openRouterBase()}/chat/completions`, this.openRouterHeaders(apiKey), model, prompt, opts);
      if (r.kind === 'ok') {
        this.recordModel(model, true, null);
        return { content: r.content, model };
      }
      if (r.kind === 'dead') return { reason: 'dead', detail: r.detail };
      if (r.kind === 'rate') {
        sawRateLimit = true; // busy is not broken: no health penalty
        continue;
      }
      lastDetail = 'detail' in r ? r.detail : 'bad request';
      this.recordModel(model, false, lastDetail);
    }
    return { reason: sawRateLimit ? 'rate_limited' : 'error', detail: sawRateLimit ? undefined : lastDetail };
  }
}
