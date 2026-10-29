/**
 * "Common exams" quick-add (S37, 29 Oct 2026).
 *
 * Sachin: Railway / Selection Post / Delhi Police ke PYQ bhi usi Excel me aane chahiye. The importer never invents an
 * exam, so these exams must exist as rows first. This list is only name + slug + code (NO marking data - the marking
 * scheme of each exam stays the admin's ExamPattern). The slug follows the Master Package IDs (`exam-cgl`, `exam-gd`, `exam-dp` ...); a database that holds the same exam without the `exam-` prefix counts as existing.
 *
 * planCommonExams is pure: it never creates an exam whose slug, code or name already exists (case-insensitive).
 */
export interface CommonExam {
  name: string;
  slug: string;
  code: string;
  /** Other slugs under which the same exam may already exist (same list the marking presets use). */
  alsoSlugs?: string[];
}

export const COMMON_EXAMS: CommonExam[] = [
  { name: 'SSC Selection Post', slug: 'exam-selection-post', code: 'SELPOST' },
  { name: 'SSC GD Constable', slug: 'exam-gd', code: 'GD', alsoSlugs: ['gd-constable', 'constable-gd'] },
  { name: 'SSC Stenographer', slug: 'exam-steno', code: 'STENO', alsoSlugs: ['stenographer', 'ssc-steno', 'stenographer-c-d'] },
  { name: 'SSC JE', slug: 'exam-je', code: 'SSCJE', alsoSlugs: ['ssc-je', 'junior-engineer'] },
  { name: 'Delhi Police Constable', slug: 'exam-dp', code: 'DP', alsoSlugs: ['delhi-police'] },
  { name: 'RRB NTPC', slug: 'exam-rrb-ntpc', code: 'RRBNTPC' },
  { name: 'RRB Group D', slug: 'exam-rrb-group-d', code: 'RRBGD' },
  { name: 'RRB ALP', slug: 'exam-rrb-alp', code: 'RRBALP' },
  { name: 'RRB JE', slug: 'exam-rrb-je', code: 'RRBJE' },
];

export interface ExistingExamKey {
  name: string;
  slug: string;
  code: string;
}

export interface CommonExamPlanRow extends CommonExam {
  status: 'NEW' | 'EXISTS';
  /** Slug of the exam already in the database that makes this one a duplicate. */
  existingSlug?: string;
}

const norm = (s: string) => String(s ?? '').trim().toLowerCase();
/** "exam-gd" and "gd" are the same exam */
const slugKey = (s: string) => norm(s).replace(/^exam-/, '');

export function planCommonExams(existing: ExistingExamKey[], list: CommonExam[] = COMMON_EXAMS): CommonExamPlanRow[] {
  return list.map((c) => {
    const hit = existing.find((e) => slugKey(e.slug) === slugKey(c.slug) || (c.alsoSlugs ?? []).some((a) => slugKey(a) === slugKey(e.slug)) || norm(e.code) === norm(c.code) || norm(e.name) === norm(c.name));
    return hit ? { ...c, status: 'EXISTS' as const, existingSlug: hit.slug } : { ...c, status: 'NEW' as const };
  });
}
