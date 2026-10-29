/**
 * Exam reference lookup for the question importer (S37, 29 Oct 2026).
 *
 * Until now `examId` had to be the exact slug (or the database id). A cell such as "SSC CGL", "cgl" or "Exam-CGL"
 * failed with "examId not found" although the exam exists. The lookup below also accepts the exam's code and name,
 * case-insensitively, with spaces / underscores treated as hyphens. An exam that does NOT exist stays unknown on
 * purpose: the admin creates it in /admin/exams (the importer never invents exams).
 *
 * Pure functions (no Nest / Prisma).
 */

export interface ExamRefRow {
  id: string;
  slug: string;
  name: string;
  code?: string | null;
}

/** "SSC CGL" / "ssc_cgl" / " Exam-CGL " -> "ssc-cgl" / "ssc-cgl" / "exam-cgl". Empty input -> "". */
export function examAliasKey(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * alias -> exam id. Priority when two exams would claim the same alias: exact slug, then code, then name
 * (first writer wins, so a slug is never shadowed by someone else's name).
 */
export function buildExamAliasMap(exams: readonly ExamRefRow[]): Map<string, string> {
  const map = new Map<string, string>();
  const put = (k: string, id: string) => {
    if (k && !map.has(k)) map.set(k, id);
  };
  for (const e of exams) put(e.slug, e.id); // exact slug, as written in the database
  for (const e of exams) put(examAliasKey(e.slug), e.id);
  for (const e of exams) put(examAliasKey(e.code), e.id);
  for (const e of exams) put(examAliasKey(e.name), e.id);
  // The sheets use "exam-cgl" while some databases hold the slug "cgl" (and the other way round): accept both spellings.
  // These come last, so they never shadow a real slug, code or name.
  for (const e of exams) {
    const k = examAliasKey(e.slug);
    put(k.startsWith('exam-') ? k.slice(5) : `exam-${k}`, e.id);
    const c = examAliasKey(e.code);
    if (c) put(`exam-${c}`, e.id);
  }
  return map;
}

/** The exam id a cell value points to, or undefined (blank, unknown, or an id that is not in the list). */
export function resolveExamRef(value: unknown, exams: readonly ExamRefRow[], aliasMap?: Map<string, string>): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const ids = new Set(exams.map((e) => e.id));
  if (ids.has(raw)) return raw;
  const map = aliasMap ?? buildExamAliasMap(exams);
  return map.get(raw) ?? map.get(examAliasKey(raw));
}

export interface UnknownExamGroup {
  /** the cell text as written ('' = the cell is empty) */
  value: string;
  rows: number[];
  count: number;
}

/** Groups the rows whose examId does not exist, so the report says it once per exam instead of once per row. */
export function groupUnknownExams(rows: ReadonlyArray<{ row: number; examId: unknown }>, exams: readonly ExamRefRow[]): UnknownExamGroup[] {
  const map = buildExamAliasMap(exams);
  const groups = new Map<string, UnknownExamGroup>();
  for (const r of rows) {
    if (resolveExamRef(r.examId, exams, map)) continue;
    const value = String(r.examId ?? '').trim();
    const g = groups.get(value) ?? { value, rows: [], count: 0 };
    g.count++;
    if (g.rows.length < 50) g.rows.push(r.row);
    groups.set(value, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/**
 * Hinglish message for ONE unknown examId. `existing` is a short list of valid slugs so the admin sees the right spelling.
 */
export function unknownExamMessage(value: string, existing: readonly string[]): string {
  const list = existing.slice(0, 12).join(', ');
  if (!value) {
    return `examId is empty. Write the exam slug from the Reference IDs sheet (${list || 'no exam exists yet'}).`;
  }
  return (
    `examId "${value}" is not in the database. Create this exam first: Admin -> Exams (/admin/exams) -> "Add exam" ` +
    `(or the "Add common exams" button for Selection Post / Railway ...), then upload again. Valid exams now: ${list || 'none'}.`
  );
}
