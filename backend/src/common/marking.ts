/**
 * ONE place that decides "how many marks is this answer worth, and what does a wrong answer cost".
 *
 * Before 28 Oct 2026 only attempts with a frozen strict-section plan used the ExamPattern; every other test
 * (date-wise PYQ papers, year-wise, sectional, non-locked patterns) was scored with each question's own
 * `marks` / `negativeMarks` columns — which default to 2 / 0.5 for every row and are therefore wrong for CPO,
 * Stenographer, MTS, JE, GD ... (e.g. CPO Paper 1 is 1 mark / -0.25, MTS Session I has no negative marking).
 *
 * Order of authority (first hit wins):
 *   1. the attempt's FROZEN section plan      — an attempt keeps the rules it started with
 *   2. the ExamPattern (section by subject)   — the official preset, also for patterns that do not lock sections
 *   3. the question's own columns             — practice sets and exams that have no preset at all
 *
 * Pure (no Prisma, no Nest) so it is table-testable; the DB lookups live in tests/marking-scheme.ts.
 */
import { SectionPlan, negativeUnderPlan, readPatternSections, sectionIndexForSubject } from './section-plan';
import { subjectCoreKey } from './slug-core';

export type MarkingSource = 'plan' | 'pattern' | 'question';

export interface MarkingRule {
  marks: number;
  negative: number;
  source: MarkingSource;
}

export interface SchemeSection {
  name: string;
  subjectSlug: string | null;
  questions: number;
  marksPerQuestion: number;
  negative: number;
}

export interface MarkingScheme {
  patternId: string | null;
  patternName: string;
  sections: SchemeSection[];
  totalQuestions: number;
  totalMarks: number;
  /** Set when every section has the same marks and penalty — then ANY subject can be scored, named in the pattern or not. */
  uniform: { marks: number; negative: number } | null;
}

export type PatternForMarking = {
  id?: string | null;
  name?: string | null;
  negativeMarks?: number | null;
  sections: unknown;
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Turns an ExamPattern row into a marking scheme. null = the pattern has no usable section (marks and questions > 0). */
export function buildMarkingScheme(pattern: PatternForMarking | null | undefined): MarkingScheme | null {
  if (!pattern) return null;
  const rows = readPatternSections(pattern.sections).filter((r) => (r.questions ?? 0) > 0 && (r.marks ?? 0) > 0);
  if (rows.length === 0) return null;
  const patternNeg = Number.isFinite(Number(pattern.negativeMarks)) ? Math.max(0, Number(pattern.negativeMarks)) : 0;
  const sections: SchemeSection[] = rows.map((r) => ({
    name: r.name,
    subjectSlug: r.subjectSlug ?? null,
    questions: r.questions as number,
    // 4 decimals (S42): UPSC CDS gives 100 marks for 120 questions; 0.833 x 120 = 99.96, 0.8333 x 120 rounds to the full 100
    marksPerQuestion: round4((r.marks as number) / (r.questions as number)),
    negative: r.negativeMarks != null ? r.negativeMarks : patternNeg,
  }));
  const first = sections[0];
  const same = sections.every((s) => s.marksPerQuestion === first.marksPerQuestion && s.negative === first.negative);
  return {
    patternId: pattern.id ?? null,
    patternName: pattern.name ?? '',
    sections,
    totalQuestions: sections.reduce((a, s) => a + s.questions, 0),
    totalMarks: round2(rows.reduce((a, r) => a + (r.marks as number), 0)),
    uniform: same ? { marks: first.marksPerQuestion, negative: first.negative } : null,
  };
}

/** The scheme's rule for a subject: its own section, else the uniform rule, else null (cannot tell). */
export function schemeRuleFor(scheme: MarkingScheme, subjectSlug?: string | null): { marks: number; negative: number } | null {
  const slug = (subjectSlug ?? '').trim().toLowerCase();
  if (slug) {
    // S41: exact slug first, then the same subject in its other spelling ("sub-english" == "english").
    const hit = scheme.sections.find((s) => s.subjectSlug && s.subjectSlug === slug) ?? scheme.sections.find((s) => s.subjectSlug && subjectCoreKey(s.subjectSlug) === subjectCoreKey(slug));
    if (hit) return { marks: hit.marksPerQuestion, negative: hit.negative };
  }
  return scheme.uniform;
}

export interface ResolveInput {
  plan?: SectionPlan | null;
  scheme?: MarkingScheme | null;
  subjectSlug?: string | null;
  question?: { marks?: number | null; negativeMarks?: number | null } | null;
}

const DEFAULT_MARKS = 2;
const DEFAULT_NEGATIVE = 0.5;

export function resolveMarking(input: ResolveInput): MarkingRule {
  const q = input.question ?? {};
  const qMarks = typeof q.marks === 'number' && Number.isFinite(q.marks) ? q.marks : DEFAULT_MARKS;
  const qNeg = typeof q.negativeMarks === 'number' && Number.isFinite(q.negativeMarks) ? q.negativeMarks : DEFAULT_NEGATIVE;

  if (input.plan) {
    const idx = sectionIndexForSubject(input.plan, input.subjectSlug);
    const s = input.plan.sections[idx];
    return {
      marks: s && s.marksPerQuestion > 0 ? s.marksPerQuestion : qMarks,
      negative: negativeUnderPlan(input.plan, idx),
      source: 'plan',
    };
  }
  if (input.scheme) {
    const r = schemeRuleFor(input.scheme, input.subjectSlug);
    if (r) return { marks: r.marks, negative: r.negative, source: 'pattern' };
  }
  return { marks: qMarks, negative: qNeg, source: 'question' };
}

/** Score delta of one answer. Unanswered = 0, correct = +marks, wrong = -negative. */
export function scoreAnswer(rule: MarkingRule, answered: boolean, correct: boolean): number {
  if (!answered) return 0;
  return correct ? rule.marks : -rule.negative;
}

/** Sum of the marks a paper is worth, scored question by question under the same resolver the attempt will use. */
export function totalMarksFor(scheme: MarkingScheme | null | undefined, rows: { subjectSlug?: string | null; marks?: number | null }[]): number {
  let sum = 0;
  for (const r of rows) sum += resolveMarking({ scheme, subjectSlug: r.subjectSlug, question: { marks: r.marks } }).marks;
  return round2(sum);
}

/**
 * "Out of how many marks?" for a paper that holds `totalQuestions` questions.
 *   - the full paper                  -> the pattern's own total;
 *   - a partial paper, uniform marks  -> questions x marks;
 *   - a partial paper, mixed marks    -> pattern total scaled by the share of questions that exist.
 */
export function schemeMaxMarks(scheme: MarkingScheme, totalQuestions: number): number {
  if (totalQuestions === scheme.totalQuestions) return scheme.totalMarks;
  if (scheme.uniform) return round2(totalQuestions * scheme.uniform.marks);
  return round2((scheme.totalMarks * totalQuestions) / Math.max(1, scheme.totalQuestions));
}
