/**
 * Pure scoring for POST /bank/attempt/batch (no Nest, no Prisma — table-testable).
 * The comparison is the same one every other scoring site uses: trimmed + upper-cased on BOTH sides.
 */
export interface BatchAnswerIn {
  questionId: string;
  selectedOption: string | null | undefined;
}

export interface BatchQuestionRow {
  id: string;
  correctAnswer: string | null;
  marks?: number | null;
  negativeMarks?: number | null;
  explanation?: string | null;
  explanationHindi?: string | null;
  videoUrl?: string | null;
  videoSource?: string | null;
  videoTitle?: string | null;
}

export interface BatchResultRow {
  correct: boolean;
  correctAnswer: string;
  selectedOption: string;
  scoreDelta: number;
  explanation: string | null;
  explanationHindi: string | null;
  videoUrl: string | null;
  videoSource: string | null;
  videoTitle: string | null;
}

export const normKey = (v: unknown): string => String(v ?? '').trim().toUpperCase();
const round2 = (n: number) => Math.round(n * 100) / 100;

export function scoreBatchAnswers(
  answers: BatchAnswerIn[],
  rows: BatchQuestionRow[],
  ruleFor: (q: BatchQuestionRow) => { marks: number; negative: number },
): { results: Record<string, BatchResultRow>; missing: string[]; score: number; correct: number; wrong: number } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const results: Record<string, BatchResultRow> = {};
  const missing: string[] = [];
  let score = 0;
  let correct = 0;
  let wrong = 0;
  for (const a of answers) {
    const id = String(a?.questionId ?? '');
    const option = normKey(a?.selectedOption);
    if (!id || !option) continue; // nothing chosen = skipped, not scored
    if (results[id]) continue; // the same question twice in one request counts once
    const q = byId.get(id);
    if (!q) {
      if (!missing.includes(id)) missing.push(id);
      continue;
    }
    const key = normKey(q.correctAnswer);
    const ok = key !== '' && option === key;
    const rule = ruleFor(q);
    const delta = ok ? rule.marks : -rule.negative;
    if (ok) correct++;
    else wrong++;
    score += delta;
    results[id] = {
      correct: ok,
      correctAnswer: key,
      selectedOption: option,
      scoreDelta: round2(delta),
      explanation: q.explanation ?? null,
      explanationHindi: q.explanationHindi ?? null,
      videoUrl: q.videoUrl ?? null,
      videoSource: q.videoSource ?? null,
      videoTitle: q.videoTitle ?? null,
    };
  }
  return { results, missing, score: round2(score), correct, wrong };
}
