/**
 * One spelling-proof key for exam and subject slugs (S41, 29 Oct 2026).
 *
 * The same exam / subject exists under two spellings in this project:
 *   - the app's own seeds and code:        cgl, chsl ...        reasoning, quantitative_aptitude, english ...
 *   - the Master Package / Excel sheets:   exam-cgl, exam-chsl  sub-reasoning, sub-quantitative_aptitude, sub-english ...
 * The Excel importer saves questions under the sheet's spelling, while mocks, sectional tests, daily tests, study-plan
 * tests and the PDF export looked subjects up by the code's spelling - so a question could be uploaded fine and still
 * never reach a mock, and an English question without Hindi was hidden when its subject was "sub-english".
 *
 * Every read path now compares the CORE key, so both spellings mean the same exam / subject:
 *   examCoreKey('exam-cgl') === examCoreKey('CGL') === 'cgl'
 *   subjectCoreKey('sub-quantitative_aptitude') === subjectCoreKey('quantitative-aptitude') === 'quantitative_aptitude'
 *
 * Pure functions, no Nest / Prisma import (unit-tested in slug-core.spec.ts).
 */

/** "exam-cgl" / "EXAM_CGL" / " cgl " / "ssc_cgl" -> "cgl" / "cgl" / "cgl" / "ssc-cgl". */
export function examCoreKey(slug: string | null | undefined): string {
  let s = String(slug ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (s.startsWith('exam-')) s = s.slice(5);
  return s;
}

/** "sub-quantitative_aptitude" / "Quantitative-Aptitude" -> "quantitative_aptitude"; "sub-english" -> "english". */
export function subjectCoreKey(slug: string | null | undefined): string {
  let s = String(slug ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (s.startsWith('sub_')) s = s.slice(4);
  return s;
}

export interface SlugRow {
  id: string;
  slug: string;
}

/**
 * Every subject id whose slug means `slug` (both spellings). The exact slug comes first, so a caller that needs ONE id
 * gets the row it asked for when it exists.
 */
export function subjectIdsFor(subjects: SlugRow[], slug: string | null | undefined): string[] {
  const want = String(slug ?? '').trim().toLowerCase();
  const core = subjectCoreKey(want);
  if (!core) return [];
  const exact = subjects.filter((s) => s.slug.toLowerCase() === want).map((s) => s.id);
  const rest = subjects.filter((s) => s.slug.toLowerCase() !== want && subjectCoreKey(s.slug) === core).map((s) => s.id);
  return [...exact, ...rest];
}

/** Resolver built once per request: core key -> every subject id with that core. */
export function subjectResolver(subjects: SlugRow[]): (slug: string | null | undefined) => string[] {
  return (slug) => subjectIdsFor(subjects, slug);
}

/** The exam a list of wanted slugs means (exact slug first, then the same core key). */
export function findExamBySlugs<T extends SlugRow>(exams: T[], wanted: string[]): T | undefined {
  const lower = wanted.map((w) => w.trim().toLowerCase()).filter(Boolean);
  const exact = exams.find((e) => lower.includes(e.slug.toLowerCase()));
  if (exact) return exact;
  const cores = new Set(lower.map(examCoreKey).filter(Boolean));
  return exams.find((e) => cores.has(examCoreKey(e.slug)));
}

/** True for the English subject in any spelling ("english", "sub-english", "english_language" ...). */
export function isEnglishSubjectSlug(slug: string | null | undefined): boolean {
  const core = subjectCoreKey(slug);
  return core === 'english' || core.startsWith('english_');
}

/**
 * Prisma relation filter for "the question's subject is English", in every spelling. Used inside
 * `OR: [{ questionTextHindi: { not: '' } }, HINDI_EXEMPT_SUBJECT_FILTER]` (English questions need no Hindi).
 */
export const HINDI_EXEMPT_SUBJECT_FILTER = {
  subject: {
    OR: [
      { slug: { in: ['english', 'sub-english', 'sub_english'] } },
      { slug: { startsWith: 'english-' } },
      { slug: { startsWith: 'english_' } },
      { slug: { startsWith: 'sub-english-' } },
      { slug: { startsWith: 'sub-english_' } },
    ],
  },
};

/**
 * Lookup map for an Excel subjectId cell: the exact slug always wins; otherwise the same subject in its other spelling
 * ("quantitative_aptitude" finds "sub-quantitative_aptitude"), or its name ("Quantitative Aptitude"). Never invents a subject.
 */
export function subjectAliasMap(subjects: { id: string; slug: string; name?: string | null }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of subjects) m.set(s.slug, s.id);
  const put = (k: string, id: string) => {
    if (k && !m.has(k)) m.set(k, id);
  };
  for (const s of subjects) {
    const core = subjectCoreKey(s.slug);
    put(s.slug.toLowerCase(), s.id);
    put(core, s.id);
    put(`sub-${core}`, s.id);
    put(core.replace(/_/g, '-'), s.id);
    put(`sub-${core.replace(/_/g, '-')}`, s.id);
    if (s.name) put(s.name.trim().toLowerCase(), s.id);
  }
  return m;
}

/** Same map, also answering for a cell typed in another case or with spaces ("Sub-Reasoning ", "general awareness"). */
export function lookupSubject(m: Map<string, string>, raw: string | null | undefined): string | undefined {
  const v = String(raw ?? '').trim();
  if (!v) return undefined;
  return m.get(v) ?? m.get(v.toLowerCase()) ?? m.get(subjectCoreKey(v)) ?? m.get(`sub-${subjectCoreKey(v)}`);
}

/**
 * S45: the Master Package writes chapter ids as "chap-<name>-<subject>" ("chap-percentage-quantitative_aptitude") while the
 * database stores "percentage" / "alphabet-series" / "static_gk". Returns the chapter part as words ("percentage",
 * "static gk"), or null when the cell is not in that form. Compared through the normal name key, so it also matches the name.
 */
export function chapterRefWords(raw: string | null | undefined): string | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!/^chap[-_]./.test(v)) return null;
  // "chap-<name>-<subject>": the subject is the LAST hyphen part when it is a subject-like token (letters / underscores)
  const parts = v.slice(5).split('-');
  const inner = parts.length > 1 ? parts.slice(0, -1).join('-') : parts[0];
  const words = inner.replace(/[_-]+/g, ' ').trim();
  return words || null;
}
