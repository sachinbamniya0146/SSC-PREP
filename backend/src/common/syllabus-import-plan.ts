/**
 * Syllabus-Excel importer decisions (S41, 29 Oct 2026). Pure, unit-tested in syllabus-import-plan.spec.ts.
 *
 * Before S41 the importer
 *   - matched a subject only by ONE exact slug ("reasoning"), so a database whose questions live under the Excel spelling
 *     "sub-reasoning" got the syllabus attached to the other (empty) subject, and a new sheet like "General Science"
 *     became slug "general-science" while every Excel / Master Package sheet writes "sub-general_science";
 *   - matched a chapter only by `slugify(name)` ("percentage"), so re-importing next to chapters created from the
 *     Master Package ("chap-percentage-quantitative_aptitude") added a SECOND "Percentage" chapter.
 * Now: subject = same core slug (either spelling) or same name; chapter = same normalised name inside the subject (the same
 * twin rule topics already use); anything genuinely new follows the spelling the database already uses.
 */
import { subjectCoreKey } from './slug-core';

export interface SubjectCandidate {
  id: string;
  slug: string;
  name: string;
  chapters: number;
}

const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** "General Science" -> "general_science"; "Quant Aptitude (Maths)" -> "quant_aptitude_maths". */
export function coreFromName(name: string): string {
  return subjectCoreKey(
    String(name ?? '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '_'),
  );
}

/**
 * The existing subject a syllabus sheet means, or null (= create a new one).
 * `cores` are the keys the sheet can stand for (core alias of the sheet name, the sheet name, the row-1 title).
 * Several rows of the same subject (both spellings) -> the one that already has the most chapters, then the exact preferred slug.
 */
export function pickSubject(cores: string[], names: string[], subjects: SubjectCandidate[], preferredSlug?: string): SubjectCandidate | null {
  const want = new Set(cores.map(subjectCoreKey).filter(Boolean));
  const byCore = subjects.filter((s) => want.has(subjectCoreKey(s.slug)));
  const pool = byCore.length ? byCore : subjects.filter((s) => names.some((n) => n && norm(n) === norm(s.name)));
  if (!pool.length) return null;
  // most chapters first; on a tie the Excel / Master Package spelling ("sub-...", where uploaded questions live), then the preferred slug
  const sub = (s: SubjectCandidate) => Number(s.slug.toLowerCase().startsWith('sub-'));
  return [...pool].sort((a, b) => b.chapters - a.chapters || sub(b) - sub(a) || Number(b.slug === preferredSlug) - Number(a.slug === preferredSlug))[0];
}

/** Spelling for a NEW subject: the Master Package style ("sub-general_science") when the database already uses it. */
export function newSubjectSlug(core: string, existingSlugs: string[]): string {
  const usesSub = existingSlugs.some((s) => s.toLowerCase().startsWith('sub-'));
  return usesSub ? `sub-${core}` : core;
}

/**
 * Spelling for a NEW chapter: "chap-<name>-<subject core>" when the subject's chapters (or, for a new subject, the
 * database's chapters) use that style, otherwise the old hyphen slug. Always unique inside the subject.
 */
export function newChapterSlug(name: string, subjectCore: string, siblingSlugs: string[], dbUsesChapPrefix: boolean): string {
  const usesChap = siblingSlugs.length ? siblingSlugs.filter((s) => s.startsWith('chap-')).length * 2 >= siblingSlugs.length : dbUsesChapPrefix;
  const base = usesChap
    ? `chap-${coreFromName(name) || 'chapter'}-${subjectCore}`.slice(0, 100)
    : String(name ?? '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100) || 'item';
  const taken = new Set(siblingSlugs);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** A sheet is a syllabus sheet only when row 4 is the header (S.No. | Chapter No. | Chapter | Topic | Sub-Topic). */
export function isSyllabusHeader(row: unknown[] | undefined): boolean {
  if (!Array.isArray(row)) return false;
  const c = (i: number) => norm(row[i] == null ? '' : String(row[i]));
  return c(2).startsWith('chapter') && c(3).startsWith('topic');
}
