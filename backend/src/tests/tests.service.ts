/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { cacheGet, cacheSet } from '../common/cache';
import { PUBLISHED_QUESTION_WHERE } from '../common/question-visibility';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class TestsService {
  constructor(
    private prisma: PrismaService,
    private gamification: GamificationService,
    // Requirement 5, part (a) — submitAttempt() below needs to trigger the
    // auto-PDF-send. TelegramModule already imports TestsModule (for
    // /report + /pdf + the weak-topic-analysis job), so importing
    // TelegramModule back here would be a straight A→B→A module cycle.
    // forwardRef() on BOTH sides — this constructor AND telegram.module.ts's
    // import of TestsModule — breaks that cycle by deferring resolution
    // until both modules have finished registering, same fix pattern as
    // monetization.service.ts ↔ referral.service.ts. Only ONE side using
    // forwardRef() is not enough; the import in telegram.module.ts must be
    // wrapped too, or Nest still throws "cannot resolve dependencies" at
    // boot.
    @Inject(forwardRef(() => TelegramService))
    private telegram: TelegramService,
  ) {}

  // ---- P0 — premium entitlement enforcement (server-side, never trust FE) ----
  // A premium template requires: an ACTIVE subscription (endsAt in future)
  // OR a paid MockAccess row for that template (or free trial pack).
  //
  // BUGFIX (bonus grep, item a — the free trial was completely unusable):
  // This method only ever READ mockAccess and expected mocksUsed to already
  // reflect prior free-trial usage. The only place that INCREMENTED
  // mocksUsed was MocksService.recordMockUse(), exposed as `POST
  // /mocks/use` — a separate, client-triggered call the frontend never
  // makes anywhere (verified: zero references in frontend/src). So for
  // every first-time user, no MockAccess row existed at all when they hit
  // a premium template here; `mock` was `null`, both `mock && ...` checks
  // short-circuited to false, and this threw "purchase access to take it"
  // immediately — even though FREE_MOCKS_PER_EXAM (mocks.service.ts)
  // promises 2 free attempts and the /mocks list screen (which defaults
  // missing usage to 0) shows the same template as unlocked/free. The
  // promised free trial could never actually be started by anyone.
  //
  // Fix: this is the one authoritative place that gates starting an
  // attempt, so it now also atomically CONSUMES one free-trial use here —
  // create the row on first-ever attempt, or conditionally increment
  // mocksUsed only if still under freeMocksAllowed (race-safe: the
  // increment's WHERE re-checks the limit at write time, not just at read
  // time, so two concurrent attempt-starts can't both slip through on the
  // last remaining free use). recordMockUse()/`POST /mocks/use` is left in
  // place as a harmless legacy no-op-equivalent in case anything else
  // calls it, but nothing depends on it anymore.
  // ADMIN BYPASS: role is now selected alongside subscriptions in the same
  // query (no extra DB round-trip) and short-circuits every premium/mock
  // entitlement check below. An ADMIN account should never be blocked by
  // "purchase access to take it" — that's a real bug students would hit,
  // but an admin hitting it usually means they're testing/managing content
  // and got wrongly paywalled like a free student.
  private async assertMockEntitled(userId: string, template: { id: string; isPremium?: boolean | null }) {
    if (!template.isPremium) return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        subscriptions: { where: { status: 'ACTIVE' }, select: { endsAt: true }, take: 1 },
      },
    });
    if (user?.role === 'ADMIN') return;
    const subActive = user?.subscriptions?.[0] && new Date(user.subscriptions[0].endsAt) > new Date();
    if (subActive) return;

    const mock = await this.prisma.mockAccess.findUnique({
      where: { userId_testTemplateId: { userId, testTemplateId: template.id } },
      select: { paidPacksPurchased: true, freeMocksAllowed: true, mocksUsed: true },
    });
    if (mock && mock.paidPacksPurchased > 0) return;

    if (!mock) {
      // First-ever attempt on this template for this user — create the
      // row and consume free-trial use #1 in the same write.
      await this.prisma.mockAccess.create({
        data: { userId, testTemplateId: template.id, mocksUsed: 1 },
      });
      return;
    }

    if (mock.mocksUsed < mock.freeMocksAllowed) {
      const claim = await this.prisma.mockAccess.updateMany({
        where: { userId, testTemplateId: template.id, mocksUsed: { lt: mock.freeMocksAllowed } },
        data: { mocksUsed: { increment: 1 } },
      });
      if (claim.count > 0) return; // successfully claimed a free-trial use
      // else: someone else (a racing concurrent start) claimed the last
      // remaining free use between our read and write — fall through to reject.
    }

    throw new BadRequestException('This mock is premium. Purchase access to take it.');
  }

  // ---- Server-authoritative test session (P0: client clock never trusted) ----

  // Begin a timed attempt: server stamps startedAt + expiresAt from the
  // template duration. The client may render a countdown from expiresAt but
  // cannot extend it — submission after expiry is capped server-side.
  async startAttempt(userId: string, testTemplateId: string) {
    const template = await this.prisma.testTemplate.findUnique({
      where: { id: testTemplateId },
    });
    if (!template) throw new BadRequestException('Test template not found');
    await this.assertMockEntitled(userId, template);

    // v4 §31 — resume-first: an unexpired in-progress attempt for this template
    // is RETURNED (with its autosaved answers) instead of opening a duplicate.
    // Makes refresh/relogin mid-test lossless and prevents restart-cheating.
    const existing = await this.prisma.testAttempt.findFirst({
      where: { userId, testTemplateId, status: 'IN_PROGRESS', expiresAt: { gt: new Date() } },
      select: { id: true, startedAt: true, expiresAt: true, status: true },
    });
    if (existing) {
      const saved = await this.prisma.attemptAnswer.findMany({
        where: { testAttemptId: existing.id },
        select: { questionId: true, selectedOption: true, timeSpentSeconds: true },
      });
      return { ...existing, resumed: true, answers: saved };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + (template.durationMinutes || 60) * 60 * 1000);
    const attempt = await this.prisma.testAttempt.create({
      data: {
        userId,
        testTemplateId,
        status: 'IN_PROGRESS',
        startedAt: now,
        expiresAt,
      },
      select: { id: true, startedAt: true, expiresAt: true, status: true },
    });
    return { ...attempt, resumed: false, answers: [] };
  }

// Score and finalize an in-progress attempt. Server-authoritative:
//  - only the owning user may submit
//  - a second submit is rejected (one attempt per instance)
//  - answers after expiresAt are dropped (auto-submit at expiry scores the
//    answers ALREADY PERSISTED via autosave — a late client payload is ignored)
//  - scoring recomputes everything from the DB answer key
async submitAttempt(
  userId: string,
  attemptId: string,
  input: { answers?: { questionId: string; selectedOption: string | null; timeSpentSeconds?: number }[] },
) {
  const attempt = await this.prisma.testAttempt.findFirst({
    where: { id: attemptId, userId },
  });
  if (!attempt) throw new BadRequestException('Attempt not found');
  if (attempt.status === 'SUBMITTED') {
    throw new BadRequestException('Attempt already submitted');
  }

  const now = new Date();
  const expired = attempt.expiresAt != null && now > attempt.expiresAt;

  // Base = answers already persisted by AUTOSAVE (v4 §31). Client payload is
  // merged on top when the attempt is still live; when expired it is dropped
  // entirely — the deadline is authoritative.
  const saved = await this.prisma.attemptAnswer.findMany({
    where: { testAttemptId: attemptId },
    select: { questionId: true, selectedOption: true, timeSpentSeconds: true },
  });
  const merged = new Map<string, { questionId: string; selectedOption: string | null; timeSpentSeconds: number }>();
  for (const s of saved) {
    merged.set(s.questionId, {
      questionId: s.questionId,
      selectedOption: s.selectedOption,
      timeSpentSeconds: s.timeSpentSeconds,
    });
  }
  if (!expired) {
    for (const a of input.answers ?? []) {
      merged.set(a.questionId, {
        questionId: a.questionId,
        selectedOption: a.selectedOption ?? null,
        timeSpentSeconds: Number(a.timeSpentSeconds) || 0,
      });
    }
  }
  const answers = Array.from(merged.values());

  // Re-score against DB answer key (identical rules to saveAttempt).
  let score = 0;
  let totalCorrect = 0;
  let totalWrong = 0;
  let totalSkipped = 0;
  const scoredAnswers: any[] = [];
  if (answers.length) {
    const questions = await this.prisma.question.findMany({
      where: { id: { in: answers.map((a) => a.questionId) } },
      select: { id: true, correctAnswer: true, marks: true, negativeMarks: true },
    });
    const qmap = new Map(questions.map((q) => [q.id, q]));
    for (const a of answers) {
      const q = qmap.get(a.questionId);
      if (!q) continue;
      const correct = a.selectedOption != null && a.selectedOption === q.correctAnswer;
      if (a.selectedOption == null) totalSkipped++;
      else if (correct) {
        totalCorrect++;
        score += q.marks ?? 2;
      } else {
        totalWrong++;
        score -= q.negativeMarks ?? 0.5;
      }
      scoredAnswers.push({
        questionId: a.questionId,
        selectedOption: a.selectedOption,
        isCorrect: correct,
        timeSpentSeconds: a.timeSpentSeconds ?? 0,
      });
    }
  }
  const accuracyPercent =
    totalCorrect + totalWrong > 0 ? Math.round((totalCorrect / (totalCorrect + totalWrong)) * 1000) / 10 : 0;

  // BUG FIX (Session 21 — "analysis showing wrong selected answer" audit):
  // this used to write scoredAnswers with a single nested
  // `{ createMany: { data: scoredAnswers, skipDuplicates: true } }`. That
  // comment ("autosaved rows already exist") is true, but skipDuplicates
  // means exactly what it says — for any question that ALREADY has an
  // AttemptAnswer row from a prior autosave, the createMany silently drops
  // that row entirely instead of updating it. If the student changed an
  // answer (or hit Clear Response) in the last moment before Submit — after
  // the debounced autosave last fired but before it fired again — the
  // in-memory `merged` map (and therefore the score/totalCorrect/totalWrong
  // saved directly on TestAttempt below) correctly reflects that final
  // change, but the persisted AttemptAnswer row for that one question was
  // silently left at its STALE pre-change value. Net effect: the score
  // shown right after Submit was right, but attemptDetail() (the
  // review/analysis screen, which reads per-question data straight from
  // AttemptAnswer) would show the OLD "you selected X" for that question —
  // contradicting the score the student was just given. Fixed by upserting
  // every scored answer individually (same create-or-update pattern
  // saveAnswers() already uses above), so both brand-new and
  // already-autosaved rows always end up holding the final, correctly
  // scored answer before the TestAttempt itself is marked SUBMITTED.
  if (scoredAnswers.length) {
    await Promise.all(
      scoredAnswers.map((a) =>
        this.prisma.attemptAnswer.upsert({
          where: { testAttemptId_questionId: { testAttemptId: attempt.id, questionId: a.questionId } },
          create: {
            testAttemptId: attempt.id,
            questionId: a.questionId,
            selectedOption: a.selectedOption,
            isCorrect: a.isCorrect,
            timeSpentSeconds: a.timeSpentSeconds,
          },
          update: {
            selectedOption: a.selectedOption,
            isCorrect: a.isCorrect,
            ...(a.timeSpentSeconds > 0 ? { timeSpentSeconds: a.timeSpentSeconds } : {}),
          },
        }),
      ),
    );
  }

  const updated = await this.prisma.testAttempt.update({
    where: { id: attempt.id },
    data: {
      status: 'SUBMITTED',
      score,
      totalCorrect,
      totalWrong,
      totalSkipped,
      accuracyPercent,
      submittedAt: now,
    },
    include: {
      testTemplate: { select: { id: true, title: true, totalQuestions: true, totalMarks: true } },
      answers: { select: { questionId: true, selectedOption: true, isCorrect: true, timeSpentSeconds: true } },
    },
  });

  this.gamification.awardTestXp(userId, totalCorrect, 'mock').catch(() => undefined);

  // Requirement 5, part (a) — auto-send the result PDF on Telegram right
  // after submit, for premium+linked users. Subscription-active + linked
  // checks happen INSIDE notifyTelegramAttemptPdf() below (not here) so a
  // free/unlinked user's submit doesn't even attempt the lookup twice.
  // Fire-and-forget with .catch(() => undefined) — same pattern as the XP
  // award one line above — so a PDF-render failure (Chromium crash,
  // Telegram API hiccup, rate limit) can never fail or delay the submit
  // response the student is waiting on.
  this.notifyTelegramAttemptPdf(userId, updated.id).catch(() => undefined);

  return { ...updated, expired };
}

// Requirement 5, part (a) helper — gate + send. Mirrors the exact
// "linked? → active? → send" order used by /pdf in telegram.controller.ts,
// so behavior stays identical whether the PDF was requested on-demand or
// fired automatically on submit.
private async notifyTelegramAttemptPdf(userId: string, attemptId: string) {
  const tgUser = await this.telegram.getTelegramUserByUserId(userId);
  if (!tgUser) return; // not linked — nothing to do
  const active = await this.telegram.hasActiveSubscription(userId);
  if (!active) return; // lapsed/free — same gate used everywhere else
  await this.telegram.sendAttemptPdf(userId, Number(tgUser.chatId), attemptId);
}

// Live server-side remaining-time check (client countdown is cosmetic only).
async attemptRemaining(userId: string, attemptId: string) {
  const attempt = await this.prisma.testAttempt.findFirst({
    where: { id: attemptId, userId },
    select: { id: true, status: true, startedAt: true, expiresAt: true },
  });
  if (!attempt) throw new BadRequestException('Attempt not found');
  const now = Date.now();
  const expiresMs = attempt.expiresAt ? new Date(attempt.expiresAt).getTime() : null;
  // v4 §31 — persisted autosaves returned so a resumed session hydrates exactly
  const savedAnswers = await this.prisma.attemptAnswer.findMany({
    where: { testAttemptId: attempt.id },
    select: { questionId: true, selectedOption: true, timeSpentSeconds: true },
  });
  return {
    attemptId: attempt.id,
    status: attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    remainingMs: expiresMs != null ? Math.max(0, expiresMs - now) : null,
    expired: expiresMs != null && now > expiresMs,
    answers: savedAnswers,
  };
}

// v4 §31 — AUTOSAVE: persist partial answers + per-question time mid-attempt
// (debounced by the client). Autosaved answers are what an auto-submit-at-expiry
// scores, and they make resumed tests (refresh/relogin) lossless.
async saveAnswers(
  userId: string,
  attemptId: string,
  input: {
    answers: { questionId: string; selectedOption: string | null; timeSpentSeconds?: number }[];
    timeSpentByQuestion?: Record<string, number>;
  },
) {
  const attempt = await this.prisma.testAttempt.findFirst({
    where: { id: attemptId, userId },
    select: { id: true, status: true },
  });
  if (!attempt) throw new BadRequestException('Attempt not found');
  if (attempt.status !== 'IN_PROGRESS') throw new BadRequestException('Attempt is not in progress');

  const answers = input.answers ?? [];
  if (!answers.length) return { saved: 0 };

  const questions = await this.prisma.question.findMany({
    where: { id: { in: answers.map((a) => a.questionId) } },
    select: { id: true, correctAnswer: true },
  });
  const qmap = new Map(questions.map((q) => [q.id, q]));

  let saved = 0;
  for (const a of answers) {
    const q = qmap.get(a.questionId);
    if (!q) continue;
    const selected = a.selectedOption ?? null;
    const time = Math.max(0, Math.floor(Number(a.timeSpentSeconds ?? input.timeSpentByQuestion?.[a.questionId]) || 0));
    await this.prisma.attemptAnswer.upsert({
      where: { testAttemptId_questionId: { testAttemptId: attempt.id, questionId: a.questionId } },
      create: {
        testAttemptId: attempt.id,
        questionId: a.questionId,
        selectedOption: selected,
        isCorrect: selected != null && selected === q.correctAnswer,
        timeSpentSeconds: time,
      },
      update: {
        selectedOption: selected,
        isCorrect: selected != null && selected === q.correctAnswer,
        ...(time > 0 ? { timeSpentSeconds: time } : {}),
      },
    });
    saved++;
  }
  return { saved };
}

  async listAvailable() {
    const cached = cacheGet<any>('tests:list');
    if (cached) return cached;
    const out = await this.prisma.testTemplate.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    cacheSet('tests:list', out, 300_000);
    return out;
  }

  // Save a completed attempt. Server-side scoring ONLY: client-supplied score
  // fields are IGNORED and recomputed from the DB (marks/negativeMarks per
  // question), so a tampered client payload can never inflate rank/XP.
  async saveAttempt(
    userId: string,
    input: {
      testTemplateId: string;
      score?: number; // ignored — recomputed server-side
      totalCorrect?: number;
      totalWrong?: number;
      totalSkipped?: number;
      accuracyPercent?: number;
      answers?: { questionId: string; selectedOption: string | null; isCorrect?: boolean; timeSpentSeconds?: number }[];
    },
  ) {
    const template = await this.prisma.testTemplate.findUnique({
      where: { id: input.testTemplateId },
    });
    if (!template) throw new BadRequestException('Test template not found');
    await this.assertMockEntitled(userId, template);

    // Re-score every submitted answer against the DB answer key.
    let score = 0;
    let totalCorrect = 0;
    let totalWrong = 0;
    let totalSkipped = 0;
    const scoredAnswers = [];
    if (input.answers?.length) {
      const ids = input.answers.map((a) => a.questionId);
      const questions = await this.prisma.question.findMany({
        where: { id: { in: ids } },
        select: { id: true, correctAnswer: true, marks: true, negativeMarks: true },
      });
      const qmap = new Map(questions.map((q) => [q.id, q]));
      for (const a of input.answers) {
        const q = qmap.get(a.questionId);
        if (!q) continue; // unknown question → skip, never count
        const correct = a.selectedOption != null && a.selectedOption === q.correctAnswer;
        if (a.selectedOption == null) {
          totalSkipped++;
        } else if (correct) {
          totalCorrect++;
          score += q.marks ?? 2;
        } else {
          totalWrong++;
          score -= q.negativeMarks ?? 0.5;
        }
        scoredAnswers.push({
          questionId: a.questionId,
          selectedOption: a.selectedOption,
          isCorrect: correct,
          timeSpentSeconds: a.timeSpentSeconds ?? 0,
        });
      }
    }
    const accuracyPercent =
      totalCorrect + totalWrong > 0 ? Math.round((totalCorrect / (totalCorrect + totalWrong)) * 1000) / 10 : 0;

    const attempt = await this.prisma.testAttempt.create({
      data: {
        userId,
        testTemplateId: input.testTemplateId,
        status: 'SUBMITTED',
        score,
        totalCorrect,
        totalWrong,
        totalSkipped,
        accuracyPercent,
        submittedAt: new Date(),
        answers: scoredAnswers.length ? { create: scoredAnswers } : undefined,
      },
      include: {
        testTemplate: { select: { id: true, title: true, totalQuestions: true, totalMarks: true } },
        answers: {
          select: {
            questionId: true,
            selectedOption: true,
            isCorrect: true,
            timeSpentSeconds: true,
          },
        },
      },
    });

    // v1 Phase 6 — award XP + extend streak (best-effort, never blocks submission)
    this.gamification
      .awardTestXp(userId, totalCorrect, 'mock')
      .catch(() => undefined);

    return attempt;
  }

  // List current user's attempts (newest first) with template + aggregate stats.
  async myAttempts(userId: string, take = 50) {
    const attempts = await this.prisma.testAttempt.findMany({
      where: { userId, status: 'SUBMITTED' },
      orderBy: { submittedAt: 'desc' },
      take,
      include: {
        testTemplate: { select: { id: true, title: true, totalQuestions: true, totalMarks: true } },
        _count: { select: { answers: true } },
      },
    });
    const completed = await this.prisma.testAttempt.findMany({
      where: { userId, status: 'SUBMITTED' },
      select: { score: true, accuracyPercent: true },
    });
    const totalAttempts = completed.length;
    const bestScore = completed.length ? Math.max(...completed.map((a) => a.score)) : 0;
    const bestAccuracy = completed.length ? Math.max(...completed.map((a) => a.accuracyPercent)) : 0;
    return { attempts, stats: { totalAttempts, bestScore, bestAccuracy } };
  }

  // Single attempt detail with answers (for results review page).
  async attemptDetail(userId: string, attemptId: string) {
    const attempt = await this.prisma.testAttempt.findFirst({
      where: { id: attemptId, userId },
      include: {
        testTemplate: true,
        answers: {
          include: {
            question: {
              select: {
                id: true,
                questionText: true,
                questionTextHindi: true,
                questionDiagramType: true, // Session 22 — Venn/figure stem diagrams
                questionDiagramLabels: true,
                questionImageUrl: true, // Session 24 — non-Venn diagram stem images
                optionsJson: true,
                correctAnswer: true,
                explanation: true,
                explanationHindi: true,
                explanationSource: true,
                exam: { select: { name: true } },
                chapter: { select: { name: true } },
                subject: { select: { name: true } },
                year: true,
                shift: true,
                marks: true,
                negativeMarks: true,
                difficulty: true,
              },
            },
          },
        },
      },
    });
    if (!attempt) throw new BadRequestException('Attempt not found');

    // v6 §6 — rank & percentile: aggregate across all attempts of the same template.
    let rank = attempt.rank;
    let percentile = attempt.percentile;
    if (rank == null || percentile == null) {
      const [better, total] = await Promise.all([
        this.prisma.testAttempt.count({
          where: { testTemplateId: attempt.testTemplateId, status: 'SUBMITTED', score: { gt: attempt.score } },
        }),
        this.prisma.testAttempt.count({
          where: { testTemplateId: attempt.testTemplateId, status: 'SUBMITTED' },
        }),
      ]);
      rank = better + 1;
      percentile = total > 0 ? Math.round((1 - better / total) * 1000) / 10 : 100;
      // persist for future reads (best-effort, never blocks the response)
      this.prisma.testAttempt
        .update({ where: { id: attempt.id }, data: { rank, percentile } })
        .catch(() => undefined);
    }

    // v6 §6 — topper comparison: best score + accuracy across all attempts of
    // this template (motivational benchmark, same-template peer comparison).
    const topper = await this.prisma.testAttempt.aggregate({
      where: { testTemplateId: attempt.testTemplateId, status: 'SUBMITTED' },
      _max: { score: true, accuracyPercent: true },
    });

    // v6 §6 — per-question review data, ordered with topic/exam labels.
    const questions = attempt.answers.map((a) => {
      const q = a.question;
      // Session 22 — pass diagramType/diagramLabels through untouched when
      // present (ordinary text options simply don't have these keys, so
      // this is a no-op for the ~99% non-diagram case).
      const opts = Array.isArray(q.optionsJson)
        ? (q.optionsJson as any[]).map((o: any) => ({
            key: o.key,
            text: o.text,
            textHi: o.textHi ?? null,
            diagramType: o.diagramType ?? null,
            diagramLabels: o.diagramLabels ?? null,
            imageUrl: o.imageUrl ?? null,
          }))
        : [];
      return {
        questionId: q.id,
        questionText: q.questionText,
        questionTextHindi: q.questionTextHindi,
        questionDiagramType: (q as any).questionDiagramType ?? null,
        questionDiagramLabels: (q as any).questionDiagramLabels ?? null,
        questionImageUrl: (q as any).questionImageUrl ?? null,
        options: opts,
        selectedOption: a.selectedOption,
        correctAnswer: q.correctAnswer,
        isCorrect: a.isCorrect,
        isSkipped: !a.selectedOption,
        isMarkedForReview: a.isMarkedForReview,
        timeSpentSeconds: a.timeSpentSeconds,
        explanation: q.explanation,
        explanationHindi: q.explanationHindi,
        explanationSource: q.explanationSource ?? null,
        examName: q.exam?.name,
        chapter: q.chapter?.name,
        subject: q.subject?.name,
        year: q.year,
        shift: q.shift,
        marks: q.marks,
        negativeMarks: q.negativeMarks,
        difficulty: q.difficulty ?? null,
      };
    });

    return {
      ...attempt,
      testTemplateId: attempt.testTemplateId,
      rank,
      percentile,
      topper: {
        score: topper._max.score ?? null,
        accuracyPercent: topper._max.accuracyPercent ?? null,
      },
      questions,
      answers: undefined, // flattened into `questions`
    };
  }

  // ---- v6 §2c: Sectional tests ----

  // v6 §2a — Full shift papers: compose a template's paper server-side.
  // Section composition is derived from the template family (CGL/CHSL/CPO =
  // 4×25 in 60min; MTS = 20/25/25/20 in 90min), matching the real exam
  // blueprint. Questions: approved, bilingual, exactly 4 non-empty options,
  // multi-year round-robin, cross-section dedup. NEVER returns correctAnswer.
  // BUG FIX (root cause of "Subject not found: quantitative-aptitude" on
  // Start Mock): the subjectSlug values below used to be hyphenated
  // ('quantitative-aptitude', 'english-comprehension', 'general-awareness')
  // but every real Subject row in the database — created by the actual
  // data-seeding pipeline (backend/scripts/seed-patterns.mjs and the
  // question-import scripts) — uses underscores instead
  // ('quantitative_aptitude', 'general_awareness') or a shorter slug
  // ('english', not 'english-comprehension'). 'reasoning' happened to match
  // by coincidence, which is why only the OTHER three sections crashed.
  // Confirmed directly against production: GET /bank/meta returned subject
  // slugs computer/english/general_awareness/hindi/quantitative_aptitude/
  // reasoning — none of which are 'quantitative-aptitude',
  // 'general-awareness', or 'english-comprehension'. Corrected here (both
  // in paper() and the identical blueprint in sectionalExamForFamily()
  // below) to the slugs that actually exist.
  async paper(userId: string, templateId: string) {
    const template = await this.prisma.testTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, title: true, type: true, durationMinutes: true, totalQuestions: true, totalMarks: true, isPremium: true, description: true },
    });
    if (!template) throw new BadRequestException('Template not found');
    await this.assertMockEntitled(userId, template);
    const fam = templateId.includes('mts') ? 'mts' : templateId.includes('chsl') ? 'chsl' : templateId.includes('cpo') ? 'cpo' : 'cgl';
    // BUGFIX (Session 20 — "exam-wise button should only give that exam's
    // PYQs" audit): every section query below used to filter only by
    // subjectId + `examId: { not: null }` — i.e. "tagged with SOME exam",
    // not "tagged with THIS exam". A student opening the "SSC CGL Tier 1"
    // mock could silently be served CHSL/MTS/CPO questions mixed in (any
    // exam with a matching subject qualified), which directly contradicts
    // the paper's own title/blueprint. Resolve the exam this family
    // actually maps to (slug matches the exam-import scripts' convention,
    // same 'cgl'/'chsl'/'mts'/'cpo' slugs used across seed-patterns.mjs and
    // the dashboard's own exam lookup) and require every question to carry
    // THAT exam's id. If the exam row itself doesn't exist yet, fail loudly
    // instead of silently degrading to a cross-exam mix.
    const famExam = await this.prisma.exam.findUnique({ where: { slug: fam }, select: { id: true, name: true } });
    if (!famExam) {
      throw new BadRequestException(`Exam not set up for "${fam}" yet — cannot compose an exam-specific paper.`);
    }
    const sections =
      fam === 'mts'
        ? [
            { part: 'A', name: 'Numerical and Mathematical Ability', subjectSlug: 'quantitative_aptitude', q: 20, marks: 20, min: 20 },
            { part: 'B', name: 'Reasoning Ability and Problem Solving', subjectSlug: 'reasoning', q: 25, marks: 25, min: 25 },
            { part: 'C', name: 'English Comprehension', subjectSlug: 'english', q: 25, marks: 25, min: 25 },
            { part: 'D', name: 'General Awareness', subjectSlug: 'general_awareness', q: 20, marks: 20, min: 20 },
          ]
        : [
            { part: 'A', name: 'General Intelligence and Reasoning', subjectSlug: 'reasoning', q: 25, marks: 50, min: 15 },
            { part: 'B', name: 'General Awareness', subjectSlug: 'general_awareness', q: 25, marks: 50, min: 15 },
            { part: 'C', name: 'Quantitative Aptitude', subjectSlug: 'quantitative_aptitude', q: 25, marks: 50, min: 15 },
            { part: 'D', name: 'English Comprehension', subjectSlug: 'english', q: 25, marks: 50, min: 15 },
          ];

    const subs = await this.prisma.subject.findMany({ select: { id: true, slug: true, name: true } });
    const slugToId = new Map(subs.map((s) => [s.slug.toLowerCase(), s.id]));

    const usedAcross = new Set<string>();
    const out: any[] = [];
    for (const sec of sections) {
      const subjectId = slugToId.get(sec.subjectSlug);
      if (!subjectId) throw new BadRequestException(`Subject not found: ${sec.subjectSlug}`);
      const rows: any[] = await this.prisma.question.findMany({
        // examId now pinned to famExam.id (see BUGFIX comment above the
        // exam lookup) instead of the old `examId: { not: null }`, which
        // matched a question from ANY exam that happened to share this
        // subject — the actual root cause of a "CGL" paper being able to
        // contain CHSL/MTS/CPO questions.
        where: { ...PUBLISHED_QUESTION_WHERE, subjectId, examId: famExam.id, questionTextHindi: { not: '' } },
        include: { exam: { select: { name: true } }, chapter: { select: { name: true } } },
        orderBy: [{ year: 'desc' }, { createdAt: 'asc' }],
        take: 500,
      });
      const validRows = rows.filter(
        (r) =>
          Array.isArray(r.optionsJson) &&
          r.optionsJson.length === 4 &&
          r.optionsJson.every((o: any) => o && ((o.text && String(o.text).trim().length > 0) || o.diagramType)),
      );
      // BUGFIX: this used to hard-fail the ENTIRE mock (all 4 sections, 100
      // questions) the moment ANY single section came up short — e.g. "Not
      // enough 4-option bilingual questions for General Intelligence and
      // Reasoning (0/25)" blocked SSC CPO Full Mock 1 even though the other
      // 3 sections had plenty of approved questions. While the question bank
      // is still being filled in, a student should still be able to take a
      // shorter version of the section instead of being blocked outright.
      // Only genuinely block when a section has ZERO usable questions at all
      // (nothing to serve), and require a sane minimum (sec.min) otherwise.
      if (validRows.length === 0)
        throw new BadRequestException(`No approved bilingual questions available yet for ${sec.name}. Please try again later.`);
      if (validRows.length < sec.min)
        throw new BadRequestException(`Not enough 4-option bilingual questions for ${sec.name} (${validRows.length}/${sec.q})`);
      if (validRows.length < sec.q) {
        const originalQ = sec.q;
        sec.q = validRows.length;
        sec.marks = Math.round((sec.marks * sec.q) / originalQ);
      }
      const byYear = new Map<number, any[]>();
      for (const r of validRows) {
        if (usedAcross.has(r.id)) continue;
        const y = r.year ?? 0;
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y)!.push(r);
      }
      const yearKeys = [...byYear.keys()].sort((a, b) => b - a);
      const picked: any[] = [];
      const pointers = new Map<number, number>();
      let cycle = 0;
      while (picked.length < sec.q && cycle < 1000) {
        cycle++;
        let added = false;
        for (const y of yearKeys) {
          if (picked.length >= sec.q) break;
          const pool = byYear.get(y)!;
          const p = pointers.get(y) ?? 0;
          if (p < pool.length) {
            picked.push(pool[p]);
            pointers.set(y, p + 1);
            added = true;
          }
        }
        if (!added) break;
      }
      if (picked.length < sec.q) {
        for (const r of validRows) {
          if (picked.length >= sec.q) break;
          if (!usedAcross.has(r.id) && !picked.includes(r)) picked.push(r);
        }
      }
      picked.forEach((r) => usedAcross.add(r.id));
      out.push({
        part: sec.part,
        name: sec.name,
        subjectSlug: sec.subjectSlug,
        questionCount: sec.q,
        marks: sec.marks,
        minutes: sec.min,
        questions: picked.slice(0, sec.q).map((r) => ({
          id: r.id,
          questionText: r.questionText,
          questionTextHindi: r.questionTextHindi,
          questionDiagramType: r.questionDiagramType ?? null,
          questionDiagramLabels: r.questionDiagramLabels ?? null,
          questionImageUrl: r.questionImageUrl ?? null,
          options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, diagramType: o.diagramType ?? null, diagramLabels: o.diagramLabels ?? null, imageUrl: o.imageUrl ?? null })),
          optionsHi: (r.optionsHi as any[]) || null,
          marks: r.marks ?? 2,
          negativeMarks: r.negativeMarks ?? 0.5,
          year: r.year,
          shift: r.shift,
          examName: r.exam?.name,
          chapter: r.chapter?.name,
          // BUGFIX (bonus grep, item b/f — same answer-leak-gate pattern found
          // repeatedly this audit, this time in the main "take a test" flow
          // itself): explanation/explanationHindi were sent here even though
          // the comment right below explicitly says "NEVER returns
          // correctAnswer" — but explanation text almost always states or
          // heavily implies the correct answer in prose ("The correct answer
          // is (B) because..."), so withholding correctAnswer alone did
          // nothing. Explanations are correctly revealed after submission via
          // attemptDetail() (the results/review screen) — they don't belong
          // in the pre-attempt paper.
        })),
      });
    }

    // Report the ACTUAL composed totals (which may be slightly lower than
    // the template's advertised totals if a section had to be shortened
    // above due to a temporary content gap) rather than the static
    // template.totalMarks, so the exam header/results screen never shows
    // a max-marks figure the paper doesn't actually contain.
    const actualTotalMarks = out.reduce((s, sec) => s + sec.marks, 0);
    return {
      templateId: template.id,
      title: template.title,
      description: template.description,
      type: template.type,
      durationMinutes: template.durationMinutes,
      totalMarks: actualTotalMarks || template.totalMarks,
      isPremium: template.isPremium,
      sections: out,
    };
  }

  // Compose a full sectional exam (v1: SSC CGL Tier 1 2025 hardcoded, 4
  // sections x 25 Qs). GENERALIZED below — see sectionalExamForFamily() —
  // to also cover CHSL/MTS/CPO, reusing the exact family-section blueprints
  // paper() already defines. cglExam() is kept as the exact original
  // route/behaviour (backward compatible with the existing
  // `/tests/sectional/cgl` route the frontend already calls).
  async cglExam() {
    return this.sectionalExamForFamily('cgl');
  }

  // BUGFIX (bonus grep — "sari exams ke test dena ka option"): the full
  // mock-paper flow (paper(), above) already recognises 4 exam families —
  // cgl/chsl/mts/cpo — and gives each its own real section blueprint. But
  // the SECTIONAL practice-exam flow (this method, `/tests/sectional/cgl`)
  // only ever built the CGL blueprint — there was no way to take a proper
  // CHSL/MTS/CPO sectional practice exam even though the question bank and
  // full-mock flow both already support those exams. This generalizes the
  // same composition logic (multi-year round-robin, cross-section dedup,
  // 4-option validation) across all 4 recognised families, using the SAME
  // section blueprints paper() uses, so behaviour stays consistent between
  // "take a full paper" and "practice one exam sectionally".
  async sectionalExamForFamily(family: 'cgl' | 'chsl' | 'mts' | 'cpo') {
    const sections =
      family === 'mts'
        ? [
            { part: 'A', name: 'Numerical and Mathematical Ability', subjectSlug: 'quantitative_aptitude', q: 20, marks: 20, min: 20 },
            { part: 'B', name: 'Reasoning Ability and Problem Solving', subjectSlug: 'reasoning', q: 25, marks: 25, min: 25 },
            { part: 'C', name: 'English Comprehension', subjectSlug: 'english', q: 25, marks: 25, min: 25 },
            { part: 'D', name: 'General Awareness', subjectSlug: 'general_awareness', q: 20, marks: 20, min: 20 },
          ]
        : [
            { part: 'A', name: 'General Intelligence and Reasoning', subjectSlug: 'reasoning', q: 25, marks: 50, min: 15 },
            { part: 'B', name: 'General Awareness', subjectSlug: 'general_awareness', q: 25, marks: 50, min: 15 },
            { part: 'C', name: 'Quantitative Aptitude', subjectSlug: 'quantitative_aptitude', q: 25, marks: 50, min: 15 },
            { part: 'D', name: 'English Comprehension', subjectSlug: 'english', q: 25, marks: 50, min: 15 },
          ];
    // BUGFIX (Session 20 — same root cause as paper() above): resolve the
    // actual exam this family maps to and pin every section's query to it.
    // Previously this method only checked `examId: { not: null }`, so a
    // "CHSL sectional" or "MTS sectional" practice paper could be composed
    // out of any exam's questions as long as the subject matched — the
    // sectional-practice sibling of the exact same cross-exam-mixing bug
    // fixed in paper().
    const famExam = await this.prisma.exam.findUnique({ where: { slug: family }, select: { id: true, name: true } });
    if (!famExam) {
      throw new BadRequestException(`Exam not set up for "${family}" yet — cannot compose an exam-specific sectional paper.`);
    }

    const subs = await this.prisma.subject.findMany({
      select: { id: true, slug: true, name: true },
    });
    const slugToId = new Map(subs.map((s) => [s.slug.toLowerCase(), s.id]));

    const usedAcross = new Set<string>();
    const out: any[] = [];
    for (const sec of sections) {
      const subjectId = slugToId.get(sec.subjectSlug);
      if (!subjectId) throw new BadRequestException(`Subject not found: ${sec.subjectSlug}`);
      const rows: any[] = await this.prisma.question.findMany({
        where: {
          ...PUBLISHED_QUESTION_WHERE,
          subjectId,
          examId: famExam.id,
          questionTextHindi: { not: '' },
        },
        include: { exam: { select: { name: true } }, chapter: { select: { name: true } } },
        orderBy: [{ year: 'desc' }, { createdAt: 'asc' }],
        take: 500,
      });
      // real exam rule: exactly 4 options, each with non-empty text — filter bad rows
      const validRows = rows.filter(
        (r) =>

          Array.isArray(r.optionsJson) &&
          r.optionsJson.length === 4 &&
          r.optionsJson.every((o: any) => o && ((o.text && String(o.text).trim().length > 0) || o.diagramType)),
      );
      if (validRows.length < sec.q) throw new BadRequestException(`Not enough 4-option bilingual questions for ${sec.name} (${validRows.length}/${sec.q})`);
      // multi-year round-robin + cross-section dedup
      const byYear = new Map<number, any[]>();
      for (const r of validRows) {
        if (usedAcross.has(r.id)) continue; // never reuse a question across sections
        const y = r.year ?? 0;
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y)!.push(r);
      }
      const yearKeys = [...byYear.keys()].sort((a, b) => b - a);
      const picked: any[] = [];
      const pointers = new Map<number, number>();
      let cycle = 0;
      while (picked.length < sec.q && cycle < 1000) {
        cycle++;
        let added = false;
        for (const y of yearKeys) {
          if (picked.length >= sec.q) break;
          const pool = byYear.get(y)!;
          const p = pointers.get(y) ?? 0;
          if (p < pool.length) {
            picked.push(pool[p]);
            pointers.set(y, p + 1);
            added = true;
          }
        }
        if (!added) break;
      }
      if (picked.length < sec.q) {
        for (const r of validRows) {
          if (picked.length >= sec.q) break;
          if (!usedAcross.has(r.id) && !picked.includes(r)) picked.push(r);
        }
      }
      picked.forEach((r) => usedAcross.add(r.id));
      out.push({
        part: sec.part,
        name: sec.name,
        subjectSlug: sec.subjectSlug,
        questionCount: sec.q,
        marks: sec.marks,
        minutes: sec.min,
        questions: picked.slice(0, sec.q).map((r) => ({
          id: r.id,
          questionText: r.questionText,
          questionTextHindi: r.questionTextHindi,
          questionDiagramType: r.questionDiagramType ?? null,
          questionDiagramLabels: r.questionDiagramLabels ?? null,
          questionImageUrl: r.questionImageUrl ?? null,
          options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null, diagramType: o.diagramType ?? null, diagramLabels: o.diagramLabels ?? null, imageUrl: o.imageUrl ?? null })),
          // NOTE: correctAnswer deliberately NOT sent — answer key must never
          // reach the client before submit (server-side scoring only).
          // BUGFIX: explanation/explanationHindi used to be sent right here
          // too, which defeats the point above — explanation text almost
          // always states or heavily implies the correct answer in prose.
          // Removed; it's correctly revealed after submission via
          // attemptDetail() (results/review screen), same as paper().
          examName: r.exam?.name,
          chapter: r.chapter?.name,
          year: r.year,
          shift: r.shift,
          marks: r.marks ?? 2,
          negativeMarks: r.negativeMarks ?? 0.5,
          subjectId: r.subjectId,
        })),
      });
    }
    const meta = {
      cgl: { type: 'CGL_TIER1_2025', title: 'SSC CGL Tier 1 — Based on 2025', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, negativeMarks: 0.5 },
      chsl: { type: 'CHSL_TIER1', title: 'SSC CHSL Tier 1', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, negativeMarks: 0.5 },
      mts: { type: 'MTS_PAPER1', title: 'SSC MTS Paper 1', durationMinutes: 90, totalQuestions: 90, totalMarks: 90, negativeMarks: 0.25 },
      cpo: { type: 'CPO_PAPER1', title: 'SSC CPO Paper 1', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, negativeMarks: 0.5 },
    }[family];
    return { ...meta, sections: out };
  }

  // Subjects with approved+bilingual counts (for the sectional picker UI).
  async sectionalSubjects() {
    const rows = await this.prisma.$queryRaw`
      SELECT s.id, s.name, s.slug,
             COUNT(q.id)::int AS "questionCount"
      FROM subjects s
      LEFT JOIN questions q ON q."subjectId" = s.id AND q."isApproved" = true
        AND q."isActive" = true
        AND q."autoSuspended" = false
        AND q."questionTextHindi" IS NOT NULL AND q."questionTextHindi" <> ''
      GROUP BY s.id ORDER BY s.name;`;
    return rows;
  }

  // Compose a sectional test: subject-wise, multi-year distribution, per-test dedup.
  // Returns the SAME shape as bank.set so the live test UI can consume it directly.
  async sectional(subjectId: string, count = 25) {
    const take = Math.min(Math.max(count, 5), 100);
    const rows: any[] = await this.prisma.question.findMany({
      where: {
        ...PUBLISHED_QUESTION_WHERE,
        subjectId,
        questionTextHindi: { not: '' },
        examId: { not: null },
      },
      include: { chapter: { select: { name: true } }, exam: { select: { name: true } } },
      orderBy: [{ year: 'desc' }, { createdAt: 'asc' }],
      take: 1000,
    });
    if (rows.length === 0) throw new BadRequestException('No bilingual questions for this subject');

    // Multi-year spread: group by year, pick round-robin across years with per-year
    // pointers (distinct rows => dedup by QID inherent). Year-missing bucket = 0.
    const byYear = new Map<number, any[]>();
    for (const r of rows) {
      const y = r.year ?? 0;
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(r);
    }
    const yearKeys = [...byYear.keys()].sort((a, b) => b - a);
    const selected: any[] = [];
    const pointers = new Map<number, number>();
    let cycle = 0;
    while (selected.length < take && cycle < 500) {
      cycle++;
      let addedThisCycle = false;
      for (const y of yearKeys) {
        if (selected.length >= take) break;
        const pool = byYear.get(y)!;
        const p = pointers.get(y) ?? 0;
        if (p < pool.length) {
          selected.push(pool[p]);
          pointers.set(y, p + 1);
          addedThisCycle = true;
        }
      }
      if (!addedThisCycle) break;
    }
    // If still short (some years exhausted), fill from remaining pool
    if (selected.length < take) {
      const seen = new Set(selected.map((r) => r.id));
      for (const r of rows) {
        if (selected.length >= take) break;
        if (!seen.has(r.id)) {
          selected.push(r);
          seen.add(r.id);
        }
      }
    }

    const questions = selected.map((r) => ({
      id: r.id,
      questionText: r.questionText,
      questionTextHindi: r.questionTextHindi,
      questionDiagramType: r.questionDiagramType ?? null,
      questionDiagramLabels: r.questionDiagramLabels ?? null,
      questionImageUrl: r.questionImageUrl ?? null,
      options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null, diagramType: o.diagramType ?? null, diagramLabels: o.diagramLabels ?? null, imageUrl: o.imageUrl ?? null })),
      // NOTE: correctAnswer deliberately NOT sent — answer key must never
      // reach the client before submit (server-side scoring only).
      // BUGFIX (session 18 audit — same answer-leak-gate pattern found
      // repeatedly in this file, see paper()/sectionalExamForFamily() above
      // and daily-test.service.ts's loadQuestions()): explanation/
      // explanationHindi were being sent here even though the comment right
      // above explicitly says the answer key must never reach the client
      // before submit. Explanation text almost always states or heavily
      // implies the correct answer in prose, so a student could open
      // sessionStorage("ssc_sectional_set") or the Network tab and read the
      // answer key before attempting a single question. This path (subject-
      // wise sectional test) was the one composer in this file that had NOT
      // been fixed yet. Removed; explanation is correctly revealed only
      // after submission via attemptDetail() (results/review screen), same
      // as every other test type.
      examName: r.exam?.name,
      chapter: r.chapter?.name,
      year: r.year,
      shift: r.shift,
      marks: r.marks,
      negativeMarks: r.negativeMarks,
      subjectId: r.subjectId,
    }));
    return {
      type: 'SECTIONAL',
      count: questions.length,
      years: yearKeys.filter((y) => y !== 0),
      questions,
    };
  }

  // ============ YEAR-WISE CUSTOM TEST (session 18+) ============
  // Students pick one exam + one year (from the PYQ metadata admins already
  // set on upload — no new admin workflow needed), then optionally narrow
  // to specific subjects/chapters/topics, OR hit "Full Paper" to attempt
  // every question tagged with that exam+year as one paper — exactly what
  // was missing per the dashboard-navigation audit ("koi bhi frontend flow
  // nahi hai jahan student sirf ek specific year ka paper de sake").
  //
  // Design choice: an ad-hoc TestTemplate row (type YEAR_WISE) is created
  // per request, then startAttempt() is reused as-is. This means year-wise
  // tests get the EXACT SAME server-authoritative timer, autosave, submit,
  // and — most importantly — the full attemptDetail() analysis screen
  // (rank, percentile, topper comparison, per-question review with
  // explanations revealed post-submit) as every other test type, for free.
  // No parallel scoring/analysis code to maintain or get out of sync.
  async yearWiseStart(
    userId: string,
    opts: { examId: string; year: number; subjectIds?: string[]; chapterIds?: string[]; topicIds?: string[]; full?: boolean },
  ) {
    const { examId, year } = opts;
    if (!examId) throw new BadRequestException('examId is required');
    if (!year) throw new BadRequestException('year is required');

    const where: any = {
      ...PUBLISHED_QUESTION_WHERE,
      examId,
      year,
      questionTextHindi: { not: '' },
    };
    // "full" (attempt the whole year's paper) always wins over any
    // subject/chapter/topic narrowing the UI may still have selected —
    // matches the button's label ("Attempt Full Paper").
    if (!opts.full) {
      // Most specific filter wins: topic > chapter > subject. A student
      // picking a topic almost certainly wants just that topic, not every
      // question in the parent chapter/subject too.
      if (opts.topicIds?.length) where.topicId = { in: opts.topicIds };
      else if (opts.chapterIds?.length) where.chapterId = { in: opts.chapterIds };
      else if (opts.subjectIds?.length) where.subjectId = { in: opts.subjectIds };
    }

    const rows = await this.prisma.question.findMany({
      where,
      include: {
        exam: { select: { name: true } },
        subject: { select: { name: true } },
        chapter: { select: { name: true } },
      },
      orderBy: [{ subjectId: 'asc' }, { createdAt: 'asc' }],
    });
    const validRows = rows.filter(
      (r) =>
        Array.isArray(r.optionsJson) &&
        r.optionsJson.length === 4 &&
        r.optionsJson.every((o: any) => o && ((o.text && String(o.text).trim().length > 0) || o.diagramType)),
    );
    if (validRows.length === 0) {
      throw new BadRequestException(
        'No bilingual questions available for this selection yet. Try a different year, or widen your subject/chapter/topic choice.',
      );
    }

    const exam = await this.prisma.exam.findUnique({ where: { id: examId }, select: { name: true } });
    const totalMarks = validRows.reduce((s, r) => s + (r.marks ?? 2), 0);
    // Same pacing ratio as the family full-mocks in paper() (60 min / 100 Q
    // = 0.6 min/Q), with a sane floor so a tiny topic-wise set doesn't get a
    // useless 1-minute timer.
    const durationMinutes = Math.max(10, Math.round(validRows.length * 0.6));

    const scopeLabel = opts.full
      ? 'Full Paper'
      : opts.topicIds?.length
        ? 'Topic-wise'
        : opts.chapterIds?.length
          ? 'Chapter-wise'
          : opts.subjectIds?.length
            ? 'Subject-wise'
            : 'All Subjects';

    const template = await this.prisma.testTemplate.create({
      data: {
        title: `${exam?.name ?? 'Exam'} ${year} — ${scopeLabel}`,
        type: 'YEAR_WISE',
        durationMinutes,
        totalQuestions: validRows.length,
        totalMarks,
        isPremium: false,
        description: `Custom year-wise test — ${exam?.name ?? ''} ${year} (${scopeLabel})`,
      },
    });

    // Reuses the exact same server-authoritative session start as every
    // other test type: stamps startedAt/expiresAt, handles resume-on-refresh.
    const attempt = await this.startAttempt(userId, template.id);

    return {
      attemptId: attempt.id,
      templateId: template.id,
      title: template.title,
      durationMinutes,
      totalMarks,
      resumed: attempt.resumed,
      questions: validRows.map((r) => ({
        id: r.id,
        questionText: r.questionText,
        questionTextHindi: r.questionTextHindi,
        questionDiagramType: r.questionDiagramType ?? null,
        questionDiagramLabels: r.questionDiagramLabels ?? null,
        questionImageUrl: r.questionImageUrl ?? null,
        options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null, diagramType: o.diagramType ?? null, diagramLabels: o.diagramLabels ?? null, imageUrl: o.imageUrl ?? null })),
        // NOTE: correctAnswer/explanation deliberately NOT sent — same rule
        // as every other pre-attempt paper composer in this file. Revealed
        // only after submit, via attemptDetail().
        examName: r.exam?.name,
        subject: r.subject?.name,
        subjectId: r.subjectId,
        chapter: r.chapter?.name,
        year: r.year,
        shift: r.shift,
        marks: r.marks ?? 2,
        negativeMarks: r.negativeMarks ?? 0.5,
      })),
    };
  }

  // ============ WRONG/SKIPPED AUTO-PRACTICE (v7 §NEW) ============
  // Returns practice questions from chapters where the user got questions wrong or skipped
  async getWeakAreasPractice(
    userId: string,
    options: { limit?: number; includeSkipped?: boolean; examId?: string }
  ) {
    const limit = Math.min(Math.max(options.limit ?? 25, 5), 100);
    const includeSkipped = options.includeSkipped ?? true;

    // Get all SUBMITTED attempts for this user
    const attempts = await this.prisma.testAttempt.findMany({
      where: { userId, status: 'SUBMITTED' },
      select: { id: true, testTemplateId: true },
    });

    if (attempts.length === 0) {
      return { questions: [], chapters: [], message: 'No completed tests yet — take a test first!' };
    }

    const attemptIds = attempts.map((a) => a.id);

    // Find wrong + skipped questions with their chapter/exam info
    const wrongSkipped = await this.prisma.attemptAnswer.findMany({
      where: {
        testAttemptId: { in: attemptIds },
        OR: [
          { isCorrect: false }, // wrong
          ...(includeSkipped ? [{ selectedOption: null }] : []), // skipped
        ],
      },
      include: {
        question: {
          select: {
            id: true,
            chapterId: true,
            subjectId: true,
            examId: true,
            chapter: { select: { name: true } },
            subject: { select: { name: true } },
            exam: { select: { name: true } },
          },
        },
      },
    });

    if (wrongSkipped.length === 0) {
      return { questions: [], chapters: [], message: 'Perfect! No wrong or skipped questions found.' };
    }

    // Aggregate by chapter (weak areas)
    const chapterMap = new Map<string, { chapterId: string; chapterName: string; subjectName: string; examName: string | null; wrongCount: number; skippedCount: number }>();
    for (const ws of wrongSkipped) {
      const q = ws.question;
      if (!q?.chapterId) continue;
      const key = q.chapterId;
      const existing = chapterMap.get(key) ?? {
        chapterId: q.chapterId,
        chapterName: q.chapter?.name ?? 'Unknown',
        subjectName: q.subject?.name ?? 'Unknown',
        examName: q.exam?.name ?? null,
        wrongCount: 0,
        skippedCount: 0,
      };
      if (ws.selectedOption === null) existing.skippedCount++;
      else existing.wrongCount++;
      chapterMap.set(key, existing);
    }

    // Sort chapters by total errors (wrong + skipped) descending
    const weakChapters = [...chapterMap.values()]
      .sort((a, b) => (b.wrongCount + b.skippedCount) - (a.wrongCount + a.skippedCount))
      .slice(0, 10); // Top 10 weak chapters

    // For each weak chapter, fetch fresh questions (not already attempted in recent tests)
    const attemptedQuestionIds = new Set(wrongSkipped.map((ws) => ws.questionId));
    const practiceQuestions: any[] = [];

    for (const ch of weakChapters) {
      const where: any = {
        ...PUBLISHED_QUESTION_WHERE,
        chapterId: ch.chapterId,
        questionTextHindi: { not: '' },
        examId: { not: null },
        id: { notIn: [...attemptedQuestionIds] }, // don't repeat same questions
      };
      if (options.examId) where.examId = options.examId;

      const rows = await this.prisma.question.findMany({
        where,
        include: { exam: { select: { name: true } }, chapter: { select: { name: true } } },
        orderBy: [{ year: 'desc' }, { createdAt: 'asc' }],
        take: Math.ceil(limit / weakChapters.length) + 2, // distribute across chapters
      });

      const validRows = rows.filter(
        (r) =>
          Array.isArray(r.optionsJson) &&
          r.optionsJson.length === 4 &&
          r.optionsJson.every((o: any) => o && ((o.text && String(o.text).trim().length > 0) || o.diagramType)),
      );

      for (const r of validRows) {
        if (practiceQuestions.length >= limit) break;
        practiceQuestions.push({
          id: r.id,
          questionText: r.questionText,
          questionTextHindi: r.questionTextHindi,
          questionDiagramType: r.questionDiagramType ?? null,
          questionDiagramLabels: r.questionDiagramLabels ?? null,
          questionImageUrl: r.questionImageUrl ?? null,
          options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null, diagramType: o.diagramType ?? null, diagramLabels: o.diagramLabels ?? null, imageUrl: o.imageUrl ?? null })),
          chapter: r.chapter?.name ?? '',
          examName: r.exam?.name ?? null,
          year: r.year,
          shift: r.shift,
          marks: r.marks ?? 2,
          negativeMarks: r.negativeMarks ?? 0.5,
          explanation: r.explanation,
          explanationHindi: r.explanationHindi,
          subjectId: r.subjectId,
          // metadata for UI
          _weakMeta: { chapterId: ch.chapterId, chapterName: ch.chapterName, wasWrong: true, wasSkipped: false },
        });
      }
    }

    return {
      type: 'WEAK_AREAS_PRACTICE',
      count: practiceQuestions.length,
      chapters: weakChapters.map((c) => ({
        chapterId: c.chapterId,
        chapterName: c.chapterName,
        subjectName: c.subjectName,
        examName: c.examName,
        wrongCount: c.wrongCount,
        skippedCount: c.skippedCount,
        totalErrors: c.wrongCount + c.skippedCount,
      })),
      questions: practiceQuestions,
    };
  }

  // ---- Enhanced Analytics Methods ----

  /**
   * Get detailed performance analytics for a specific test template
   */
  async getPerformanceAnalytics(userId: string, templateId: string) {
    const attempts = await this.prisma.testAttempt.findMany({
      where: { userId, testTemplateId: templateId, status: 'SUBMITTED' },
      orderBy: { submittedAt: 'desc' },
      include: {
        testTemplate: { select: { title: true, totalQuestions: true, totalMarks: true } },
        answers: {
          include: {
            question: {
              select: {
                id: true,
                subjectId: true,
                chapterId: true,
                examId: true,
                subject: { select: { name: true } },
                chapter: { select: { name: true } },
                exam: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (!attempts.length) {
      return { message: 'No completed attempts for this test' };
    }

    const latest = attempts[0];
    const template = latest.testTemplate;

    // Overall stats
    const scores = attempts.map(a => a.score ?? 0);
    const accuracies = attempts.map(a => a.accuracyPercent ?? 0);
    const times = attempts
      .filter(a => a.startedAt && a.submittedAt)
      .map(a => (new Date(a.submittedAt!).getTime() - new Date(a.startedAt!).getTime()) / 1000);

    // Subject-wise breakdown
    const subjectStats = new Map<string, { total: number; correct: number; wrong: number; skipped: number; time: number }>();
    const chapterStats = new Map<string, { total: number; correct: number; wrong: number; skipped: number; time: number }>();

    for (const attempt of attempts) {
      for (const answer of attempt.answers) {
        const q = answer.question;
        if (!q) continue;

        const subjName = q.subject?.name || 'Unknown';
        const chapName = q.chapter?.name || 'Unknown';
        const examName = q.exam?.name || 'Unknown';

        // Subject stats
        if (!subjectStats.has(subjName)) subjectStats.set(subjName, { total: 0, correct: 0, wrong: 0, skipped: 0, time: 0 });
        const subj = subjectStats.get(subjName)!;
        subj.total++;
        if (answer.isCorrect) subj.correct++;
        else if (answer.selectedOption === null) subj.skipped++;
        else subj.wrong++;
        subj.time += answer.timeSpentSeconds || 0;

        // Chapter stats
        const chapKey = `${chapName} (${examName})`;
        if (!chapterStats.has(chapKey)) chapterStats.set(chapKey, { total: 0, correct: 0, wrong: 0, skipped: 0, time: 0 });
        const chap = chapterStats.get(chapKey)!;
        chap.total++;
        if (answer.isCorrect) chap.correct++;
        else if (answer.selectedOption === null) chap.skipped++;
        else chap.wrong++;
        chap.time += answer.timeSpentSeconds || 0;
      }
    }

    // Progress over attempts
    const attemptProgress = attempts.slice().reverse().map((a, i) => ({
      attemptNumber: i + 1,
      score: a.score ?? 0,
      accuracy: a.accuracyPercent ?? 0,
      timeSpent: a.startedAt && a.submittedAt
        ? Math.round((new Date(a.submittedAt!).getTime() - new Date(a.startedAt!).getTime()) / 1000)
        : 0,
      date: a.submittedAt,
    }));

    return {
      templateId,
      templateTitle: template.title,
      totalAttempts: attempts.length,
      bestScore: Math.max(...scores),
      avgScore: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
      latestScore: scores[0],
      bestAccuracy: Math.max(...accuracies),
      avgAccuracy: Math.round((accuracies.reduce((a, b) => a + b, 0) / accuracies.length) * 10) / 10,
      latestAccuracy: accuracies[0],
      avgTimePerAttempt: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
      subjectWise: Array.from(subjectStats.entries()).map(([subject, stats]) => ({
        subject,
        accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 1000) / 10 : 0,
        totalQuestions: stats.total,
        correct: stats.correct,
        wrong: stats.wrong,
        skipped: stats.skipped,
        avgTimePerQuestion: stats.total > 0 ? Math.round(stats.time / stats.total) : 0,
      })),
      chapterWise: Array.from(chapterStats.entries())
        .map(([chapter, stats]) => ({
          chapter,
          accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 1000) / 10 : 0,
          totalQuestions: stats.total,
          correct: stats.correct,
          wrong: stats.wrong,
          skipped: stats.skipped,
          avgTimePerQuestion: stats.total > 0 ? Math.round(stats.time / stats.total) : 0,
        }))
        .sort((a, b) => b.totalQuestions - a.totalQuestions),
      attemptProgress,
    };
  }

  /**
   * Get subject-wise performance across all tests
   */
  async getSubjectWiseAnalytics(userId: string) {
    const attempts = await this.prisma.testAttempt.findMany({
      where: { userId, status: 'SUBMITTED' },
      include: {
        answers: {
          include: {
            question: {
              select: {
                subjectId: true,
                subject: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const subjectMap = new Map<string, { total: number; correct: number; wrong: number; skipped: number; time: number }>();

    for (const attempt of attempts) {
      for (const answer of attempt.answers) {
        const q = answer.question;
        if (!q) continue;
        const subjName = q.subject?.name || 'Unknown';
        if (!subjectMap.has(subjName)) subjectMap.set(subjName, { total: 0, correct: 0, wrong: 0, skipped: 0, time: 0 });
        const stats = subjectMap.get(subjName)!;
        stats.total++;
        if (answer.isCorrect) stats.correct++;
        else if (answer.selectedOption === null) stats.skipped++;
        else stats.wrong++;
        stats.time += answer.timeSpentSeconds || 0;
      }
    }

    return Array.from(subjectMap.entries())
      .map(([subject, stats]) => ({
        subject,
        totalAttempts: attempts.length,
        totalQuestions: stats.total,
        correct: stats.correct,
        wrong: stats.wrong,
        skipped: stats.skipped,
        accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 1000) / 10 : 0,
        avgTimePerQuestion: stats.total > 0 ? Math.round(stats.time / stats.total) : 0,
      }))
      .sort((a, b) => b.totalQuestions - a.totalQuestions);
  }

  /**
   * Get time spent analytics
   */
  async getTimeSpentAnalytics(userId: string, templateId?: string) {
    const where: any = { userId, status: 'SUBMITTED' };
    if (templateId) where.testTemplateId = templateId;

    const attempts = await this.prisma.testAttempt.findMany({
      where,
      include: {
        testTemplate: { select: { title: true, durationMinutes: true } },
        answers: { select: { timeSpentSeconds: true, questionId: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });

    const totalTime = attempts.reduce((sum, a) => {
      if (a.startedAt && a.submittedAt) {
        return sum + (new Date(a.submittedAt).getTime() - new Date(a.startedAt).getTime()) / 1000;
      }
      return sum + (a.answers.reduce((s, ans) => s + (ans.timeSpentSeconds || 0), 0));
    }, 0);

    const avgTimePerAttempt = attempts.length ? totalTime / attempts.length : 0;
    const avgTimePerQuestion = attempts.reduce((sum, a) => sum + a.answers.length, 0) > 0
      ? attempts.reduce((sum, a) => sum + a.answers.reduce((s, ans) => s + (ans.timeSpentSeconds || 0), 0), 0) /
        attempts.reduce((sum, a) => sum + a.answers.length, 0)
      : 0;

    return {
      totalAttempts: attempts.length,
      totalTimeSpentSeconds: Math.round(totalTime),
      avgTimePerAttemptSeconds: Math.round(avgTimePerAttempt),
      avgTimePerQuestionSeconds: Math.round(avgTimePerQuestion),
      attempts: attempts.map(a => ({
        templateTitle: a.testTemplate?.title,
        durationMinutes: a.testTemplate?.durationMinutes,
        actualTimeSeconds: a.startedAt && a.submittedAt
          ? Math.round((new Date(a.submittedAt).getTime() - new Date(a.startedAt).getTime()) / 1000)
          : a.answers.reduce((s, ans) => s + (ans.timeSpentSeconds || 0), 0),
        questionsAnswered: a.answers.length,
      })),
    };
  }

  /**
   * Get accuracy trend over time
   */
  async getAccuracyTrend(userId: string, days: number = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const attempts = await this.prisma.testAttempt.findMany({
      where: { userId, status: 'SUBMITTED', submittedAt: { gte: since } },
      select: { accuracyPercent: true, submittedAt: true, score: true },
      orderBy: { submittedAt: 'asc' },
    });

    // Group by day
    const dailyMap = new Map<string, { accuracies: number[]; scores: number[] }>();
    for (const a of attempts) {
      const day = a.submittedAt!.toISOString().split('T')[0];
      if (!dailyMap.has(day)) dailyMap.set(day, { accuracies: [], scores: [] });
      const d = dailyMap.get(day)!;
      if (a.accuracyPercent != null) d.accuracies.push(a.accuracyPercent);
      if (a.score != null) d.scores.push(a.score);
    }

    return Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        avgAccuracy: data.accuracies.length
          ? Math.round((data.accuracies.reduce((a, b) => a + b, 0) / data.accuracies.length) * 10) / 10
          : 0,
        avgScore: data.scores.length
          ? Math.round((data.scores.reduce((a, b) => a + b, 0) / data.scores.length) * 10) / 10
          : 0,
        attempts: data.accuracies.length,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get weak chapters (lowest accuracy)
   */
  async getWeakChapters(userId: string) {
    const attempts = await this.prisma.testAttempt.findMany({
      where: { userId, status: 'SUBMITTED' },
      include: {
        answers: {
          include: {
            question: {
              select: {
                chapterId: true,
                chapter: { select: { name: true } },
                subject: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const chapterMap = new Map<string, { name: string; subject: string; total: number; correct: number; wrong: number; skipped: number }>();

    for (const attempt of attempts) {
      for (const answer of attempt.answers) {
        const q = answer.question;
        if (!q?.chapterId) continue;
        const key = q.chapterId;
        const name = q.chapter?.name || 'Unknown';
        const subject = q.subject?.name || 'Unknown';
        if (!chapterMap.has(key)) chapterMap.set(key, { name, subject, total: 0, correct: 0, wrong: 0, skipped: 0 });
        const stats = chapterMap.get(key)!;
        stats.total++;
        if (answer.isCorrect) stats.correct++;
        else if (answer.selectedOption === null) stats.skipped++;
        else stats.wrong++;
      }
    }

    return Array.from(chapterMap.entries())
      .filter(([, stats]) => stats.total >= 5) // Minimum 5 questions
      .map(([chapterId, stats]) => ({
        chapterId,
        chapterName: stats.name,
        subject: stats.subject,
        totalQuestions: stats.total,
        correct: stats.correct,
        wrong: stats.wrong,
        skipped: stats.skipped,
        accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 20);
  }

  /**
   * Get strength chapters (highest accuracy)
   */
  async getStrengthChapters(userId: string) {
    const attempts = await this.prisma.testAttempt.findMany({
      where: { userId, status: 'SUBMITTED' },
      include: {
        answers: {
          include: {
            question: {
              select: {
                chapterId: true,
                chapter: { select: { name: true } },
                subject: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const chapterMap = new Map<string, { name: string; subject: string; total: number; correct: number; wrong: number; skipped: number }>();

    for (const attempt of attempts) {
      for (const answer of attempt.answers) {
        const q = answer.question;
        if (!q?.chapterId) continue;
        const key = q.chapterId;
        const name = q.chapter?.name || 'Unknown';
        const subject = q.subject?.name || 'Unknown';
        if (!chapterMap.has(key)) chapterMap.set(key, { name, subject, total: 0, correct: 0, wrong: 0, skipped: 0 });
        const stats = chapterMap.get(key)!;
        stats.total++;
        if (answer.isCorrect) stats.correct++;
        else if (answer.selectedOption === null) stats.skipped++;
        else stats.wrong++;
      }
    }

    return Array.from(chapterMap.entries())
      .filter(([, stats]) => stats.total >= 5)
      .map(([chapterId, stats]) => ({
        chapterId,
        chapterName: stats.name,
        subject: stats.subject,
        totalQuestions: stats.total,
        correct: stats.correct,
        wrong: stats.wrong,
        skipped: stats.skipped,
        accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.accuracy - a.accuracy)
      .slice(0, 20);
  }

  /**
   * Get comparison with toppers for a specific test
   */
  async getComparisonWithToppers(userId: string, templateId: string) {
    const userAttempts = await this.prisma.testAttempt.findMany({
      where: { userId, testTemplateId: templateId, status: 'SUBMITTED' },
      orderBy: { submittedAt: 'desc' },
      take: 1,
    });

    if (!userAttempts.length) {
      return { message: 'You have not attempted this test yet' };
    }

    const latest = userAttempts[0];

    // Get top 5 toppers
    const toppers = await this.prisma.testAttempt.findMany({
      where: { testTemplateId: templateId, status: 'SUBMITTED' },
      orderBy: { score: 'desc' },
      take: 5,
      select: {
        user: { select: { fullName: true } },
        score: true,
        accuracyPercent: true,
        submittedAt: true,
        startedAt: true,
      },
    });

    // Get average stats
    const stats = await this.prisma.testAttempt.aggregate({
      where: { testTemplateId: templateId, status: 'SUBMITTED' },
      _avg: { score: true, accuracyPercent: true },
      _max: { score: true, accuracyPercent: true },
      _count: true,
    });

    // BUG FIX (audit round 4, item 3): rank and percentile were both INVERTED.
    // Old code counted attempts with score < yours and called that `percentile`,
    // then set yourRank = that count + 1 — so a top scorer (almost everyone
    // below them) ended up with the WORST rank (e.g. rank 10 of 10), and
    // yourPercentile = (total - belowCount) / total, which for a top scorer
    // rounds to ~0% ("you beat ~0% of test takers") instead of ~100%.
    // Correct definitions: rank = 1 + (number of attempts that scored HIGHER
    // than you); percentile = % of attempts you scored better than (i.e. the
    // number of attempts with a LOWER score, divided by total).
    const scoredHigher = await this.prisma.testAttempt.count({
      where: { testTemplateId: templateId, status: 'SUBMITTED', score: { gt: latest.score } },
    });
    const scoredLower = await this.prisma.testAttempt.count({
      where: { testTemplateId: templateId, status: 'SUBMITTED', score: { lt: latest.score } },
    });
    const total = await this.prisma.testAttempt.count({
      where: { testTemplateId: templateId, status: 'SUBMITTED' },
    });

    return {
      yourScore: latest.score ?? 0,
      yourAccuracy: latest.accuracyPercent ?? 0,
      yourRank: scoredHigher + 1,
      yourPercentile: total > 0 ? Math.round((scoredLower / total) * 1000) / 10 : 100,
      totalAttempts: total,
      averageScore: Math.round((stats._avg.score || 0) * 10) / 10,
      averageAccuracy: Math.round((stats._avg.accuracyPercent || 0) * 10) / 10,
      maxScore: stats._max.score ?? 0,
      maxAccuracy: stats._max.accuracyPercent ?? 0,
      toppers: toppers.map((t, i) => ({
        rank: i + 1,
        name: t.user?.fullName || 'Student',
        score: t.score ?? 0,
        accuracy: t.accuracyPercent ?? 0,
        timeTaken: t.startedAt && t.submittedAt
          ? Math.round((new Date(t.submittedAt).getTime() - new Date(t.startedAt).getTime()) / 1000)
          : 0,
      })),
    };
  }
}
