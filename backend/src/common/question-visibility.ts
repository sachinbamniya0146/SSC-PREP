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
