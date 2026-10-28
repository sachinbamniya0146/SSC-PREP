// The question list of an attempt (session 25, 28 Oct 2026).
//
// A normal mock stored NO list of its questions: the paper is composed from the question bank every time it is asked for, and an attempt only
// knew the questions the student had touched (autosave rows). So an abandoned / expired attempt had totals and a review for those rows only,
// and autosave accepted ANY question id (a score could pass the paper maximum). `TestAttempt.questionSnapshot` (already in the schema, no
// migration) now also holds the paper's question ids for the PYQ papers and the year-wise tests; this file is the one place that reads it.

/** Every question id of a composed paper (`paper()` output: sections -> questions), in paper order, without repeats. */
export function paperQuestionIds(paper: { sections?: { questions?: { id?: string | null }[] | null }[] | null } | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const sec of paper?.sections ?? []) {
    for (const q of sec?.questions ?? []) {
      const id = q?.id;
      if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

/** The stored list of an attempt, or null when it has none (older attempts, daily / study-plan tests keep their own list elsewhere). */
export function readPaperSnapshot(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
  if (ids.length === 0) return null;
  return Array.from(new Set(ids));
}

/**
 * Templates whose questions the student gets from `GET /tests/paper/:id` and from nowhere else: the auto-built PYQ papers
 * (`pyq-<slug>` and the date-wise `pyq-k-...`, type SHIFT_WISE). For these the paper composer is the single source, so its list is the paper.
 * Other templates (generic full mocks, the CGL sectional page ...) are served by other composers: no list is guessed for them.
 */
export function hasCanonicalPaper(template: { id: string; type: string } | null | undefined): boolean {
  return !!template && template.type === 'SHIFT_WISE' && template.id.startsWith('pyq-');
}
