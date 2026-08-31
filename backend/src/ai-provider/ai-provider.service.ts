import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AdminApiKeyService } from '../admin-api-keys/admin-api-keys.service';

export interface AiGenerateResult {
  content: string;
  model: string;
  source: 'USER_KEY' | 'ADMIN_KEY';
  adminKeyId?: string;
}

// Free-tier-only OpenRouter models, tried in order. An env override can be
// prepended (must itself end in ":free" to stay within the "free models
// only" requirement) without needing a redeploy for every new free model
// OpenRouter ships.
const FREE_MODELS: string[] = [
  process.env.OPENROUTER_MODEL,
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3.5-lightning:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemini-2.0-flash-exp:free',
  'meta-llama/llama-3.1-8b-instruct:free',
].filter((m): m is string => !!m && m.trim() !== '' && m.trim().endsWith(':free'));

/** True when the error looks like "this key itself is dead", not a transient network/rate blip. */
function looksExhausted(status: number, bodyText: string): boolean {
  if (status === 401 || status === 402 || status === 403) return true;
  const t = bodyText.toLowerCase();
  return t.includes('insufficient') || t.includes('quota') || t.includes('invalid api key') || t.includes('exceeded');
}

@Injectable()
export class AiProviderService {
  private readonly logger = new Logger(AiProviderService.name);

  constructor(private readonly adminApiKeys: AdminApiKeyService) {}

  getFreeModels(): string[] {
    return [...FREE_MODELS];
  }

  /**
   * Generate a completion, preferring the caller's own OpenRouter key
   * (still restricted to free models — never charges the user's paid
   * quota on their behalf without asking) and falling back to this app's
   * rotating admin key pool. Every admin-key attempt is reported back to
   * AdminApiKeyService so a dead/quota-exhausted key gets auto-deactivated
   * and the admin is alerted before the *whole* pool goes down.
   */
  async generate(
    prompt: string,
    opts: { userApiKey?: string | null; provider?: string; jsonResponse?: boolean } = {},
  ): Promise<AiGenerateResult> {
    const provider = opts.provider ?? 'openrouter';

    if (opts.userApiKey) {
      const result = await this.tryModels(opts.userApiKey, prompt, opts.jsonResponse);
      if (result.content) return { content: result.content, model: result.model!, source: 'USER_KEY' };
      this.logger.warn('User-supplied OpenRouter key failed on all free models; falling back to admin pool.');
    }

    const pool = await this.adminApiKeys.getRotationPool(provider);
    if (pool.length === 0) {
      throw new ServiceUnavailableException(
        'No AI API key is configured right now. Please try again later or contact admin.',
      );
    }

    for (const key of pool) {
      const result = await this.tryModels(key.apiKey, prompt, opts.jsonResponse);
      if (result.content) {
        await this.adminApiKeys.reportUsage(key.id, true);
        return { content: result.content, model: result.model!, source: 'ADMIN_KEY', adminKeyId: key.id };
      }
      // Only a definitely-dead key (invalid/quota-exceeded — 401/402/403 or
      // a quota-worded error body) gets permanently deactivated. A key that
      // just got rate-limited (429) on every free model is left active —
      // free-tier rate limits reset, so rotation will simply try it again
      // (least-recently-used first) rather than throwing away a good key.
      await this.adminApiKeys.reportUsage(key.id, false, {
        exhausted: result.reason === 'dead',
        errorMessage:
          result.reason === 'dead'
            ? 'key invalid or out of quota (all free models rejected it)'
            : 'rate-limited on all free models — will retry later',
      });
    }

    throw new ServiceUnavailableException(
      'All AI API keys are currently exhausted or rate-limited. The admin has been alerted — please try again shortly.',
    );
  }

  /**
   * Tries every free model in order with ONE key.
   * - Success: { content, model }.
   * - Failure: { reason: 'dead' } if the key itself looks invalid/out of
   *   quota (stop trying further models — it won't get better), or
   *   { reason: 'rate_limited' } if every model just hit a transient/429
   *   error (the key may still be fine later).
   */
  private async tryModels(
    apiKey: string,
    prompt: string,
    jsonResponse?: boolean,
  ): Promise<{ content?: string; model?: string; reason?: 'dead' | 'rate_limited' }> {
    for (const model of FREE_MODELS) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://sscprephub.in',
            'X-Title': 'SSC Prep Hub',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 2000,
            ...(jsonResponse ? { response_format: { type: 'json_object' } } : {}),
          }),
        });

        if (!response.ok) {
          const bodyText = await response.text().catch(() => '');
          if (looksExhausted(response.status, bodyText)) {
            // This key is dead for every model, not just this one — stop
            // trying further models with it and let the caller rotate on.
            return { reason: 'dead' };
          }
          // Rate-limited (429) or transient — try the next free model with the same key.
          continue;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) return { content, model };
      } catch {
        // network hiccup — try next model
        continue;
      }
    }
    return { reason: 'rate_limited' };
  }
}
