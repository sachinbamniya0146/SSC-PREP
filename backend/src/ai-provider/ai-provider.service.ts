import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AdminApiKeyService } from '../admin-api-keys/admin-api-keys.service';

export interface AiGenerateResult {
  content: string;
  model: string;
  source: 'USER_KEY' | 'ADMIN_KEY';
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
}

function rotateModels(list: string[], offset?: number): string[] {
  if (!offset || list.length < 2) return list;
  const k = ((offset % list.length) + list.length) % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
}

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

/** 401/403 = the key itself is wrong/revoked. 429 = only a rate limit — NEVER a dead key. */
function looksDead(status: number, bodyText: string): boolean {
  if (status === 401 || status === 403) return true;
  if (status === 402) return true; // no credit at all
  if (status === 429) return false;
  const t = bodyText.toLowerCase();
  return t.includes('invalid api key') || t.includes('no auth credentials') || t.includes('user not found');
}

@Injectable()
export class AiProviderService {
  private readonly logger = new Logger(AiProviderService.name);
  private modelsCache: { at: number; list: string[] } | null = null;
  private readonly cooldown = new Map<string, number>();

  constructor(private readonly adminApiKeys: AdminApiKeyService) {}

  /** the free models that will be tried, best first */
  async getFreeModels(): Promise<string[]> {
    const env = (process.env.OPENROUTER_MODEL || '').trim();
    const head = env && env.endsWith(':free') ? [env] : [];
    if (this.modelsCache && Date.now() - this.modelsCache.at < MODELS_TTL_MS) return [...head, ...this.modelsCache.list.filter((m) => m !== env)];
    let list: string[] = [];
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15_000) });
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
    if (list.length === 0) list = [...FALLBACK_FREE_MODELS];
    this.modelsCache = { at: Date.now(), list };
    return [...head, ...list.filter((m) => m !== env)];
  }

  /**
   * Generate a completion, preferring the caller's own OpenRouter key and falling back to
   * the admin key pool (free models only). A rate-limited key just rests for a minute and the
   * next key is used; ONLY a key that OpenRouter rejects as invalid is switched off.
   */
  async generate(prompt: string, opts: AiGenerateOptions = {}): Promise<AiGenerateResult> {
    const provider = opts.provider ?? 'openrouter';
    const feature = (opts.feature || 'GENERAL').toUpperCase();
    const models = rotateModels(await this.getFreeModels(), opts.modelOffset);

    if (opts.userApiKey) {
      const t0 = Date.now();
      const result = await this.tryModels(opts.userApiKey, prompt, models, opts);
      await this.adminApiKeys.logUsage({
        keyId: null,
        keyName: 'Student own key',
        feature,
        model: result.content ? result.model : null,
        success: !!result.content,
        errorMessage: result.content ? null : result.detail || result.reason || 'failed',
        latencyMs: Date.now() - t0,
      });
      if (result.content) return { content: result.content, model: result.model!, source: 'USER_KEY' };
      this.logger.warn('User-supplied OpenRouter key failed on all free models; falling back to admin pool.');
    }

    const pool = await this.adminApiKeys.getRotationPool(provider);
    if (pool.length === 0) {
      throw new ServiceUnavailableException('Koi AI API key add nahi hai. Admin → API Keys me OpenRouter key daalein.');
    }

    const now = Date.now();
    // keys that are resting after a 429 go to the back of the line (still tried if nothing else works)
    const ordered = [...pool].sort((a, b) => Number((this.cooldown.get(a.id) ?? 0) > now) - Number((this.cooldown.get(b.id) ?? 0) > now));

    for (const key of ordered) {
      const t0 = Date.now();
      const result = await this.tryModels(key.apiKey, prompt, models, opts);
      const latencyMs = Date.now() - t0;
      if (result.content) {
        this.cooldown.delete(key.id);
        await this.adminApiKeys.reportUsage(key.id, true);
        await this.adminApiKeys.logUsage({ keyId: key.id, keyName: key.keyName, feature, model: result.model, success: true, latencyMs });
        return { content: result.content, model: result.model!, source: 'ADMIN_KEY', adminKeyId: key.id, adminKeyName: key.keyName };
      }
      if (result.reason === 'rate_limited') this.cooldown.set(key.id, Date.now() + KEY_COOLDOWN_MS);
      const errorMessage = result.detail || (result.reason === 'dead' ? 'OpenRouter ne key reject ki (invalid / no credit)' : 'free models abhi busy (rate limit) — thodi der baad dobara chalegi');
      await this.adminApiKeys.reportUsage(key.id, false, { exhausted: result.reason === 'dead', errorMessage });
      await this.adminApiKeys.logUsage({ keyId: key.id, keyName: key.keyName, feature, model: null, success: false, errorMessage, latencyMs });
    }

    throw new ServiceUnavailableException('Sabhi AI keys abhi busy ya band hain. Thodi der baad try karein ya nayi key add karein.');
  }

  /** "Test key" button: one tiny real request. Never throws. */
  async testKey(apiKey: string, ctx?: { keyId?: string; keyName?: string }): Promise<KeyTestResult> {
    const key = String(apiKey || '').trim();
    if (!key) return { ok: false, status: 'error', message: 'Key khaali hai.' };
    const models = await this.getFreeModels();
    const t0 = Date.now();
    const r = await this.tryModels(key, 'Reply with exactly one word: OK', models, { maxTokens: 16 });
    if (ctx?.keyName) {
      await this.adminApiKeys.logUsage({
        keyId: ctx.keyId ?? null,
        keyName: ctx.keyName,
        feature: 'KEY_TEST',
        model: r.content ? r.model : null,
        success: !!r.content,
        errorMessage: r.content ? null : r.detail || r.reason || 'failed',
        latencyMs: Date.now() - t0,
      });
    }
    if (r.content) return { ok: true, status: 'working', message: 'Key sahi chal rahi hai ✅', model: r.model };
    if (r.reason === 'dead') return { ok: false, status: 'invalid', message: r.detail || 'OpenRouter ne key accept nahi ki (galat ya band key).' };
    if (r.reason === 'rate_limited') return { ok: false, status: 'rate_limited', message: 'Key sahi hai par free models abhi busy hain — thodi der baad phir test karein.' };
    return { ok: false, status: 'error', message: r.detail || 'Test fail hua — internet / OpenRouter check karein.' };
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
    opts: { jsonResponse?: boolean; maxTokens?: number },
  ): Promise<{ content?: string; model?: string; reason?: 'dead' | 'rate_limited' | 'error'; detail?: string }> {
    let sawRateLimit = false;
    let lastDetail = '';
    for (const model of models) {
      for (const useJson of opts.jsonResponse ? [true, false] : [false]) {
        try {
          const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
              'HTTP-Referer': 'https://sscprephub.in',
              'X-Title': 'SSC Prep Hub',
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.2,
              max_tokens: opts.maxTokens ?? 3000,
              ...(useJson ? { response_format: { type: 'json_object' } } : {}),
            }),
          });

          if (!response.ok) {
            const bodyText = await response.text().catch(() => '');
            lastDetail = `${response.status}: ${bodyText.slice(0, 160)}`;
            if (looksDead(response.status, bodyText)) return { reason: 'dead', detail: `OpenRouter ne key reject ki (${response.status})` };
            if (response.status === 429) {
              sawRateLimit = true;
              break; // this model is busy -> next model
            }
            if (response.status === 400 && useJson) continue; // model has no JSON mode -> retry same model without it
            break; // 404 (model retired) / 5xx -> next model
          }

          const data: any = await response.json();
          const msg = data?.choices?.[0]?.message;
          const content = typeof msg?.content === 'string' && msg.content.trim() ? msg.content : '';
          if (content) return { content, model };
          break;
        } catch (e) {
          lastDetail = (e as Error)?.message || 'network error';
          break; // timeout / network -> next model
        }
      }
    }
    return { reason: sawRateLimit ? 'rate_limited' : 'error', detail: sawRateLimit ? undefined : lastDetail };
  }
}
