// Pure helpers for student-facing AI explanations (A2, Oct 15 2026): strict parsing + safety gates. No Nest / DB imports.
import { extractJson, hindiRatio, solutionContradictsKey } from '../ai-jobs/ai-job.logic';

export interface ParsedExplanation {
  explanation: string;
  /** '' when the model gave no real Hindi — the English text is NEVER copied into the Hindi field */
  explanationHindi: string;
  keyConcepts: string[];
  keyConceptsHindi: string[];
}

export type ParseVerdict = { ok: true; value: ParsedExplanation } | { ok: false; reason: 'not_json' | 'too_short' | 'contradicts_key'; detail?: string };

const strList = (v: unknown, max = 6): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max) : []);

/** strict parse of the model answer; a solution that ends on another option than the stored key is refused */
export function parseExplanation(content: string, correctKey: string): ParseVerdict {
  const j = extractJson(content) as Record<string, unknown> | null;
  if (!j || typeof j.explanation !== 'string') return { ok: false, reason: 'not_json' };
  const explanation = j.explanation.trim().slice(0, 4000);
  if (explanation.length < 20) return { ok: false, reason: 'too_short' };
  const clash = solutionContradictsKey(explanation, correctKey);
  if (clash) return { ok: false, reason: 'contradicts_key', detail: clash };
  const hiRaw = typeof j.explanationHindi === 'string' ? j.explanationHindi.trim().slice(0, 4000) : '';
  const explanationHindi = hiRaw.length >= 10 && hindiRatio(hiRaw) >= 0.4 ? hiRaw : '';
  return { ok: true, value: { explanation, explanationHindi, keyConcepts: strList(j.keyConcepts), keyConceptsHindi: strList(j.keyConceptsHindi) } };
}

/** sliding-window limiter (in memory, per process): `max` events per `windowMs` per key */
export class RateWindow {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number) {}
  allow(key: string, now: number = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 5000) this.hits.delete(this.hits.keys().next().value as string);
    return true;
  }
}

/** one in-flight job per key: concurrent callers share the same promise */
export class SingleFlight<T> {
  private readonly inflight = new Map<string, Promise<T>>();
  run(key: string, fn: () => Promise<T>): Promise<T> {
    const cur = this.inflight.get(key);
    if (cur) return cur;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
