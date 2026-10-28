/**
 * Finds the marking scheme (the ExamPattern preset) an attempt is scored under.
 * Kept free of Nest imports and taking a structural Prisma, like pyq-paper-builder.ts, so a fake can stand in for it
 * (marking-scheme.spec.ts). The pure rules live in common/marking.ts.
 *
 * Which pattern?
 *   1. the template's linked pattern (`examPatternId`)  — the admin said so explicitly;
 *   2. the exam + tier + paper of the template, else of the questions themselves, when they all agree;
 *   3. questions of one exam without any tier           — the exam's Tier 1 / Paper 1 pattern, if it is the only one;
 *   4. nothing                                          — mixed exams or no preset: callers use the question's own columns.
 */
import { cacheGet, cacheSet } from '../common/cache';
import { MarkingScheme, buildMarkingScheme } from '../common/marking';
import { classifyPatternName } from '../common/exam-presets';
import { effectiveTierPaper } from '../common/pyq-paper-key';

export interface MarkingPrisma {
  examPattern: {
    findUnique(args: any): Promise<any | null>;
    findMany(args: any): Promise<any[]>;
  };
}

export interface MarkingTemplateRef {
  examPatternId?: string | null;
  examId?: string | null;
  examTier?: string | null;
  tierPaper?: string | null;
}

export interface MarkingQuestionRef {
  examId?: string | null;
  examTier?: string | null;
  tierPaper?: string | null;
}

const CACHE_PREFIX = 'markpat:';
const CACHE_MS = 5 * 60_000;

/** Called by the admin pattern writes so a changed preset is used immediately. */
export function markingCacheKey(examId: string) {
  return `${CACHE_PREFIX}${examId}`;
}
export { CACHE_PREFIX as MARKING_CACHE_PREFIX };

/** The value every question shares, or undefined when they differ / are all empty. */
function commonValue<T>(values: (T | null | undefined)[]): T | null | undefined {
  if (values.length === 0) return undefined;
  const first = values[0] ?? null;
  for (const v of values) if ((v ?? null) !== first) return undefined;
  return first;
}

const signature = (s: MarkingScheme) => JSON.stringify(s.sections.map((x) => [x.subjectSlug, x.marksPerQuestion, x.negative]));

async function patternsOfExam(prisma: MarkingPrisma, examId: string): Promise<any[]> {
  const key = markingCacheKey(examId);
  const hit = cacheGet<any[]>(key);
  if (hit) return hit;
  const rows = await prisma.examPattern.findMany({
    where: { examId, isActive: true },
    select: { id: true, name: true, negativeMarks: true, sections: true },
  });
  cacheSet(key, rows, CACHE_MS);
  return rows;
}

/** A pick only counts when it is unambiguous: one candidate, or several that would score identically. */
function pickUnambiguous(candidates: any[]): MarkingScheme | null {
  const schemes = candidates.map((c) => buildMarkingScheme(c)).filter((s): s is MarkingScheme => !!s);
  if (schemes.length === 0) return null;
  return schemes.every((s) => signature(s) === signature(schemes[0])) ? schemes[0] : null;
}

export async function loadMarkingScheme(
  prisma: MarkingPrisma,
  template: MarkingTemplateRef | null | undefined,
  questions: MarkingQuestionRef[] = [],
): Promise<MarkingScheme | null> {
  try {
    // 1. explicit link
    if (template?.examPatternId) {
      const linked = await prisma.examPattern.findUnique({
        where: { id: template.examPatternId },
        select: { id: true, name: true, negativeMarks: true, sections: true },
      });
      const scheme = buildMarkingScheme(linked);
      if (scheme) return scheme;
    }

    // exam: the template's, else the one every question shares
    const examId = template?.examId ?? commonValue(questions.map((q) => q.examId)) ?? null;
    if (!examId) return null;
    const patterns = await patternsOfExam(prisma, examId);
    if (patterns.length === 0) return null;

    // 2. tier + paper: the template's, else the questions' when they agree
    const tier = template?.examTier ?? commonValue(questions.map((q) => q.examTier)) ?? null;
    const paper = effectiveTierPaper(template?.tierPaper ?? commonValue(questions.map((q) => q.tierPaper)) ?? null);
    const named = (want: 'TIER_1' | 'TIER_2' | null) =>
      patterns.filter((p) => {
        const k = classifyPatternName(p.name);
        return k.tier === want && k.paper === paper;
      });
    // Tier 2 is never guessed: no Tier 2 preset -> none (the caller keeps the question columns)
    if (tier === 'TIER_2') return pickUnambiguous(named('TIER_2'));
    if (tier === 'TIER_1') {
      const hit = pickUnambiguous(named('TIER_1'));
      if (hit) return hit;
    }

    // 3. Tier 1 or no tier known: the exam's Tier 1 pattern, else its untiered one (CPO, MTS, GD ... have no tiers)
    return pickUnambiguous(named('TIER_1')) ?? pickUnambiguous(named(null));
  } catch {
    // a lookup problem must never block a submit: fall back to the question columns (the old behaviour)
    return null;
  }
}
