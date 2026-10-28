import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeaturesService } from '../features/features.service';
import { cacheGet, cacheSet } from '../common/cache';
import {
  RankPlace,
  RankRow,
  firstAttemptPerUser,
  isRetake,
  placeAmong,
  shortName,
  sortRows,
  standingOf,
  withRanks,
} from './rank.util';

const CACHE_MS = 60_000;
const MAX_ROWS = 50_000;
const DONE = ['SUBMITTED', 'AUTO_SUBMITTED'] as const;

export interface AttemptRank {
  /** false = this attempt is a retake: it does not change anybody's rank, the numbers below are "practice rank". */
  countsForRank: boolean;
  overall: RankPlace;
  state: (RankPlace & { name: string }) | null;
  /** true when the student has not chosen a state yet (the page shows a "choose your state" prompt). */
  stateMissing: boolean;
  /** retake only: where the student's FIRST attempt stands today. */
  firstAttempt: RankPlace | null;
  topScore: number | null;
  avgScore: number | null;
  attempts: number;
}

@Injectable()
export class RankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeaturesService,
  ) {}

  /** First finished attempt of every active student for one test, best-first. Cached for a minute. */
  private async rowsFor(templateId: string): Promise<RankRow[]> {
    const key = `tests:rank:${templateId}`;
    const hit = cacheGet<RankRow[]>(key);
    if (hit) return hit;
    const raw = await this.prisma.testAttempt.findMany({
      where: { testTemplateId: templateId, status: { in: [...DONE] }, user: { isSuspended: false } },
      orderBy: { startedAt: 'asc' },
      take: MAX_ROWS,
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
        raw.map((r) => ({
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
    cacheSet(key, rows, CACHE_MS);
    return rows;
  }

  async forAttempt(userId: string, attemptId: string): Promise<AttemptRank> {
    const attempt = await this.prisma.testAttempt.findFirst({
      where: { id: attemptId, userId },
      select: {
        id: true,
        testTemplateId: true,
        status: true,
        score: true,
        accuracyPercent: true,
        startedAt: true,
        submittedAt: true,
        user: { select: { state: true } },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (!(DONE as readonly string[]).includes(attempt.status as string)) {
      throw new BadRequestException('Submit the test to see your rank.');
    }

    const rows = await this.rowsFor(attempt.testTemplateId);
    const others = rows.filter((r) => r.userId !== userId);
    const retake = isRetake(rows, userId, attemptId);
    const duration = attempt.startedAt && attempt.submittedAt ? Math.max(0, Math.round((new Date(attempt.submittedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000)) : 0;
    const mine = { score: attempt.score ?? 0, durationSec: duration };

    // A rank is always "me placed among everybody else's first attempt" - one formula for first attempts and retakes.
    // (For a first attempt that is already inside the cached rows this gives the same answer as standingOf().)
    const overall = placeAmong(others, mine);
    const stateName = attempt.user?.state ?? null;
    const state = stateName
      ? { ...placeAmong(others.filter((r) => r.state === stateName), mine), name: stateName }
      : null;

    const everyone = rows.length + (rows.some((r) => r.userId === userId) ? 0 : 1);
    const scores = rows.map((r) => r.score);
    if (!rows.some((r) => r.userId === userId)) scores.push(mine.score);

    return {
      countsForRank: !retake,
      overall,
      state,
      stateMissing: !stateName,
      firstAttempt: retake ? standingOf(rows, userId) : null,
      topScore: scores.length ? Math.max(...scores) : null,
      avgScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      attempts: everyone,
    };
  }

  /** Top students of one test (first attempts), optionally only one state, plus where the caller stands. */
  async leaderboard(userId: string, templateId: string, stateFilter?: string, take = 20) {
    await this.features.assertEnabled('leaderboard');
    const rows = await this.rowsFor(templateId);
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { state: true } });
    const myState = me?.state ?? null;
    const pool = stateFilter === 'mine' ? rows.filter((r) => !!myState && r.state === myState) : rows;
    const ranked = withRanks(pool).slice(0, Math.min(Math.max(take, 1), 50));
    return {
      templateId,
      scope: stateFilter === 'mine' ? 'state' : 'india',
      state: stateFilter === 'mine' ? myState : null,
      needState: stateFilter === 'mine' && !myState,
      total: pool.length,
      rows: ranked.map((r) => ({
        rank: r.rank,
        name: r.userId === userId ? r.name : shortName(r.name),
        state: r.state,
        score: r.score,
        accuracy: r.accuracy,
        durationSec: r.durationSec,
        isMe: r.userId === userId,
      })),
    };
  }
}
