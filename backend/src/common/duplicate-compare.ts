/**
 * Duplicate comparison (Sachin, Oct 2026 — "duplicate question admin ke review
 * me jaye; question, options, solution, shift sab exactly same ho to admin
 * approve karke ek rakhe / dono rakhe").
 *
 * Two questions that share the same question text + options + correct answer
 * are the SAME QUESTION. They are an EXACT duplicate only when every detail a
 * student or the paper cares about is identical as well:
 *
 *   question (English + Hindi), every option (English + Hindi + picture),
 *   correct answer, solution (English + Hindi), exam, year, shift,
 *   exam date, paper code, question picture.
 *
 * When the question is the same but one of those details differs (for example
 * the same question asked in a different shift, or with a different solution)
 * it is a SIMILAR match — still sent to admin review, but labelled with the
 * exact fields that differ so the admin can decide quickly.
 *
 * Pure functions only (no DB, no Nest) so the upload service, the review
 * service and the scan all use ONE definition of "exactly same".
 */

export type MatchType = 'EXACT' | 'SIMILAR';

/** Fields compared. Order = order shown to the admin. */
export const COMPARED_FIELDS = [
  'questionText',
  'questionTextHindi',
  'options',
  'correctAnswer',
  'explanation',
  'explanationHindi',
  'questionImageUrl',
  'examId',
  'year',
  'shift',
  'examDate',
  'paperCode',
] as const;
export type ComparedField = (typeof COMPARED_FIELDS)[number];

/** Human labels (Hinglish) for the review screen. */
export const FIELD_LABELS: Record<ComparedField, string> = {
  questionText: 'Question (English)',
  questionTextHindi: 'Question (Hindi)',
  options: 'Options',
  correctAnswer: 'Sahi answer',
  explanation: 'Solution (English)',
  explanationHindi: 'Solution (Hindi)',
  questionImageUrl: 'Question image',
  examId: 'Exam',
  year: 'Year',
  shift: 'Shift',
  examDate: 'Exam date',
  paperCode: 'Paper code',
};

/** Minimal shape both a DB row and an upload row satisfy. */
export interface ComparableQuestion {
  questionText?: string | null;
  questionTextHindi?: string | null;
  options?: any[] | null; // upload shape
  optionsJson?: any; // DB shape
  correctAnswer?: string | null;
  explanation?: string | null;
  explanationHindi?: string | null;
  questionImageUrl?: string | null;
  examId?: string | null;
  year?: number | null;
  shift?: string | null;
  examDate?: string | null;
  paperCode?: string | null;
}

/** trim + collapse whitespace + lower-case; null/undefined -> ''. */
export function normText(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function optionList(q: ComparableQuestion): any[] {
  const raw = (q.options ?? q.optionsJson ?? []) as any;
  return Array.isArray(raw) ? raw : [];
}

/** Stable signature of all options (A-D): key, text, Hindi text, diagram, picture. */
export function optionsSignature(q: ComparableQuestion): string {
  return optionList(q)
    .slice()
    .sort((a, b) => String(a?.key ?? '').localeCompare(String(b?.key ?? '')))
    .map((o) =>
      [
        normText(o?.key),
        normText(o?.text),
        normText(o?.textHi),
        normText(o?.diagramType),
        normText((o?.diagramLabels ?? []).join(',')),
        normText(o?.imageUrl),
      ].join('~'),
    )
    .join('|');
}

/** Comparable value of one field. */
export function fieldValue(q: ComparableQuestion, f: ComparedField): string {
  switch (f) {
    case 'options':
      return optionsSignature(q);
    case 'year':
      return q.year == null ? '' : String(q.year);
    case 'correctAnswer':
      return normText(q.correctAnswer);
    default:
      return normText((q as any)[f]);
  }
}

export interface CompareResult {
  /** true = every compared field is identical. */
  exact: boolean;
  matchType: MatchType;
  /** fields that differ (empty when exact). */
  differences: ComparedField[];
}

/**
 * Compare two questions that are already known to be "the same question"
 * (same hash). Returns which details differ.
 */
export function compareQuestions(a: ComparableQuestion, b: ComparableQuestion): CompareResult {
  const differences = COMPARED_FIELDS.filter((f) => fieldValue(a, f) !== fieldValue(b, f));
  const exact = differences.length === 0;
  return { exact, matchType: exact ? 'EXACT' : 'SIMILAR', differences: [...differences] };
}
