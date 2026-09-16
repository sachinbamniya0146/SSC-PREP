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
 */
export function dedupeAndCapPaperRows<T extends { id: string; questionText: string; createdAt: Date }>(
  rows: T[],
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
  return deduped.slice(0, MAX_PYQ_PAPER_QUESTIONS);
}
