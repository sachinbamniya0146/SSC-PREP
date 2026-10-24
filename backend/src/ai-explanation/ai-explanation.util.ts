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
const str = (v: unknown, max = 2500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Section markers of a structured solution. The frontend (SolutionPanel) parses exactly these. */
export const SOLUTION_MARKERS = { answer: '##ANSWER', steps: '##STEPS', shortcut: '##SHORTCUT', others: '##OTHERS', mistake: '##MISTAKE', concepts: '##CONCEPTS' } as const;

interface OtherReason { option: string; reason: string }
const otherList = (v: unknown): OtherReason[] =>
  Array.isArray(v)
    ? v
        .map((x) => ({ option: String((x as Record<string, unknown>)?.option ?? '').trim().slice(0, 3), reason: String((x as Record<string, unknown>)?.reason ?? '').trim().slice(0, 400) }))
        .filter((x) => x.option && x.reason)
        .slice(0, 4)
    : [];

/** Builds the stored text for one language from the model's separate fields (empty sections are skipped). */
export function composeSolution(parts: { answer?: string; steps: string; shortcut?: string; others?: OtherReason[]; mistake?: string; concepts?: string[] }): string {
  const out: string[] = [];
  if (parts.answer) out.push(`${SOLUTION_MARKERS.answer}\n${parts.answer}`);
  out.push(`${SOLUTION_MARKERS.steps}\n${parts.steps}`);
  if (parts.shortcut) out.push(`${SOLUTION_MARKERS.shortcut}\n${parts.shortcut}`);
  if (parts.others?.length) out.push(`${SOLUTION_MARKERS.others}\n${parts.others.map((o) => `${o.option}) ${o.reason}`).join('\n')}`);
  if (parts.mistake) out.push(`${SOLUTION_MARKERS.mistake}\n${parts.mistake}`);
  if (parts.concepts?.length) out.push(`${SOLUTION_MARKERS.concepts}\n${parts.concepts.map((c) => `- ${c}`).join('\n')}`);
  return out.join('\n\n');
}

/**
 * strict parse of the model answer; a solution that ends on another option than the stored key is refused.
 * Accepts the rich shape (steps / shortcut / whyOthers / commonMistake / keyConcepts, EN + HI) and, for older
 * prompts / models, the plain { explanation, explanationHindi } shape.
 */
export function parseExplanation(content: string, correctKey: string): ParseVerdict {
  const j = extractJson(content) as Record<string, unknown> | null;
  if (!j) return { ok: false, reason: 'not_json' };
  const stepsEn = str(j.steps, 4000) || str(j.explanation, 4000);
  if (!stepsEn) return { ok: false, reason: 'not_json' };
  if (stepsEn.length < 20) return { ok: false, reason: 'too_short' };
  // only the reasoning itself is checked against the key: "why the other options are wrong" legitimately names other letters
  const clash = solutionContradictsKey(stepsEn, correctKey);
  if (clash) return { ok: false, reason: 'contradicts_key', detail: clash };

  const concepts = strList(j.keyConcepts);
  const conceptsHi = strList(j.keyConceptsHindi);
  const rich = typeof j.steps === 'string' && j.steps.trim().length > 0;

  const explanation = rich
    ? composeSolution({ answer: str(j.answer, 300), steps: stepsEn, shortcut: str(j.shortcut, 600), others: otherList(j.whyOthers), mistake: str(j.commonMistake, 500), concepts })
    : stepsEn;

  const stepsHi = str(j.stepsHindi, 4000) || str(j.explanationHindi, 4000);
  const hiOk = (t: string) => t.length > 0 && hindiRatio(t) >= 0.3;
  let explanationHindi = '';
  if (stepsHi.length >= 10 && hiOk(stepsHi)) {
    explanationHindi = rich
      ? composeSolution({
          answer: str(j.answerHindi, 300) || str(j.answer, 300),
          steps: stepsHi,
          shortcut: hiOk(str(j.shortcutHindi, 600)) ? str(j.shortcutHindi, 600) : '',
          others: otherList(j.whyOthersHindi),
          mistake: hiOk(str(j.commonMistakeHindi, 500)) ? str(j.commonMistakeHindi, 500) : '',
          concepts: conceptsHi,
        })
      : stepsHi;
  }
  return { ok: true, value: { explanation, explanationHindi, keyConcepts: concepts, keyConceptsHindi: conceptsHi } };
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
