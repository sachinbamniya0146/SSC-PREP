/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { cacheGet, cacheSet } from '../common/cache';

@Injectable()
export class TestsService {
  constructor(
    private prisma: PrismaService,
    private gamification: GamificationService,
  ) {}

  // ---- P0 — premium entitlement enforcement (server-side, never trust FE) ----
  // A premium template requires: an ACTIVE subscription (endsAt in future)
  // OR a paid MockAccess row for that template (or free trial pack).
  private async assertMockEntitled(userId: string, template: { id: string; isPremium?: boolean | null }) {
    if (!template.isPremium) return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptions: { where: { status: 'ACTIVE' }, select: { endsAt: true }, take: 1 } },
    });
    const subActive = user?.subscriptions?.[0] && new Date(user.subscriptions[0].endsAt) > new Date();
    if (subActive) return;
    const mock = await this.prisma.mockAccess.findUnique({
      where: { userId_testTemplateId: { userId, testTemplateId: template.id } },
      select: { paidPacksPurchased: true, freeMocksAllowed: true, mocksUsed: true },
    });
    if (mock && mock.paidPacksPurchased > 0) return;
    if (mock && mock.mocksUsed < mock.freeMocksAllowed) return; // free trial pack
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
      answers: scoredAnswers.length
        ? { createMany: { data: scoredAnswers, skipDuplicates: true } } // autosaved rows already exist
        : undefined,
    },
    include: {
      testTemplate: { select: { id: true, title: true, totalQuestions: true, totalMarks: true } },
      answers: { select: { questionId: true, selectedOption: true, isCorrect: true, timeSpentSeconds: true } },
    },
  });

  this.gamification.awardTestXp(userId, totalCorrect, 'mock').catch(() => undefined);

  return { ...updated, expired };
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
      const opts = Array.isArray(q.optionsJson)
        ? (q.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null }))
        : [];
      return {
        questionId: q.id,
        questionText: q.questionText,
        questionTextHindi: q.questionTextHindi,
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
  async paper(userId: string, templateId: string) {
    const template = await this.prisma.testTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, title: true, type: true, durationMinutes: true, totalQuestions: true, totalMarks: true, isPremium: true, description: true },
    });
    if (!template) throw new BadRequestException('Template not found');
    await this.assertMockEntitled(userId, template);
    const fam = templateId.includes('mts') ? 'mts' : templateId.includes('chsl') ? 'chsl' : templateId.includes('cpo') ? 'cpo' : 'cgl';
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
        where: { isApproved: true, subjectId, questionTextHindi: { not: '' }, examId: { not: null } },
        include: { exam: { select: { name: true } }, chapter: { select: { name: true } } },
        orderBy: [{ year: 'desc' }, { createdAt: 'asc' }],
        take: 500,
      });
      const validRows = rows.filter(
        (r) =>
          Array.isArray(r.optionsJson) &&
          r.optionsJson.length === 4 &&
          r.optionsJson.every((o: any) => o && o.text && String(o.text).trim().length > 0),
      );
      if (validRows.length < sec.q)
        throw new BadRequestException(`Not enough 4-option bilingual questions for ${sec.name} (${validRows.length}/${sec.q})`);
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
          options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text })),
          optionsHi: (r.optionsHi as any[]) || null,
          marks: r.marks ?? 2,
          negativeMarks: r.negativeMarks ?? 0.5,
          year: r.year,
          shift: r.shift,
          examName: r.exam?.name,
          chapter: r.chapter?.name,
          explanation: r.explanation,
          explanationHindi: r.explanationHindi,
        })),
      });
    }

    return {
      templateId: template.id,
      title: template.title,
      description: template.description,
      type: template.type,
      durationMinutes: template.durationMinutes,
      totalMarks: template.totalMarks,
      isPremium: template.isPremium,
      sections: out,
    };
  }

  // Compose the SSC CGL Tier 1 2025 exam: 4 sections × 25 Qs (Reasoning, GA, Quant,
  // English), 15-min sectional timers, 200 marks, cross-section + within-section dedup.
  async cglExam() {
    const sections = [
      { part: 'A', name: 'General Intelligence and Reasoning', subjectSlug: 'reasoning', q: 25, marks: 50, min: 15 },
      { part: 'B', name: 'General Awareness', subjectSlug: 'general_awareness', q: 25, marks: 50, min: 15 },
      { part: 'C', name: 'Quantitative Aptitude', subjectSlug: 'quantitative_aptitude', q: 25, marks: 50, min: 15 },
      { part: 'D', name: 'English Comprehension', subjectSlug: 'english', q: 25, marks: 50, min: 15 },
    ];
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
          isApproved: true,
          subjectId,
          questionTextHindi: { not: '' },
          examId: { not: null },
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
          r.optionsJson.every((o: any) => o && o.text && String(o.text).trim().length > 0),
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
          options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null })),
          // NOTE: correctAnswer deliberately NOT sent — answer key must never
          // reach the client before submit (server-side scoring only).
          explanation: r.explanation,
          explanationHindi: r.explanationHindi,
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
    return {
      type: 'CGL_TIER1_2025',
      title: 'SSC CGL Tier 1 — Based on 2025',
      durationMinutes: 60,
      totalQuestions: 100,
      totalMarks: 200,
      negativeMarks: 0.5,
      sections: out,
    };
  }

  // Subjects with approved+bilingual counts (for the sectional picker UI).
  async sectionalSubjects() {
    const rows = await this.prisma.$queryRaw`
      SELECT s.id, s.name, s.slug,
             COUNT(q.id)::int AS "questionCount"
      FROM subjects s
      LEFT JOIN questions q ON q."subjectId" = s.id AND q."isApproved" = true
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
        isApproved: true,
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
      options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null })),
      // NOTE: correctAnswer deliberately NOT sent — answer key must never
      // reach the client before submit (server-side scoring only).
      explanation: r.explanation,
      explanationHindi: r.explanationHindi,
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
        isApproved: true,
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
          r.optionsJson.every((o: any) => o && o.text && String(o.text).trim().length > 0),
      );

      for (const r of validRows) {
        if (practiceQuestions.length >= limit) break;
        practiceQuestions.push({
          id: r.id,
          questionText: r.questionText,
          questionTextHindi: r.questionTextHindi,
          options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null })),
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
}
