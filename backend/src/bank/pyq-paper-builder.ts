/**
 * Builds / refreshes the ONE mock of a real PYQ paper (date-wise + tier-wise mocks, 26 Oct 2026).
 *
 * Kept free of Nest imports and taking a minimal Prisma-shaped object so it can be unit-tested
 * against an in-memory fake (see pyq-paper-builder.spec.ts). BankUploadService.rebuildKeyedPaper()
 * is the production entry point.
 *
 * Identity of a paper = examId + examTier + tierPaper (blank = PAPER_1) + examDate + shift (blank = none).
 * Same identity => same TestTemplate id => the mock only GROWS as more subjects are uploaded.
 *
 *  - Only published (approved) questions count, de-duplicated, in printed question-number order.
 *  - The mock is HIDDEN (isActive=false) until it holds the pattern's full question count, and is switched on
 *    ONCE, at that moment. After that this never switches it off, and a manual admin hide/show is respected.
 *  - An older paperCode-based mock for the same exam + date + shift stays THE mock of that paper (we only stamp
 *    tier/paper on it) so no paper gets two mocks and existing attempts stay valid.
 */
import { PUBLISHED_QUESTION_WHERE } from '../common/question-visibility';
import { readPatternSections } from '../common/section-plan';
import { MAX_PYQ_PAPER_QUESTIONS, dedupeKeyedPaperRows } from '../common/pyq-paper';
import {
  KEYED_PAPER_CEILING,
  PaperParts,
  effectiveTierPaper,
  templateIdForPaper,
  titleForPaper,
  yearOfDate,
} from '../common/pyq-paper-key';

/** The few Prisma delegates the builder uses (structural, so a fake can stand in for it in tests). */
export interface PaperBuilderPrisma {
  testTemplate: {
    findFirst(args: any): Promise<any>;
    findUnique(args: any): Promise<any>;
    update(args: any): Promise<any>;
    upsert(args: any): Promise<any>;
  };
  question: { findMany(args: any): Promise<any[]> };
  exam: { findUnique(args: any): Promise<{ name: string } | null> };
  examPattern: { findMany(args: any): Promise<{ id: string; name: string; totalQuestions: number; durationMinutes: number; sections?: unknown }[]> };
}

/** Fallback when no ExamPattern is linked to the tier. The admin sees "pattern link nahi". */
export const ASSUMED_PAPER_TARGET = 100;

// Picks the ExamPattern that describes a tier, by name ("SSC CGL Tier 1", "... Tier II ... Paper I").
// Returns undefined when nothing matches clearly.
export async function findPatternForPaper(prisma: PaperBuilderPrisma, examId: string, tier: string, tierPaper: string) {
  const patterns = await prisma.examPattern.findMany({
    where: { examId, isActive: true },
    select: { id: true, name: true, totalQuestions: true, durationMinutes: true, sections: true },
  });
  const tierRe = tier === 'TIER_2' ? /tier[\s_-]*(2|ii)\b/i : /tier[\s_-]*(1|i)\b/i;
  const ofTier = patterns.filter((x) => tierRe.test(x.name));
  if (ofTier.length <= 1) return ofTier[0];
  const n = tierPaper.slice(-1);
  const roman = ['', 'i', 'ii', 'iii'][Number(n)] ?? n;
  const paperRe = new RegExp(`paper[\\s_-]*(${n}|${roman})\\b`, 'i');
  const byPaper = ofTier.filter((x) => paperRe.test(x.name));
  return byPaper.length === 1 ? byPaper[0] : undefined;
}

/**
 * Question ceiling of a LEGACY paperCode paper (`pyq-<slug>` mocks, no tier+date identity).
 * Before 27 Oct 2026 this was a hard 100. Now it follows the ExamPattern like the keyed path does:
 *  - rows that carry a tier  -> the pattern of that tier (+ paper);
 *  - otherwise               -> the exam's pattern, but only when it is unambiguous (every active pattern of the
 *                               exam has the same question count) — a mixed Tier 1 / Tier 2 pool stays at 100;
 *  - never BELOW 100 (an existing mock must not shrink) and never above KEYED_PAPER_CEILING;
 *  - any lookup problem -> 100 (the old behaviour), so a DB hiccup can never change a paper.
 * Template ids and attempts are untouched: only how many rows are kept changes, and the upload (count) and the
 * serving path both call this with the same inputs so they always agree.
 */
export async function legacyPaperCeiling(
  prisma: { examPattern: { findMany(args: any): Promise<{ id: string; name: string; totalQuestions: number; durationMinutes: number }[]> } },
  examId: string | null | undefined,
  sample?: { examTier?: string | null; tierPaper?: string | null },
): Promise<number> {
  if (!examId) return MAX_PYQ_PAPER_QUESTIONS;
  try {
    let target: number | undefined;
    if (sample?.examTier) {
      const pattern = await findPatternForPaper(prisma as PaperBuilderPrisma, examId, sample.examTier, effectiveTierPaper(sample.tierPaper));
      target = pattern?.totalQuestions;
    } else {
      const patterns = await prisma.examPattern.findMany({
        where: { examId, isActive: true },
        select: { id: true, name: true, totalQuestions: true, durationMinutes: true },
      });
      const counts = new Set(patterns.map((x) => x.totalQuestions));
      if (counts.size === 1) target = patterns[0].totalQuestions;
    }
    if (!target || !Number.isFinite(target)) return MAX_PYQ_PAPER_QUESTIONS;
    return Math.min(KEYED_PAPER_CEILING, Math.max(MAX_PYQ_PAPER_QUESTIONS, Math.floor(target)));
  } catch {
    return MAX_PYQ_PAPER_QUESTIONS;
  }
}

export async function buildKeyedPaper(
  prisma: PaperBuilderPrisma,
  parts: PaperParts,
): Promise<{ templateId: string; built: number; target: number; live: boolean } | null> {
  const tierPaper = effectiveTierPaper(parts.tierPaper);
  const shift = parts.shift ? parts.shift : null;

  const legacy = await prisma.testTemplate.findFirst({
    where: {
      examId: parts.examId,
      examDate: parts.examDate,
      shift,
      id: { startsWith: 'pyq-', not: { startsWith: 'pyq-k-' } },
    },
    select: { id: true, examTier: true },
  });
  if (legacy) {
    if (!legacy.examTier) {
      await prisma.testTemplate.update({ where: { id: legacy.id }, data: { examTier: parts.examTier, tierPaper } });
    }
    return null;
  }

  const [exam, rows, pattern] = await Promise.all([
    prisma.exam.findUnique({ where: { id: parts.examId }, select: { name: true } }),
    prisma.question.findMany({
      where: {
        ...PUBLISHED_QUESTION_WHERE,
        examId: parts.examId,
        examTier: parts.examTier,
        examDate: parts.examDate,
        shift,
        AND: [tierPaper === 'PAPER_1' ? { OR: [{ tierPaper: null }, { tierPaper: 'PAPER_1' }] } : { tierPaper }],
      },
      select: { id: true, questionText: true, createdAt: true, marks: true, paperQuestionNo: true },
    }),
    findPatternForPaper(prisma, parts.examId, parts.examTier, tierPaper),
  ]);
  const kept = dedupeKeyedPaperRows(rows, KEYED_PAPER_CEILING);
  const built = kept.length;
  if (built === 0) return null;

  const templateId = templateIdForPaper(parts);
  const patternTarget = pattern?.totalQuestions ?? null;
  const target = patternTarget ?? ASSUMED_PAPER_TARGET;
  const examName = exam?.name ?? 'SSC';
  const totalMarks = kept.reduce((sum, r) => sum + (r.marks ?? 2), 0);
  const durationMinutes = pattern?.durationMinutes ?? Math.max(10, Math.round(built * 0.6));
  const common = {
    title: titleForPaper(examName, { ...parts, tierPaper }),
    totalQuestions: built,
    totalMarks,
    durationMinutes,
    examId: parts.examId,
    year: yearOfDate(parts.examDate) ?? null,
    shift,
    examDate: parts.examDate,
    examTier: parts.examTier,
    tierPaper,
    targetQuestions: patternTarget,
  };

  const existing = await prisma.testTemplate.findUnique({
    where: { id: templateId },
    select: { title: true, titleLocked: true, totalQuestions: true, targetQuestions: true },
  });
  const wasComplete = existing ? existing.totalQuestions >= (existing.targetQuestions ?? ASSUMED_PAPER_TARGET) : false;
  const nowComplete = built >= target;

  await prisma.testTemplate.upsert({
    where: { id: templateId },
    create: {
      id: templateId,
      ...common,
      description: `Real ${examName} ${parts.examTier === 'TIER_2' ? 'Tier 2' : 'Tier 1'} paper, ${parts.examDate}${shift ? ` · ${shift}` : ''}. Composed exactly as it appeared on the day, question-for-question.`,
      type: 'SHIFT_WISE',
      isPremium: false, // all auto-created PYQ mocks are free — see common/pyq-mock-pricing.ts
      isActive: nowComplete,
    },
    update: {
      ...common,
      // a title the admin typed by hand is kept (titleLocked), everything else follows the paper
      ...(existing?.titleLocked && existing.title ? { title: existing.title } : {}),
      ...(!wasComplete && nowComplete ? { isActive: true } : {}),
    },
  });
  return { templateId, built, target, live: nowComplete };
}


// ------------------------------------------------------------------------------------------------ admin detail
/** [1,2,3,7,9,10] against 1..12 -> ["4–6", "8", "11–12"]. Numbers outside 1..upTo are ignored. */
export function missingNumberRanges(present: number[], upTo: number): string[] {
  const have = new Set(present.filter((n) => Number.isInteger(n) && n >= 1 && n <= upTo));
  const out: string[] = [];
  let start = 0;
  for (let n = 1; n <= upTo + 1; n++) {
    const missing = n <= upTo && !have.has(n);
    if (missing && !start) start = n;
    if (!missing && start) {
      out.push(start === n - 1 ? String(start) : `${start}–${n - 1}`);
      start = 0;
    }
  }
  return out;
}

export interface KeyedPaperDetail {
  id: string;
  built: number; // questions the mock holds now (published, de-duplicated)
  target: number;
  patternLinked: boolean;
  duplicatesDropped: number; // same question text uploaded twice for this paper
  subjects: { name: string; slug: string; have: number; need: number | null }[];
  /** only when the pattern names its sections: "Quantitative: 15 aur chahiye" */
  shortSections: string[];
  numbering: { numbered: number; unnumbered: number; missing: string[] | null };
}

/**
 * Why is this paper not complete yet? Which subjects are short and which printed question numbers are missing.
 * Reads exactly the rows buildKeyedPaper() counts, so the numbers the admin sees match the mock.
 */
export async function analyzeKeyedPaper(
  prisma: PaperBuilderPrisma,
  t: { id: string; examId: string | null; examTier: string | null; tierPaper: string | null; examDate: string | null; shift: string | null },
): Promise<KeyedPaperDetail | null> {
  if (!t.examId || !t.examTier || !t.examDate) return null;
  const tierPaper = effectiveTierPaper(t.tierPaper);
  const [rows, pattern] = await Promise.all([
    prisma.question.findMany({
      where: {
        ...PUBLISHED_QUESTION_WHERE,
        examId: t.examId,
        examTier: t.examTier,
        examDate: t.examDate,
        shift: t.shift ? t.shift : null,
        AND: [tierPaper === 'PAPER_1' ? { OR: [{ tierPaper: null }, { tierPaper: 'PAPER_1' }] } : { tierPaper }],
      },
      select: { id: true, questionText: true, createdAt: true, marks: true, paperQuestionNo: true, subject: { select: { name: true, slug: true } } },
    }),
    findPatternForPaper(prisma, t.examId, t.examTier, tierPaper),
  ]);
  const kept = dedupeKeyedPaperRows(rows, KEYED_PAPER_CEILING);
  const target = pattern?.totalQuestions ?? ASSUMED_PAPER_TARGET;

  const bySubject = new Map<string, { name: string; slug: string; have: number; need: number | null }>();
  for (const r of kept as any[]) {
    const slug = String(r.subject?.slug ?? 'other');
    const cur = bySubject.get(slug) ?? { name: String(r.subject?.name ?? 'Other'), slug, have: 0, need: null };
    cur.have += 1;
    bySubject.set(slug, cur);
  }
  const shortSections: string[] = [];
  const sections = pattern ? readPatternSections((pattern as any).sections) : [];
  for (const sec of sections) {
    if (!sec.subjectSlug) continue;
    const need = sec.questions ?? 0;
    const cur = bySubject.get(sec.subjectSlug) ?? { name: sec.name, slug: sec.subjectSlug, have: 0, need: null };
    cur.need = need;
    bySubject.set(sec.subjectSlug, cur);
    if (cur.have < need) shortSections.push(`${sec.name}: ${need - cur.have} aur chahiye (${cur.have}/${need})`);
  }

  const nums = (kept as any[]).map((r) => r.paperQuestionNo).filter((n) => typeof n === 'number') as number[];
  const upTo = Math.max(target, ...nums, 0);
  return {
    id: t.id,
    built: kept.length,
    target,
    patternLinked: !!pattern,
    duplicatesDropped: rows.length - kept.length,
    subjects: [...bySubject.values()].sort((a, b) => b.have - a.have || a.name.localeCompare(b.name)),
    shortSections,
    numbering: { numbered: nums.length, unnumbered: kept.length - nums.length, missing: nums.length ? missingNumberRanges(nums, upTo) : null },
  };
}
