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
import { dedupeKeyedPaperRows } from '../common/pyq-paper';
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
  examPattern: { findMany(args: any): Promise<{ id: string; name: string; totalQuestions: number; durationMinutes: number }[]> };
}

/** Fallback when no ExamPattern is linked to the tier. The admin sees "pattern link nahi". */
export const ASSUMED_PAPER_TARGET = 100;

// Picks the ExamPattern that describes a tier, by name ("SSC CGL Tier 1", "... Tier II ... Paper I").
// Returns undefined when nothing matches clearly.
export async function findPatternForPaper(prisma: PaperBuilderPrisma, examId: string, tier: string, tierPaper: string) {
  const patterns = await prisma.examPattern.findMany({
    where: { examId, isActive: true },
    select: { id: true, name: true, totalQuestions: true, durationMinutes: true },
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
    select: { totalQuestions: true, targetQuestions: true },
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
    update: { ...common, ...(!wasComplete && nowComplete ? { isActive: true } : {}) },
  });
  return { templateId, built, target, live: nowComplete };
}
