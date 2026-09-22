/**
 * Single source of truth for "is this question safe to show a student".
 *
 * FIX for Error #8 (Round 2 audit) and Error #6 (Full audit):
 * Multiple files across the codebase were each writing their own
 * hand-rolled { isApproved: true } (or similar) where-clause, and none of
 * them agreed on whether isActive / autoSuspended were also checked.
 * That meant a question suspended after user error-reports could still
 * leak through some screens (e.g. bank.service.ts's browse()) while being
 * correctly blocked on others.
 *
 * Use this constant (or spread it) everywhere a Question is queried for
 * display to a student:
 *
 *   const rows = await this.prisma.question.findMany({
 *     where: { ...PUBLISHED_QUESTION_WHERE, chapterId },
 *     ...
 *   });
 *
 * Do NOT hand-write { isApproved: true, ... } anywhere else. If a new
 * condition needs to be added to "published" in the future, add it here
 * ONCE and every caller picks it up automatically.
 */
export const PUBLISHED_QUESTION_WHERE = {
  isApproved: true,
  isActive: true,
  autoSuspended: false,
} as const;

// ---------------------------------------------------------------------------
// PYQ vs PRACTICE (Sep 21 2026 — "practice option me pyq nahi aana chaiye")
//
// The schema has no separate "isPyq" column, and adding one would mean a
// data-migration of every existing row. The codebase already treats
// "tied to a specific year" as the definition of a PYQ (see
// BankService.questionsWithGaps()'s `isPyq` filter, and the upload
// `isPracticeOnly` flag that blanks year/shift/paperCode): a question with a
// `year` is a previous-year question, a question with year == null is a
// practice question. These helpers make that ONE definition reusable so the
// student practice screens, the PYQ browser, the admin manager and the
// exports can never drift apart on what "PYQ" means.
// ---------------------------------------------------------------------------
export type QuestionKind = 'pyq' | 'practice';

/** Only APPROVED, live, year-less (practice) questions. */
export const PRACTICE_QUESTION_WHERE = {
  ...PUBLISHED_QUESTION_WHERE,
  year: null,
} as const;

/** Only APPROVED, live, year-tagged (previous-year) questions. */
export const PYQ_QUESTION_WHERE = {
  ...PUBLISHED_QUESTION_WHERE,
  year: { not: null },
} as const;

/** Parses a ?kind= query value; anything unrecognised means "no filter". */
export function parseQuestionKind(raw?: string | null): QuestionKind | undefined {
  const v = (raw ?? '').toString().trim().toLowerCase();
  if (v === 'pyq') return 'pyq';
  if (v === 'practice') return 'practice';
  return undefined;
}

/** Prisma `where` fragment for a kind (empty object when kind is undefined). */
export function kindWhere(kind?: QuestionKind): { year?: null | { not: null } } {
  if (kind === 'pyq') return { year: { not: null } };
  if (kind === 'practice') return { year: null };
  return {};
}

// ---------------------------------------------------------------------------
// English subject exemption from the Hindi-translation gate.
//
// Read-side code all over the app already exempts subject slug "english" from
// the "must have questionTextHindi" filter (the question IS the English test —
// nothing to translate). The WRITE side (bank-upload.service.ts) did not, so
// every English question uploaded without Hindi was saved as
// isApproved=false / reviewStatus=PENDING and students never saw it — the exact
// "admin ne Noun ke 200 questions upload kiye par students ko nahi dikh rahe"
// bug. Shared here so upload + approve + read use the same rule.
// ---------------------------------------------------------------------------
export function isHindiExemptSubjectSlug(slug?: string | null): boolean {
  const s = (slug ?? '').toLowerCase().trim();
  return s === 'english' || s === 'sub-english' || s.startsWith('english-') || s.startsWith('english_');
}
