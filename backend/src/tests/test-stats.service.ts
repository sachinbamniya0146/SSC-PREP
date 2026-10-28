/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { cacheGet, cacheSet } from '../common/cache';
import { shortName } from './rank.util';
import { loadRankRows } from './rank-rows';

/**
 * v6 §6 — per-template stats: attempts, averages, P90 cutoff + top-5 toppers.
 * Aggregated lazily (5-min TTL cache) — no scheduled job / new deps needed.
 * These numbers power the results page (real cutoff instead of the old
 * 40%-of-max heuristic) and topper-compare.
 *
 * Session 24 (28 Oct 2026): the crowd is the SAME one the rank card uses (rank-rows.ts): the first finished attempt of
 * every active student. Before, this counted every attempt of everybody, so an admin's test run was the "topper", a
 * student's fifth retake counted five times, and the average / cut-off described a different group than the rank
 * printed next to it. Other students are shown as "Rahul S." (like the leaderboard), only the viewer sees their own
 * full name, and no user id leaves the server.
 */
@Injectable()
export class TestStatsService {
  private readonly TTL = 5 * 60_000;

  constructor(private prisma: PrismaService) {}

  async getStats(templateId: string, viewerId?: string | null): Promise<any> {
    const stats = await this.load(templateId);
    const { toppers, ...rest } = stats;
    return {
      ...rest,
      toppers: toppers.map((t: any) => {
        const isMe = !!viewerId && t.userId === viewerId;
        return {
          fullName: isMe ? t.fullName : shortName(t.fullName),
          score: t.score,
          accuracyPercent: t.accuracyPercent,
          durationSec: t.durationSec,
          isMe,
        };
      }),
    };
  }

  private async load(templateId: string): Promise<any> {
    const cached = cacheGet<any>(`tests:stats2:${templateId}`);
    if (cached) return cached;

    const template = await this.prisma.testTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, title: true, totalQuestions: true, totalMarks: true },
    });
    if (!template) throw new NotFoundException('Test template not found');

    // best score first (rank.util order: higher score, then the faster finisher)
    const done = await loadRankRows(this.prisma, templateId);

    const n = done.length;
    let avgScore = 0;
    let avgAccuracy = 0;
    let cutoffScore = 0;
    if (n > 0) {
      avgScore = Math.round((done.reduce((s, a) => s + (a.score ?? 0), 0) / n) * 10) / 10;
      avgAccuracy = Math.round((done.reduce((s, a) => s + (a.accuracy ?? 0), 0) / n) * 10) / 10;
      // BUGFIX: P90 cutoff must mark the score that only the TOP 10% of
      // attempts reach or beat. `done` is sorted best-first (rank 1 =
      // highest score first), so that boundary sits near the START of the
      // array — roughly index floor(n * 0.10) — not near the end.
      // The old code used `Math.floor(n * 0.9)`, which in this
      // descending-sorted array lands near the BOTTOM 10% (the weakest
      // scorers), not the top. That inverted "cutoff" was then shown on the
      // results page as the qualifying score (replacing the old 40%-of-max
      // heuristic per the comment above) — meaning it was showing students
      // an artificially low bar, nowhere near an actual top-10% cutoff.
      const idx = Math.max(0, Math.min(n - 1, Math.floor(n * 0.1)));
      cutoffScore = done[idx].score ?? 0;
    }

    const toppers = done.slice(0, 5).map((a) => ({
      userId: a.userId,
      fullName: a.name || 'Student',
      score: a.score ?? 0,
      accuracyPercent: a.accuracy ?? 0,
      durationSec: a.durationSec,
    }));

    const stats = {
      templateId,
      title: template.title,
      attempts: n,
      avgScore,
      avgAccuracy,
      cutoffScore,
      cutoffLabel: n >= 10 ? `${Math.round((cutoffScore / (template.totalMarks || 1)) * 100)}% of max` : 'not enough attempts yet',
      hasEnoughData: n >= 10,
      toppers,
    };

    // persist for future reads
    const payload = { attempts: n, avgScore, avgAccuracy, cutoffScore, toppers } as any;
    await this.prisma.testAttemptStats.upsert({
      where: { testTemplateId: templateId },
      create: { testTemplateId: templateId, ...payload },
      update: payload,
    });

    cacheSet(`tests:stats2:${templateId}`, stats, this.TTL);
    return stats;
  }
}
