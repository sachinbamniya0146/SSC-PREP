/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The ONE list of "who counts" for every peer number on a result page (session 24, 28 Oct 2026).
 *
 * Before this file the result page showed three different crowds: RankService (first finished attempt of every active
 * STUDENT), TestStatsService (every finished attempt of everybody, staff and retakes included - average, cut-off and
 * toppers) and attemptDetail() (a rank counted over all attempts of everybody, saved once and never refreshed, plus a
 * "topper" that could be an admin's test run). So the same screen could say rank 3, topper 190 and average 71 about
 * three different groups of people.
 *
 * Rows = the first finished attempt (SUBMITTED / AUTO_SUBMITTED) of every active student of one test, best first.
 * Cached for a minute per test, shared by the rank card, the cut-off / toppers box and the attempt review.
 *
 * Kept free of Nest imports and taking a structural Prisma so a fake can stand in for it (scripts/audit/results-sim.cjs).
 */
import { cacheGet, cacheSet } from '../common/cache';
import { RANKABLE_USER } from '../common/rankable';
import { RankRow, firstAttemptPerUser, sortRows } from './rank.util';

export const RANK_CACHE_MS = 60_000;
export const RANK_MAX_ROWS = 50_000;
export const RANK_DONE_STATUSES = ['SUBMITTED', 'AUTO_SUBMITTED'] as const;

/** `prisma` is anything with `testAttempt.findMany` (the real PrismaService, or the fake of scripts/audit/results-sim.cjs). */
export async function loadRankRows(prisma: any, templateId: string): Promise<RankRow[]> {
  const key = `tests:rank:${templateId}`;
  const hit = cacheGet<RankRow[]>(key);
  if (hit) return hit;
  const raw: any[] = await prisma.testAttempt.findMany({
    where: { testTemplateId: templateId, status: { in: [...RANK_DONE_STATUSES] }, user: { ...RANKABLE_USER } },
    orderBy: { startedAt: 'asc' },
    take: RANK_MAX_ROWS,
    select: {
      id: true,
      userId: true,
      score: true,
      accuracyPercent: true,
      startedAt: true,
      submittedAt: true,
      user: { select: { fullName: true, state: true } },
    },
  });
  const rows = sortRows(
    firstAttemptPerUser(
      raw.map((r: any) => ({
        attemptId: r.id,
        userId: r.userId,
        name: r.user?.fullName ?? null,
        state: r.user?.state ?? null,
        score: r.score,
        accuracy: r.accuracyPercent,
        startedAt: r.startedAt,
        submittedAt: r.submittedAt,
      })),
    ),
  );
  cacheSet(key, rows, RANK_CACHE_MS);
  return rows;
}

/** Highest score of the crowd; the viewer's own score counts too when the viewer is not in the rows (staff). */
export function topScoreOf(rows: RankRow[], userId: string, myScore: number): number | null {
  const scores = rows.map((r) => r.score);
  if (!rows.some((r) => r.userId === userId)) scores.push(myScore);
  return scores.length ? Math.max(...scores) : null;
}
