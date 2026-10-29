/**
 * Row-level PYQ vs Practice (S37, 29 Oct 2026).
 *
 * Sachin: "ek hi Excel import se PYQ aur practice dono set ho jayein".
 * One sheet now carries both kinds of rows:
 *   - a row with a `year` (or an `examDate`, which gives the year)  => PYQ
 *   - a row with neither                                             => PRACTICE
 * The rule is the same one the whole site already uses (`year != null` = PYQ, see common/question-visibility.ts);
 * this file only applies it to ONE ROW, so the admin no longer has to split the file in two.
 *
 * A practice row never belongs to a paper: shift, paperCode, examDate, examTier, tierPaper and questionNo are cleared,
 * even when the sheet has them filled by mistake (a stray shift on a practice row would otherwise create a ghost "paper").
 *
 * Pure functions (no Nest / Prisma) so they are unit-tested on their own.
 */

export type RowKind = 'PYQ' | 'PRACTICE';

export interface KindFields {
  year?: number | null;
  examDate?: string | null;
}

/**
 * NaN counts as PYQ on purpose: an unreadable year must fail loudly later (the importer rejects it with a clear
 * message), it must never silently turn a PYQ into a practice question.
 */
export function rowKind(r: KindFields): RowKind {
  if (r.year !== undefined && r.year !== null) return 'PYQ';
  if (r.examDate) return 'PYQ';
  return 'PRACTICE';
}

export interface PaperFieldsLike {
  year?: number;
  shift?: string;
  paperCode?: string;
  examDate?: string;
  examTier?: string;
  tierPaper?: string;
  paperQuestionNo?: number;
}

/** Makes a row a pure practice question: no year, no paper identity at all. */
export function clearPaperFields(q: PaperFieldsLike): void {
  q.year = undefined;
  q.shift = undefined;
  q.paperCode = undefined;
  q.examDate = undefined;
  q.examTier = undefined;
  q.tierPaper = undefined;
  q.paperQuestionNo = undefined;
}

export interface KindTally {
  pyq: number;
  practice: number;
  /** PYQ rows without the printed question number: they join their mock in upload order. */
  pyqWithoutQuestionNo: number;
}

export function newKindTally(): KindTally {
  return { pyq: 0, practice: 0, pyqWithoutQuestionNo: 0 };
}

export function tallyRow(t: KindTally, kind: RowKind, q: { paperQuestionNo?: number | null }): void {
  if (kind === 'PRACTICE') {
    t.practice++;
    return;
  }
  t.pyq++;
  if (q.paperQuestionNo == null) t.pyqWithoutQuestionNo++;
}

/** ONE aggregated warning (never one per row): the mock order falls back to upload order. */
export function questionNoWarning(t: KindTally): string | null {
  if (t.pyqWithoutQuestionNo <= 0) return null;
  return (
    `${t.pyqWithoutQuestionNo} PYQ row(s) have no questionNo. They are saved and join their paper, but the mock shows them in upload order, ` +
    `not in the original paper order. Fill questionNo with the number printed in the ORIGINAL paper when you know it ` +
    `(a serial number of a chapter compilation is not a paper number - leave it blank instead).`
  );
}

/** True for the aggregated questionNo warning above (the job service merges chunk results and writes it once). */
export function isQuestionNoWarning(message: string): boolean {
  return / PYQ row\(s\) have no questionNo\./.test(message);
}

/** One line for the report: "PYQ: 57 · Practice: 44". */
export function kindSummary(t: KindTally): string {
  return `PYQ: ${t.pyq} · Practice: ${t.practice}`;
}
