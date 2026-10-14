import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import { AdminApiKeyService } from '../admin-api-keys/admin-api-keys.service';
import { PyqDateSearchService } from '../pyq-dates/pyq-date-search.service';
import { redact } from '../ai-provider/ai-provider.util';
import { ANSWER_SCHEMA, parseAnswer } from './ai-job.logic';

export interface CheckStep {
  id: string;
  name: string;
  ok: boolean | null; // null = optional / not configured
  detail: string;
  fix: string | null;
  ms: number;
}

class RollbackSignal extends Error {}

/**
 * "AI System Check": a REAL end-to-end test (nothing is faked or cached):
 * migration -> key test -> free model list -> JSON call on a real question -> web search -> DB write+rollback -> gateway.
 */
@Injectable()
export class AiSystemCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiProviderService,
    private readonly keys: AdminApiKeyService,
    private readonly search: PyqDateSearchService,
  ) {}

  private async step(id: string, name: string, fn: () => Promise<{ ok: boolean | null; detail: string; fix?: string | null }>): Promise<CheckStep> {
    const t0 = Date.now();
    try {
      const r = await fn();
      return { id, name, ok: r.ok, detail: r.detail, fix: r.ok === false ? r.fix ?? null : null, ms: Date.now() - t0 };
    } catch (e) {
      return { id, name, ok: false, detail: redact((e as Error)?.message || 'error').slice(0, 300), fix: 'Backend logs dekhein: docker compose logs --tail=100 backend', ms: Date.now() - t0 };
    }
  }

  async run(): Promise<{ ok: boolean; steps: CheckStep[]; at: string }> {
    const steps: CheckStep[] = [];

    steps.push(
      await this.step('migration', 'Database tables (ai_jobs / ai_changes)', async () => {
        const [a, b] = await Promise.all([this.prisma.aiJob.count(), this.prisma.aiChange.count()]);
        return { ok: true, detail: `tables maujood: ai_jobs=${a}, ai_changes=${b}` };
      }).then((s) => (s.ok ? s : { ...s, fix: 'VPS par: docker exec ssc-backend npx prisma migrate deploy (deploy.sh ye khud chalata hai)' })),
    );

    steps.push(
      await this.step('keys', 'API key — asli test call', async () => {
        const pool = await this.keys.getRotationPool('openrouter');
        if (!pool.length) {
          if (this.ai.gatewayConfig()) return { ok: null, detail: 'Koi OpenRouter key nahi, par gateway set hai (neeche dekhein).' };
          return { ok: false, detail: 'Koi active OpenRouter key nahi.', fix: 'Admin → API Keys me key paste karke "Add Key" dabayein.' };
        }
        const r = await this.ai.testKey(pool[0].apiKey);
        if (r.ok) return { ok: true, detail: `${pool.length} active key · "${pool[0].keyName}" ne asli request ka jawab diya (model: ${r.model}).` };
        if (r.status === 'rate_limited') return { ok: true, detail: `${pool.length} active key · key sahi hai par free models abhi busy (429) — kaam rest ke baad chalega.` };
        return { ok: false, detail: `"${pool[0].keyName}": ${r.message}`, fix: r.status === 'invalid' ? 'Key galat/band hai — nayi OpenRouter key daalein.' : 'Internet / OpenRouter status check karein, phir dobara chalayein.' };
      }),
    );

    steps.push(
      await this.step('models', 'Free model list (OpenRouter catalogue)', async () => {
        const list = await this.ai.getFreeModels(true);
        if (!list.length) return { ok: false, detail: 'Free model list khali.', fix: 'VPS se openrouter.ai tak internet check karein.' };
        return { ok: true, detail: `${list.length} free model: ${list.slice(0, 3).join(', ')}${list.length > 3 ? ' …' : ''}` };
      }),
    );

    steps.push(
      await this.step('json', 'Asli question par JSON-mode AI call', async () => {
        const q = await this.prisma.question.findFirst({ where: { isActive: true, NOT: { correctAnswer: '' } }, orderBy: { updatedAt: 'desc' }, select: { questionNo: true, questionText: true, optionsJson: true, correctAnswer: true } });
        if (!q) return { ok: null, detail: 'Database me abhi koi question nahi — test skip.' };
        const opts = Array.isArray(q.optionsJson) ? (q.optionsJson as Array<{ key?: string; text?: string }>).map((o, i) => `${o.key ?? 'ABCD'[i]}) ${o.text ?? ''}`).join('\n') : '';
        const t0 = Date.now();
        const r = await this.ai.generate(`Answer this MCQ.\nQuestion: ${q.questionText}\nOptions:\n${opts}\nReply with ONLY this JSON: {"answer":"A|B|C|D","reason":"one line"}`, { jsonResponse: true, maxTokens: 400, feature: 'SYSTEM_CHECK', note: 'System Check' });
        const p = parseAnswer<{ answer: string }>(r.content, ANSWER_SCHEMA);
        if (!p.value) return { ok: false, detail: `Model (${r.model}) ne valid JSON nahi diya: ${p.errors.join('; ')}`, fix: 'Dobara chalayein; baar baar fail ho to key/model busy hain.' };
        return { ok: true, detail: `Q#${q.questionNo}: ${r.model} ne ${((Date.now() - t0) / 1000).toFixed(1)}s me valid JSON diya (answer ${p.value.answer}, stored ${q.correctAnswer}).` };
      }),
    );

    steps.push(
      await this.step('search', 'Web search (PYQ date ke liye)', async () => {
        const out = await this.search.search('SSC CGL 2024 tier 1 exam date shift');
        if (out.failed) return { ok: false, detail: `Search engines fail/blocked: ${out.error ?? 'unknown'}`, fix: 'VPS ka IP search engine ne block kiya ho sakta hai — 30-60 min baad dobara chalayein. Tab tak PYQ date job rukegi, baaki AI jobs chalenge.' };
        if (!out.hits.length) return { ok: false, detail: `${out.engine ?? 'engine'} chala par 0 result mile.`, fix: 'Thodi der baad dobara chalayein.' };
        return { ok: true, detail: `${out.engine}: ${out.hits.length} result mile.` };
      }),
    );

    steps.push(
      await this.step('db', 'Database write + rollback (dry-run)', async () => {
        const marker = `syscheck-${Date.now()}`;
        let seen = 0;
        try {
          await this.prisma.$transaction(async (tx) => {
            await tx.aiChange.create({ data: { questionId: marker, field: 'explanation', oldValue: { v: null }, newValue: { v: 'x' }, source: 'SYSTEM_CHECK' } });
            seen = await tx.aiChange.count({ where: { questionId: marker } });
            throw new RollbackSignal('rollback');
          });
        } catch (e) {
          if (!(e instanceof RollbackSignal)) throw e;
        }
        const left = await this.prisma.aiChange.count({ where: { questionId: marker } });
        if (seen !== 1) return { ok: false, detail: 'Transaction ke andar write nazar nahi aaya.', fix: 'Database connection / permissions check karein.' };
        if (left !== 0) return { ok: false, detail: 'Rollback ke baad bhi test row bachi hai!', fix: 'Database transaction support check karein.' };
        return { ok: true, detail: 'Write transaction ke andar dikha aur rollback ke baad gayab — undo-log safe hai. (Koi asli data nahi badla.)' };
      }),
    );

    steps.push(
      await this.step('gateway', 'OpenAI-compatible gateway (optional fallback)', async () => {
        const g = await this.ai.testGateway();
        if (!g.configured) return { ok: null, detail: 'Set nahi hai (optional). OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL se fallback laga sakte hain.' };
        return g.ok ? { ok: true, detail: `${g.message} (model: ${g.model})` } : { ok: false, detail: g.message, fix: 'OPENAI_BASE_URL / OPENAI_API_KEY check karein (docker compose --force-recreate se .env reload hota hai).' };
      }),
    );

    // web search / optional gateway failing does not stop the other AI jobs; everything else must pass
    const ok = steps.every((x) => x.ok !== false || x.id === 'search' || x.id === 'gateway');
    return { ok, steps, at: new Date().toISOString() };
  }
}
