/**
 * Exam catalog quick-add (S37, extended to the full catalog in S41 - 29 Oct 2026).
 *
 * Sachin: "sabhi exams hamare system me ho, jin exams ke questions add ho vhi dikhe, baki hidden".
 * The importer never invents an exam, so every exam whose PYQ may come in an Excel must exist as a row first. This list is
 * only name + slug + code + category (NO marking data - the marking scheme lives in common/exam-presets.ts and the
 * admin's ExamPattern). Creating the whole catalog is safe: GET /bank/meta shows students only exams that have at
 * least one published question, so an exam stays hidden until its first question is live and then appears by itself.
 *
 * The slug follows the Master Package IDs (`exam-cgl`, `exam-gd`, `exam-rrb-ntpc` ...); a database that holds the same
 * exam without the `exam-` prefix (or under another known slug, code or name) counts as existing and is never duplicated.
 *
 * planCommonExams is pure (unit-tested in common-exams.spec.ts).
 */
import { examCoreKey } from './slug-core';

export type ExamCategory = 'SSC' | 'RAILWAY' | 'BANKING' | 'INSURANCE' | 'DEFENCE' | 'STATE_POLICE';

export const EXAM_CATEGORY_LABEL: Record<ExamCategory, string> = {
  SSC: 'SSC',
  RAILWAY: 'Railway (RRB / RPF)',
  BANKING: 'Banking',
  INSURANCE: 'Insurance',
  DEFENCE: 'Defence',
  STATE_POLICE: 'State Police',
};

export interface CommonExam {
  name: string;
  slug: string;
  code: string;
  category: ExamCategory;
  /** Other slugs under which the same exam may already exist (same lists the marking presets use). */
  alsoSlugs?: string[];
}

export const COMMON_EXAMS: CommonExam[] = [
  // ---- SSC ----
  { category: 'SSC', name: 'SSC CGL', slug: 'exam-cgl', code: 'CGL' },
  { category: 'SSC', name: 'SSC CHSL', slug: 'exam-chsl', code: 'CHSL' },
  { category: 'SSC', name: 'SSC MTS', slug: 'exam-mts', code: 'MTS' },
  { category: 'SSC', name: 'SSC CPO', slug: 'exam-cpo', code: 'CPO' },
  { category: 'SSC', name: 'SSC GD Constable', slug: 'exam-gd', code: 'GD', alsoSlugs: ['gd-constable', 'constable-gd'] },
  { category: 'SSC', name: 'SSC Stenographer', slug: 'exam-steno', code: 'STENO', alsoSlugs: ['stenographer', 'ssc-steno', 'stenographer-c-d'] },
  { category: 'SSC', name: 'SSC JE', slug: 'exam-je', code: 'SSCJE', alsoSlugs: ['ssc-je', 'junior-engineer'] },
  { category: 'SSC', name: 'SSC Selection Post', slug: 'exam-selection-post', code: 'SELPOST', alsoSlugs: ['selection_post', 'selection'] },
  { category: 'SSC', name: 'SSC JHT', slug: 'exam-jht', code: 'JHT', alsoSlugs: ['junior-hindi-translator'] },
  { category: 'SSC', name: 'Delhi Police Constable', slug: 'exam-dp', code: 'DP', alsoSlugs: ['delhi-police', 'delhi-police-constable'] },
  { category: 'SSC', name: 'Delhi Police Head Constable', slug: 'exam-dp-hc', code: 'DPHC', alsoSlugs: ['delhi-police-head-constable'] },
  // ---- Railway ----
  { category: 'RAILWAY', name: 'RRB NTPC', slug: 'exam-rrb-ntpc', code: 'RRBNTPC' },
  { category: 'RAILWAY', name: 'RRB Group D', slug: 'exam-rrb-group-d', code: 'RRBGD' },
  { category: 'RAILWAY', name: 'RRB ALP', slug: 'exam-rrb-alp', code: 'RRBALP' },
  { category: 'RAILWAY', name: 'RRB Technician', slug: 'exam-rrb-technician', code: 'RRBTECH' },
  { category: 'RAILWAY', name: 'RRB JE', slug: 'exam-rrb-je', code: 'RRBJE' },
  { category: 'RAILWAY', name: 'RPF Constable', slug: 'exam-rpf-constable', code: 'RPFCONST' },
  { category: 'RAILWAY', name: 'RPF SI', slug: 'exam-rpf-si', code: 'RPFSI' },
  // ---- Banking ----
  { category: 'BANKING', name: 'IBPS PO', slug: 'exam-ibps-po', code: 'IBPSPO' },
  { category: 'BANKING', name: 'IBPS Clerk', slug: 'exam-ibps-clerk', code: 'IBPSCLERK' },
  { category: 'BANKING', name: 'IBPS RRB PO', slug: 'exam-ibps-rrb-po', code: 'IBPSRRBPO' },
  { category: 'BANKING', name: 'IBPS RRB Clerk', slug: 'exam-ibps-rrb-clerk', code: 'IBPSRRBCLERK' },
  { category: 'BANKING', name: 'SBI PO', slug: 'exam-sbi-po', code: 'SBIPO' },
  { category: 'BANKING', name: 'SBI Clerk', slug: 'exam-sbi-clerk', code: 'SBICLERK' },
  { category: 'BANKING', name: 'RBI Assistant', slug: 'exam-rbi-assistant', code: 'RBIASST' },
  { category: 'BANKING', name: 'RBI Grade B', slug: 'exam-rbi-grade-b', code: 'RBIGRB' },
  // ---- Insurance ----
  { category: 'INSURANCE', name: 'LIC AAO', slug: 'exam-lic-aao', code: 'LICAAO' },
  { category: 'INSURANCE', name: 'LIC Assistant', slug: 'exam-lic-assistant', code: 'LICASST' },
  { category: 'INSURANCE', name: 'NIACL AO', slug: 'exam-niacl-ao', code: 'NIACLAO' },
  { category: 'INSURANCE', name: 'NIACL Assistant', slug: 'exam-niacl-assistant', code: 'NIACLASST' },
  // ---- Defence ----
  { category: 'DEFENCE', name: 'UPSC CDS', slug: 'exam-cds', code: 'CDS' },
  { category: 'DEFENCE', name: 'UPSC NDA', slug: 'exam-nda', code: 'NDA' },
  { category: 'DEFENCE', name: 'UPSC CAPF AC', slug: 'exam-capf-ac', code: 'CAPFAC' },
  { category: 'DEFENCE', name: 'AFCAT', slug: 'exam-afcat', code: 'AFCAT' },
  { category: 'DEFENCE', name: 'Agniveer Army', slug: 'exam-agniveer-army', code: 'AGNIARMY' },
  { category: 'DEFENCE', name: 'Agniveer Air Force', slug: 'exam-agniveer-airforce', code: 'AGNIIAF', alsoSlugs: ['agniveervayu'] },
  { category: 'DEFENCE', name: 'Agniveer Navy', slug: 'exam-agniveer-navy', code: 'AGNINAVY' },
  { category: 'DEFENCE', name: 'Indian Coast Guard Navik', slug: 'exam-icg-navik', code: 'ICGNAVIK' },
  // ---- State police ----
  { category: 'STATE_POLICE', name: 'UP Police Constable', slug: 'exam-up-police-constable', code: 'UPPC' },
  { category: 'STATE_POLICE', name: 'UP Police SI', slug: 'exam-up-police-si', code: 'UPSI' },
  { category: 'STATE_POLICE', name: 'Bihar Police Constable', slug: 'exam-bihar-police-constable', code: 'BPC' },
  { category: 'STATE_POLICE', name: 'Rajasthan Police Constable', slug: 'exam-rajasthan-police-constable', code: 'RJPC' },
  { category: 'STATE_POLICE', name: 'MP Police Constable', slug: 'exam-mp-police-constable', code: 'MPPC' },
  { category: 'STATE_POLICE', name: 'Haryana Police Constable', slug: 'exam-haryana-police-constable', code: 'HRPC' },
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

/** The catalog row an existing exam belongs to (by slug in any spelling, known other slug, code or name). */
export function catalogRowFor(e: ExistingExamKey, list: CommonExam[] = COMMON_EXAMS): CommonExam | undefined {
  const core = examCoreKey(e.slug);
  return list.find(
    (c) =>
      examCoreKey(c.slug) === core ||
      (c.alsoSlugs ?? []).some((a) => examCoreKey(a) === core) ||
      (!!e.code && norm(e.code) === norm(c.code)) ||
      (!!e.name && norm(e.name) === norm(c.name)),
  );
}

export function planCommonExams(existing: ExistingExamKey[], list: CommonExam[] = COMMON_EXAMS): CommonExamPlanRow[] {
  return list.map((c) => {
    const hit = existing.find((e) => catalogRowFor(e, [c]) !== undefined);
    return hit ? { ...c, status: 'EXISTS' as const, existingSlug: hit.slug } : { ...c, status: 'NEW' as const };
  });
}

/** Category of an exam row (catalog match), or null for an exam that is not in the catalog. */
export function examCategoryOf(e: ExistingExamKey): ExamCategory | null {
  return catalogRowFor(e)?.category ?? null;
}
