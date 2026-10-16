import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import { redact } from '../ai-provider/ai-provider.util';
import { ProviderBusyError, QuestionCtx, runItem } from './ai-job.runner';

/** Golden set: simple MCQs whose answer is certain. If the AI stack gets these wrong, something is broken. */
export const GOLDEN_SET: Array<{ q: string; options: string[]; answer: 'A' | 'B' | 'C' | 'D' }> = [
  { q: 'What is 25% of 480?', options: ['100', '120', '140', '160'], answer: 'B' },
  { q: 'Who was the first Prime Minister of independent India?', options: ['Sardar Patel', 'Jawaharlal Nehru', 'Lal Bahadur Shastri', 'Rajendra Prasad'], answer: 'B' },
  { q: 'Find the odd one out: 2, 3, 5, 9, 11', options: ['2', '3', '9', '11'], answer: 'C' },
  { q: 'Choose the correct synonym of "Rapid".', options: ['Slow', 'Quick', 'Heavy', 'Silent'], answer: 'B' },
  { q: 'A train 120 m long crosses a pole in 6 seconds. Its speed is:', options: ['10 m/s', '15 m/s', '20 m/s', '25 m/s'], answer: 'C' },
];

export interface BenchmarkResult {
  at: string;
  total: number;
  correct: number;
  accuracyPct: number;
  avgSec: number;
  rows: Array<{ q: string; expected: string; got: string | null; ok: boolean; sec: number }>;
  verdict: 'good' | 'weak' | 'bad';
  message: string;
}

@Injectable()
export class AiOpsService {
  private lastBenchmark: BenchmarkResult | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiProviderService,
  ) {}

  getLastBenchmark(): BenchmarkResult | null {
    return this.lastBenchmark;
  }

  /** Runs the golden set through the REAL engine (same 3-pass voting as ANSWER_KEY_VERIFY). One run at a time. */
  async runBenchmark(): Promise<BenchmarkResult> {
    if (this.running) throw new ServiceUnavailableException('Benchmark pehle se chal raha hai.');
    this.running = true;
    try {
      const rows: BenchmarkResult['rows'] = [];
      for (const g of GOLDEN_SET) {
        const ctx: QuestionCtx = {
          id: 'golden', questionNo: null, questionText: g.q,
          questionTextHindi: null,
          options: g.options.map((t, i) => ({ key: 'ABCD'[i], text: t })),
          correctAnswer: g.answer, explanation: null, explanationHindi: null, subjectName: 'General', chapterId: null, chapterName: null, topicId: null, hindiExempt: true,
        };
        const t0 = Date.now();
        let got: string | null = null;
        try {
          const r = await runItem(
            'ANSWER_KEY_VERIFY',
            ctx,
            async (prompt, o) => {
              try {
                return (await this.ai.generate(prompt, { jsonResponse: true, maxTokens: o.maxTokens, feature: 'BENCHMARK', modelOffset: o.passIndex, note: 'Benchmark' })).content;
              } catch (e) {
                if (e instanceof ServiceUnavailableException) throw new ProviderBusyError(e.message);
                throw e;
              }
            },
            { passes: 3, minAgree: 2 },
          );
          const p = r.proposal as { kind?: string; answer?: string; to?: string } | null;
          got = r.status === 'DONE' ? p?.answer ?? g.answer : p?.to ?? null;
        } catch (e) {
          got = e instanceof ProviderBusyError ? 'BUSY' : redact((e as Error).message).slice(0, 40);
        }
        rows.push({ q: g.q.slice(0, 60), expected: g.answer, got, ok: got === g.answer, sec: Math.round((Date.now() - t0) / 100) / 10 });
      }
      const correct = rows.filter((r) => r.ok).length;
      const accuracyPct = Math.round((correct / rows.length) * 100);
      const busy = rows.some((r) => r.got === 'BUSY');
      const verdict = accuracyPct >= 80 ? 'good' : accuracyPct >= 60 ? 'weak' : 'bad';
      const res: BenchmarkResult = {
        at: new Date().toISOString(),
        total: rows.length,
        correct,
        accuracyPct,
        avgSec: Math.round((rows.reduce((a, r) => a + r.sec, 0) / rows.length) * 10) / 10,
        rows,
        verdict,
        message: busy
          ? 'Keys busy thi — result adhura hai, thodi der baad dobara chalayein.'
          : verdict === 'good' ? `AI quality theek hai (${correct}/${rows.length} sahi).` : verdict === 'weak' ? `AI thoda kamzor (${correct}/${rows.length}) — bade jobs se pehle review zyada karein.` : `AI quality kharab (${correct}/${rows.length}) — jobs mat chalayein; models/keys check karein.`,
      };
      this.lastBenchmark = res;
      return res;
    } finally {
      this.running = false;
    }
  }

  /** Per-feature / per-key / fail-reason numbers of the last 7 days, from the real usage log. */
  async stats(days = 7) {
    const since = new Date(Date.now() - Math.min(30, Math.max(1, days)) * 86400_000);
    const [byFeature, byKey, failRows, lat] = await Promise.all([
      this.prisma.aiUsageLog.groupBy({ by: ['feature', 'success'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.aiUsageLog.groupBy({ by: ['keyName', 'success'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.aiUsageLog.findMany({ where: { createdAt: { gte: since }, success: false, errorMessage: { not: null } }, select: { errorMessage: true }, orderBy: { createdAt: 'desc' }, take: 800 }),
      this.prisma.aiUsageLog.groupBy({ by: ['feature'], where: { createdAt: { gte: since }, success: true, latencyMs: { not: null } }, _avg: { latencyMs: true } }),
    ]);
    const merge = (rows: Array<{ success: boolean; _count: { _all: number } } & Record<string, unknown>>, k: string) => {
      const m = new Map<string, { name: string; ok: number; fail: number }>();
      for (const r of rows) {
        const name = String(r[k]);
        const e = m.get(name) ?? { name, ok: 0, fail: 0 };
        if (r.success) e.ok += r._count._all;
        else e.fail += r._count._all;
        m.set(name, e);
      }
      return Array.from(m.values()).sort((a, b) => b.ok + b.fail - (a.ok + a.fail));
    };
    const latBy = new Map(lat.map((l) => [l.feature, Math.round(l._avg.latencyMs ?? 0)]));
    const features = merge(byFeature as never, 'feature').map((f) => ({ ...f, successPct: f.ok + f.fail ? Math.round((f.ok / (f.ok + f.fail)) * 100) : null, avgMs: latBy.get(f.name) ?? null }));
    const keys = merge(byKey as never, 'keyName').map((f) => ({ ...f, successPct: f.ok + f.fail ? Math.round((f.ok / (f.ok + f.fail)) * 100) : null }));
    const reasons = new Map<string, number>();
    for (const r of failRows) {
      const t = classifyFailReason(r.errorMessage ?? '');
      reasons.set(t, (reasons.get(t) ?? 0) + 1);
    }
    return { days, features, keys, failReasons: Array.from(reasons.entries()).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 8) };
  }
}

/** short human bucket for an error message (pure, exported for tests) */
export function classifyFailReason(msg: string): string {
  const t = msg.toLowerCase();
  if (/timeout|deadline|time limit/.test(t)) return 'Timeout';
  if (/reject|401|invalid|revoked|galat/.test(t)) return 'Key invalid (401)';
  if (/402|credit/.test(t)) return 'Credit / limit (402)';
  if (/403|forbidden|refus|mana ki/.test(t)) return 'Model ne mana kiya (403)';
  if (/rate|429|busy|quota/.test(t)) return 'Rate limit / busy (429)';
  if (/empty answer|invalid json|no json/.test(t)) return 'Model ka kharab jawab';
  if (/5\d\d|network|fetch|econn/.test(t)) return 'Network / server error';
  return 'Other';
}
