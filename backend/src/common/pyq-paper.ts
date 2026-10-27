/**
 * NEW (Sachin, Sep 2026 — "shift wise mock test me max 100 questions hone
 * the ye esa work kyu ni kr rha he" + year-wise "Full Paper" silently
 * serving 200+ question tests that then failed to submit/score properly).
 *
 * Root cause: nothing in this codebase ever capped a composed paper's
 * question count. Two call sites were affected:
 *
 *   1. BankUploadService.upsertPyqMockForPaper() — counted EVERY approved
 *      question matching (examId, year, shift, paperCode) across the whole
 *      DB, not just the current upload. A real SSC shift is always 100
 *      questions; if the same paper's questions were ever uploaded twice
 *      (a re-upload that inserted new rows instead of updating existing
 *      ones, or two admins uploading the same paper under slightly
 *      different metadata) the count silently grew past 100 and the mock's
 *      totalQuestions followed it up.
 *   2. TestsService.shiftWisePyqPaper() / yearWiseStart() — served every
 *      matching row with no upper bound, so a bloated group above produced
 *      an actually-oversized attempt (200+ questions), which is what
 *      surfaced on-screen as a broken results page (a paper that large
 *      made the submit → attemptDetail() round trip slow enough that the
 *      frontend's un-checked submit call (see test/page.tsx submitTest()
 *      fix) silently fell through to a blank "Answer not available"
 *      review screen).
 *
 * Fix: a single shared cap + de-dupe step, used by every place that
 * composes a real-paper (PYQ) question set. De-dupe (not just a blind
 * slice) so that leftover duplicate rows from a bad re-upload are the
 * first thing dropped, rather than truncating the paper on questions 81-100
 * while duplicates of questions 1-30 remain in the "kept" set. Ordered by
 * createdAt ascending (oldest / first-uploaded copy of a question wins)
 * so re-running this on the same data always keeps the SAME 100 questions
 * — deterministic, not "whichever DB scan order happened to run first".
 */
export const MAX_PYQ_PAPER_QUESTIONS = 100;

/** Trim, lowercase, collapse internal whitespace — good enough to catch
 * re-uploads of the same question text with different spacing/casing
 * without needing a real similarity/fuzzy-match algorithm here. */
export function normalizeQuestionTextForDedup(text: string): string {
  return (text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * De-dupes a set of rows belonging to ONE real paper (same
 * examId+year+shift+paperCode group) by normalized questionText, then
 * hard-caps the result at MAX_PYQ_PAPER_QUESTIONS. Callers should pass
 * every candidate row for the group — ordering/grouping-by-subject (if
 * needed for display) should happen AFTER this step, using the returned
 * (already-capped) array, so the "which 100 questions" decision is made
 * exactly once and every caller agrees on the same set.
 *
 * `ceiling` (27 Oct 2026): defaults to 100 (unchanged). Legacy paperCode papers whose ExamPattern says more than
 * 100 questions pass the pattern target (see legacyPaperCeiling() in bank/pyq-paper-builder.ts) so they are not
 * silently cut at 100. Upload (count) and serving MUST pass the same ceiling.
 */
export function dedupeAndCapPaperRows<T extends { id: string; questionText: string; createdAt: Date }>(
  rows: T[],
  ceiling: number = MAX_PYQ_PAPER_QUESTIONS,
): T[] {
  const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const r of ordered) {
    const key = normalizeQuestionTextForDedup(r.questionText);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  return deduped.slice(0, ceiling);
}

/**
 * DATE-WISE PYQ MOCKS (26 Oct 2026): rows of ONE keyed paper (examId + tier + tierPaper +
 * examDate + shift, see pyq-paper-key.ts). Same duplicate-text drop as dedupeAndCapPaperRows
 * (oldest copy wins) but capped at KEYED_PAPER_CEILING instead of 100, because a Tier 2 paper is
 * longer than 100 questions. The ordering handed back is the real paper order: printed
 * question number first (when present), then upload order.
 * BankUploadService (count) and TestsService (serve) both call this so they always agree.
 */
export function dedupeKeyedPaperRows<T extends { id: string; questionText: string; createdAt: Date; paperQuestionNo?: number | null }>(
  rows: T[],
  ceiling: number,
): T[] {
  const oldestFirst = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const r of oldestFirst) {
    const key = normalizeQuestionTextForDedup(r.questionText);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(r);
  }
  const capped = kept.slice(0, ceiling);
  return capped.sort((a, b) => {
    const an = a.paperQuestionNo ?? Number.MAX_SAFE_INTEGER;
    const bn = b.paperQuestionNo ?? Number.MAX_SAFE_INTEGER;
    if (an !== bn) return an - bn;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}
