import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { cacheGet, cacheSet } from '../common/cache';

/**
 * v6 §6 — per-template stats: attempts, averages, P90 cutoff + top-5 toppers.
 * Aggregated lazily (5-min TTL cache) — no scheduled job / new deps needed.
 * These numbers power the results page (real cutoff instead of the old
 * 40%-of-max heuristic) and topper-compare.
 */
@Injectable()
export class TestStatsService {
  private readonly TTL = 5 * 60_000;

  constructor(private prisma: PrismaService) {}

  async getStats(templateId: string): Promise<any> {
    const cached = cacheGet<any>(`tests:stats:${templateId}`);
    if (cached) return cached;

    const template = await this.prisma.testTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, title: true, totalQuestions: true, totalMarks: true },
    });
    if (!template) throw new NotFoundException('Test template not found');

    const done = await this.prisma.testAttempt.findMany({
      where: { testTemplateId: templateId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
      select: {
        score: true,
        accuracyPercent: true,
        totalCorrect: true,
        startedAt: true,
        submittedAt: true,
        user: { select: { id: true, fullName: true } },
      },
      orderBy: { score: 'desc' },
    });

    const n = done.length;
    let avgScore = 0;
    let avgAccuracy = 0;
    let cutoffScore = 0;
    if (n > 0) {
      avgScore = Math.round((done.reduce((s, a) => s + (a.score ?? 0), 0) / n) * 10) / 10;
      avgAccuracy = Math.round((done.reduce((s, a) => s + (a.accuracyPercent ?? 0), 0) / n) * 10) / 10;
      // P90 cutoff: score at the 90th percentile (real, data-driven)
      const idx = Math.min(done.length - 1, Math.floor(n * 0.9));
      cutoffScore = done[idx].score ?? 0;
    }

    const toppers = done.slice(0, 5).map((a) => ({
      userId: a.user?.id,
      fullName: a.user?.fullName || 'Student',
      score: a.score ?? 0,
      accuracyPercent: a.accuracyPercent ?? 0,
      durationSec:
        a.startedAt && a.submittedAt ? Math.round((new Date(a.submittedAt).getTime() - new Date(a.startedAt).getTime()) / 1000) : 0,
      submittedAt: a.submittedAt,
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

    cacheSet(`tests:stats:${templateId}`, stats, this.TTL);
    return stats;
  }
}