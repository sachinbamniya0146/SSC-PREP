/* eslint-disable @typescript-eslint/no-explicit-any */
// Study Plan v2 (Sep 29 2026).
//
// Sachin's spec, in order:
//  1. student sets target exam + exam date (mandatory)  -> existing createPlan()
//  2. student marks chapters "I finished this"          -> markChapters()
//  3. next day 9:00 AM IST a customised test is due, in the FULL pattern of the
//     target exam, built ONLY from the chapters marked  -> upcomingTest()/startTest()
//  4. chapter < 90% in that test -> un-marked + WEAK; >= 90% -> COMPLETE
//     (also COMPLETE from any other test or a chapter-wide practice set)
//  5. weak chapters/topics/sub-topics visible exam-wise & subject-wise, with a
//     practice deep-link to strengthen them                -> weakBoard()
//  6. a daily target (chapters + practice + PYQ tests) derived from days left
//                                                         -> todayPlan()
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { istDateKey } from '../gamification/gamification.service';
import { PUBLISHED_QUESTION_WHERE } from '../common/question-visibility';
import { applyAttemptToChapters, CHAPTER_COMPLETE_PCT } from './study-plan-progress.util';

interface BiMsg {
  en: string;
  hi: string;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const TEST_HOUR_IST = 9;

function shuffled<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Tomorrow 09:00 IST as a UTC Date ("Kal next day 9 am pr aapka test he"). */
export function nextNineAmIst(now = new Date()): Date {
  const todayIstMidnightUtc = new Date(new Date(`${istDateKey(now)}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
  return new Date(todayIstMidnightUtc.getTime() + DAY_MS + TEST_HOUR_IST * 3600 * 1000);
}

function istMidnightUtc(d: Date): Date {
  return new Date(new Date(`${istDateKey(d)}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
}

const MSG = {
  noPlan: {
    en: 'First set your target exam and exam date — your plan and tests are built from them.',
    hi: 'पहले अपना टारगेट एग्ज़ाम और एग्ज़ाम की तारीख़ सेट करें — आपका प्लान और टेस्ट उसी से बनते हैं।',
  } as BiMsg,
  scheduled(chapters: number): BiMsg {
    return {
      en: `Your test on ${chapters} chapter(s) is tomorrow at 9:00 AM. Revise them well — the paper follows your exam's real pattern.`,
      hi: `${chapters} चैप्टर का आपका टेस्ट कल सुबह 9:00 बजे है। अच्छे से रिवीज़न करें — पेपर आपके एग्ज़ाम के असली पैटर्न पर होगा।`,
    };
  },
  notYet(hoursLeft: number): BiMsg {
    return {
      en: `The test opens at 9:00 AM — about ${hoursLeft} hour(s) left. Use the time to revise the chapters listed.`,
      hi: `टेस्ट सुबह 9:00 बजे खुलेगा — लगभग ${hoursLeft} घंटे बाकी हैं। इस समय में लिस्ट किए गए चैप्टर पढ़ लें।`,
    };
  },
  weak(names: string[]): BiMsg {
    const list = names.slice(0, 6).join(', ') + (names.length > 6 ? '…' : '');
    return {
      en: `Still weak (below ${CHAPTER_COMPLETE_PCT}%): ${list}. These are un-marked — practise them again and get stronger.`,
      hi: `अभी भी कमज़ोर (${CHAPTER_COMPLETE_PCT}% से कम): ${list}। इन्हें मार्क से हटा दिया गया है — दोबारा प्रैक्टिस करके मज़बूत बनाइए।`,
    };
  },
  allComplete: {
    en: 'Excellent! Every marked chapter scored 90%+ and is now complete.',
    hi: 'शानदार! आपके सभी मार्क किए हुए चैप्टर में 90%+ आया और वे अब पूरे हो गए हैं।',
  } as BiMsg,
};

@Injectable()
export class StudyPlanV2Service {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------ helpers
  private async latestPlan(userId: string) {
    return this.prisma.studyPlan.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { exam: { select: { id: true, name: true } } },
    });
  }

  private async resolveExam(userId: string, examId?: string) {
    const plan = await this.latestPlan(userId);
    if (examId) {
      const exam = await this.prisma.exam.findUnique({ where: { id: examId }, select: { id: true, name: true } });
      if (!exam) throw new BadRequestException('Exam not found');
      return { exam, plan };
    }
    if (!plan) throw new BadRequestException({ message: MSG.noPlan.en, code: 'NO_PLAN', messages: MSG.noPlan });
    return { exam: plan.exam, plan };
  }

  /** Subjects that belong to an exam: those in its pattern sections + those that have its questions. */
  private async examSubjectIds(examId: string): Promise<string[]> {
    const [patterns, qSubjects] = await Promise.all([
      this.prisma.examPattern.findMany({ where: { examId, isActive: true }, select: { sections: true } }),
      this.prisma.question.findMany({ where: { examId, isActive: true }, distinct: ['subjectId'], select: { subjectId: true } }),
    ]);
    const slugs = new Set<string>();
    for (const p of patterns) for (const sec of (p.sections as any[]) || []) if (sec?.subjectSlug) slugs.add(String(sec.subjectSlug));
    const bySlug = slugs.size
      ? await this.prisma.subject.findMany({ where: { slug: { in: [...slugs] } }, select: { id: true } })
      : [];
    return [...new Set([...bySlug.map((s) => s.id), ...qSubjects.map((q) => q.subjectId).filter((x): x is string => !!x)])];
  }

  private async chapterQuestionCounts(chapterIds: string[]): Promise<Map<string, number>> {
    if (!chapterIds.length) return new Map();
    const rows = await this.prisma.question.groupBy({
      by: ['chapterId'],
      where: { ...PUBLISHED_QUESTION_WHERE, chapterId: { in: chapterIds } },
      _count: { _all: true },
    });
    return new Map(rows.map((r: any) => [r.chapterId as string, r._count._all as number]));
  }

  // -------------------------------------------------------- 1. chapter board
  /** GET /study-plan/chapters?examId= — every chapter of the exam with the student's status. */
  async board(userId: string, examId?: string) {
    const { exam, plan } = await this.resolveExam(userId, examId);
    const subjectIds = await this.examSubjectIds(exam.id);
    const chapters = await this.prisma.chapter.findMany({
      where: { subjectId: { in: subjectIds } },
      include: { subject: { select: { id: true, name: true, nameHindi: true } } },
      orderBy: [{ subjectId: 'asc' }, { name: 'asc' }],
    });
    const ids = chapters.map((c) => c.id);
    const [counts, progress] = await Promise.all([
      this.chapterQuestionCounts(ids),
      this.prisma.studyPlanChapter.findMany({ where: { userId, chapterId: { in: ids } } }),
    ]);
    const prog = new Map(progress.map((p) => [p.chapterId, p]));

    const subjects = new Map<string, { id: string; name: string; nameHindi: string | null; chapters: any[] }>();
    const summary = { total: 0, complete: 0, weak: 0, selfMarked: 0, pending: 0 };
    for (const c of chapters) {
      const qc = counts.get(c.id) ?? 0;
      const p = prog.get(c.id);
      const status = p?.status ?? 'PENDING';
      if (!subjects.has(c.subjectId)) subjects.set(c.subjectId, { id: c.subject.id, name: c.subject.name, nameHindi: c.subject.nameHindi, chapters: [] });
      subjects.get(c.subjectId)!.chapters.push({
        id: c.id,
        name: c.name,
        nameHindi: c.nameHindi,
        questionCount: qc,
        testable: qc > 0,
        status,
        lastScorePct: p?.lastScorePct ?? null,
      });
      if (qc > 0) {
        summary.total++;
        if (status === 'COMPLETE') summary.complete++;
        else if (status === 'WEAK') summary.weak++;
        else if (status === 'SELF_MARKED') summary.selfMarked++;
        else summary.pending++;
      }
    }
    const targetDate = plan?.targetDate ?? null;
    return {
      exam,
      summary,
      plan: plan
        ? { targetDate, daysLeft: Math.max(0, Math.ceil((plan.targetDate.getTime() - istMidnightUtc(new Date()).getTime()) / DAY_MS)) }
        : null,
      subjects: [...subjects.values()],
    };
  }

  // --------------------------------------------------- 2. mark / unmark chapters
  /** POST /study-plan/chapters/mark { chapterIds, complete } */
  async markChapters(userId: string, chapterIds: string[], complete: boolean) {
    const ids = [...new Set((chapterIds || []).filter((x) => typeof x === 'string' && x))];
    if (!ids.length) throw new BadRequestException('Select at least one chapter');
    const plan = await this.latestPlan(userId);
    if (!plan) throw new BadRequestException({ message: MSG.noPlan.en, code: 'NO_PLAN', messages: MSG.noPlan });

    const chapters = await this.prisma.chapter.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const valid = chapters.map((c) => c.id);
    if (!valid.length) throw new BadRequestException('Chapters not found');

    const now = new Date();
    if (complete) {
      const counts = await this.chapterQuestionCounts(valid);
      const testable = valid.filter((id) => (counts.get(id) ?? 0) > 0);
      const skipped = valid.filter((id) => !testable.includes(id));
      const existing = await this.prisma.studyPlanChapter.findMany({ where: { userId, chapterId: { in: testable } } });
      const alreadyComplete = new Set(existing.filter((e) => e.status === 'COMPLETE').map((e) => e.chapterId));
      const toMark = testable.filter((id) => !alreadyComplete.has(id));
      for (const chapterId of toMark) {
        await this.prisma.studyPlanChapter.upsert({
          where: { userId_chapterId: { userId, chapterId } },
          create: { userId, chapterId, status: 'SELF_MARKED', selfMarkedAt: now },
          update: { status: 'SELF_MARKED', selfMarkedAt: now, completedAt: null },
        });
      }
      if (toMark.length) await this.addToScheduledTest(userId, plan.examId, toMark, now);
      return { marked: toMark.length, alreadyComplete: alreadyComplete.size, skippedNoQuestions: skipped.length, ...(await this.upcomingTest(userId)) };
    }

    // Un-mark: back to PENDING (a COMPLETE chapter is verified by score, not by claim, so it stays).
    await this.prisma.studyPlanChapter.updateMany({
      where: { userId, chapterId: { in: valid }, status: { in: ['SELF_MARKED', 'WEAK'] } },
      data: { status: 'PENDING', selfMarkedAt: null },
    });
    const sched = await this.prisma.studyPlanTest.findFirst({ where: { userId, status: 'SCHEDULED' }, orderBy: { scheduledFor: 'desc' } });
    if (sched) {
      const left = ((sched.chapterIds as string[]) ?? []).filter((id) => !valid.includes(id));
      if (left.length) await this.prisma.studyPlanTest.update({ where: { id: sched.id }, data: { chapterIds: left } });
      else await this.prisma.studyPlanTest.delete({ where: { id: sched.id } });
    }
    return { marked: 0, ...(await this.upcomingTest(userId)) };
  }

  private async addToScheduledTest(userId: string, examId: string, chapterIds: string[], now: Date) {
    const sched = await this.prisma.studyPlanTest.findFirst({ where: { userId, status: 'SCHEDULED' }, orderBy: { scheduledFor: 'desc' } });
    if (sched) {
      const merged = [...new Set([...((sched.chapterIds as string[]) ?? []), ...chapterIds])];
      await this.prisma.studyPlanTest.update({ where: { id: sched.id }, data: { chapterIds: merged, examId } });
      return;
    }
    await this.prisma.studyPlanTest.create({
      data: { userId, examId, scheduledFor: nextNineAmIst(now), chapterIds },
    });
  }

  // ----------------------------------------------------------- 3. the 9 AM test
  /** GET /study-plan/test/upcoming — countdown + what to revise, or the last result. */
  async upcomingTest(userId: string) {
    const active = await this.prisma.studyPlanTest.findFirst({
      where: { userId, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
      orderBy: { scheduledFor: 'asc' },
    });
    if (!active) {
      const last = await this.prisma.studyPlanTest.findFirst({ where: { userId, status: 'SUBMITTED' }, orderBy: { submittedAt: 'desc' } });
      return { test: null, lastResult: last ? { id: last.id, scorePct: last.scorePct, submittedAt: last.submittedAt } : null };
    }
    const chapterIds = (active.chapterIds as string[]) ?? [];
    const chapters = await this.prisma.chapter.findMany({
      where: { id: { in: chapterIds } },
      include: { subject: { select: { id: true, name: true, nameHindi: true } } },
      orderBy: { name: 'asc' },
    });
    const bySubject = new Map<string, { subjectId: string; subject: string; subjectHindi: string | null; chapters: { id: string; name: string; nameHindi: string | null }[] }>();
    for (const c of chapters) {
      if (!bySubject.has(c.subjectId)) bySubject.set(c.subjectId, { subjectId: c.subjectId, subject: c.subject.name, subjectHindi: c.subject.nameHindi, chapters: [] });
      bySubject.get(c.subjectId)!.chapters.push({ id: c.id, name: c.name, nameHindi: c.nameHindi });
    }
    const msLeft = Math.max(0, active.scheduledFor.getTime() - Date.now());
    const hoursLeft = Math.ceil(msLeft / 3600000);
    const [exam, pattern] = await Promise.all([
      this.prisma.exam.findUnique({ where: { id: active.examId }, select: { name: true } }),
      this.prisma.examPattern.findFirst({
        where: { examId: active.examId, isActive: true },
        orderBy: { totalQuestions: 'desc' },
        select: { totalQuestions: true, totalMarks: true, durationMinutes: true },
      }),
    ]);
    return {
      test: {
        id: active.id,
        status: active.status,
        examName: exam?.name ?? '',
        scheduledFor: active.scheduledFor,
        msLeft,
        hoursLeft,
        canStart: msLeft === 0,
        chapterCount: chapters.length,
        pattern: pattern ?? { totalQuestions: 100, totalMarks: 200, durationMinutes: 60 },
        subjects: [...bySubject.values()],
        message: msLeft > 0 ? MSG.notYet(hoursLeft) : MSG.scheduled(chapters.length),
      },
      lastResult: null,
    };
  }

  private async loadQuestions(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.question.findMany({
      where: { id: { in: ids } },
      include: { exam: { select: { name: true } }, chapter: { select: { name: true } } },
    });
    const map = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => map.get(id))
      .filter(Boolean)
      .map((r: any) => ({
        id: r.id,
        questionText: r.questionText,
        questionTextHindi: r.questionTextHindi,
        questionDiagramType: r.questionDiagramType ?? null,
        questionDiagramLabels: r.questionDiagramLabels ?? null,
        questionImageUrl: r.questionImageUrl ?? null,
        options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null, diagramType: o.diagramType ?? null, diagramLabels: o.diagramLabels ?? null, imageUrl: o.imageUrl ?? null })),
        chapter: r.chapter?.name ?? '',
        examName: r.exam?.name ?? '',
        year: r.year,
        shift: r.shift,
        marks: r.marks,
        negativeMarks: r.negativeMarks,
        // explanation is revealed only after submit (answer-key leak fix, same as Daily Test).
      }));
  }

  /** POST /study-plan/test/:id/start — compose the full-pattern paper and begin the timed attempt. */
  async startTest(userId: string, testId: string) {
    const test = await this.prisma.studyPlanTest.findFirst({ where: { id: testId, userId } });
    if (!test) throw new NotFoundException('Test not found');
    if (test.status === 'SUBMITTED') throw new BadRequestException('This test is already submitted.');

    const now = new Date();
    if (test.status === 'SCHEDULED' && now < test.scheduledFor) {
      const msLeft = test.scheduledFor.getTime() - now.getTime();
      const m = MSG.notYet(Math.ceil(msLeft / 3600000));
      throw new ForbiddenException({ message: m.en, code: 'TEST_NOT_OPEN', messages: m, msLeft, scheduledFor: test.scheduledFor });
    }

    const exam = await this.prisma.exam.findUnique({ where: { id: test.examId }, select: { id: true, name: true } });
    if (test.status === 'IN_PROGRESS' && test.attemptId) {
      const att = await this.prisma.testAttempt.findUnique({ where: { id: test.attemptId }, select: { status: true, questionSnapshot: true, expiresAt: true } });
      if (att && att.status === 'IN_PROGRESS') {
        return {
          resume: true,
          testId,
          attemptId: test.attemptId,
          expiresAt: att.expiresAt,
          durationSec: att.expiresAt ? Math.max(1, Math.round((att.expiresAt.getTime() - Date.now()) / 1000)) : 1,
          examName: exam?.name ?? '',
          questions: await this.loadQuestions((att.questionSnapshot as string[]) ?? []),
        };
      }
    }

    const chapterIds = (test.chapterIds as string[]) ?? [];
    if (!chapterIds.length) throw new BadRequestException('No chapters selected for this test');

    // Real exam pattern (sections, question count, duration) for the target exam.
    const pattern = await this.prisma.examPattern.findFirst({ where: { examId: test.examId, isActive: true }, orderBy: { totalQuestions: 'desc' } });
    const sections = ((pattern?.sections as any[]) ?? []).filter(Boolean);
    const subjectRows = await this.prisma.subject.findMany({ select: { id: true, slug: true } });
    const slugToId = new Map(subjectRows.map((s) => [s.slug, s.id]));

    // Pool: published questions of the chosen chapters. Preference order:
    // (this exam & never seen) > (other exam & never seen) > (this exam & seen) > (other & seen).
    const [rows, seenRows] = await Promise.all([
      this.prisma.question.findMany({
        where: {
          ...PUBLISHED_QUESTION_WHERE,
          chapterId: { in: chapterIds },
          OR: [{ questionTextHindi: { not: '' } }, { subject: { slug: 'english' } }],
        },
        select: { id: true, chapterId: true, subjectId: true, examId: true, optionsJson: true },
        take: 6000,
      }),
      this.prisma.attemptAnswer.findMany({ where: { testAttempt: { userId } }, select: { questionId: true }, take: 30000 }),
    ]);
    const seen = new Set(seenRows.map((r) => r.questionId));
    const valid = rows.filter(
      (r: any) =>
        r.chapterId &&
        r.subjectId &&
        Array.isArray(r.optionsJson) &&
        r.optionsJson.length === 4 &&
        r.optionsJson.every((o: any) => o && ((o.text && String(o.text).trim()) || o.diagramType || o.imageUrl)),
    );
    if (!valid.length) throw new BadRequestException('No questions available for the selected chapters yet.');

    const tier = (r: any) => (r.examId === test.examId ? 0 : 1) + (seen.has(r.id) ? 2 : 0);
    const ordered = [...valid].sort((a: any, b: any) => tier(a) - tier(b));
    // subject -> chapter -> ids (tier order kept, shuffled inside each tier)
    const pool = new Map<string, Map<string, string[]>>();
    const tiers = new Map<number, any[]>();
    for (const r of ordered) {
      const t = tier(r);
      if (!tiers.has(t)) tiers.set(t, []);
      tiers.get(t)!.push(r);
    }
    for (const t of [...tiers.keys()].sort((a, b) => a - b)) {
      for (const r of shuffled(tiers.get(t)!)) {
        if (!pool.has(r.subjectId)) pool.set(r.subjectId, new Map());
        const ch = pool.get(r.subjectId)!;
        if (!ch.has(r.chapterId)) ch.set(r.chapterId, []);
        ch.get(r.chapterId)!.push(r.id);
      }
    }

    const totalPool = valid.length;
    const targetN = Math.min(pattern?.totalQuestions || 100, totalPool);

    // Subject weights from the pattern (renormalised over subjects actually chosen).
    const weightBySubject = new Map<string, number>();
    const sectionOrder = new Map<string, number>();
    sections.forEach((sec, idx) => {
      const sid = sec.subjectSlug ? slugToId.get(String(sec.subjectSlug)) : undefined;
      if (!sid) return;
      weightBySubject.set(sid, (weightBySubject.get(sid) ?? 0) + (Number(sec.questions) || 0));
      if (!sectionOrder.has(sid)) sectionOrder.set(sid, idx);
    });
    const known = [...weightBySubject.values()].filter((w) => w > 0);
    const avgWeight = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
    const subjectIds = [...pool.keys()];
    const weights = subjectIds.map((sid) => Math.max(1, weightBySubject.get(sid) ?? avgWeight));
    const wSum = weights.reduce((a, b) => a + b, 0);

    // Largest-remainder quotas.
    const raw = weights.map((w) => (targetN * w) / wSum);
    const quota = raw.map((x) => Math.floor(x));
    let rest = targetN - quota.reduce((a, b) => a + b, 0);
    raw
      .map((x, i) => ({ i, frac: x - Math.floor(x) }))
      .sort((a, b) => b.frac - a.frac)
      .forEach((x) => {
        if (rest > 0) {
          quota[x.i]++;
          rest--;
        }
      });

    // Round-robin across a subject's chapters so EVERY chosen chapter is tested.
    const pickFromSubject = (sid: string, want: number, taken: Set<string>): string[] => {
      const chapters = shuffled([...(pool.get(sid)?.entries() ?? [])]);
      const out: string[] = [];
      const ptr = new Map<string, number>();
      let progressed = true;
      while (out.length < want && progressed) {
        progressed = false;
        for (const [cid, list] of chapters) {
          if (out.length >= want) break;
          let p = ptr.get(cid) ?? 0;
          while (p < list.length && taken.has(list[p])) p++;
          if (p < list.length) {
            out.push(list[p]);
            taken.add(list[p]);
            ptr.set(cid, p + 1);
            progressed = true;
          } else ptr.set(cid, p);
        }
      }
      return out;
    };

    const taken = new Set<string>();
    const perSubject = new Map<string, string[]>();
    subjectIds.forEach((sid, i) => perSubject.set(sid, pickFromSubject(sid, quota[i], taken)));
    // Redistribute any shortfall (a subject with too few questions) to subjects that still have some.
    let shortfall = targetN - [...perSubject.values()].reduce((a, b) => a + b.length, 0);
    let guard = 0;
    while (shortfall > 0 && guard++ < 50) {
      let moved = false;
      for (const sid of subjectIds) {
        if (shortfall <= 0) break;
        const extra = pickFromSubject(sid, 1, taken);
        if (extra.length) {
          perSubject.get(sid)!.push(...extra);
          shortfall--;
          moved = true;
        }
      }
      if (!moved) break;
    }

    // Section order like the real paper; shuffled inside each section.
    const orderedSubjects = [...subjectIds].sort((a, b) => (sectionOrder.get(a) ?? 99) - (sectionOrder.get(b) ?? 99));
    const picked: string[] = [];
    for (const sid of orderedSubjects) picked.push(...shuffled(perSubject.get(sid) ?? []));
    if (!picked.length) throw new BadRequestException('Could not compose the test — not enough questions.');

    const durationMinutes = pattern?.totalQuestions
      ? Math.max(10, Math.round((pattern.durationMinutes * picked.length) / pattern.totalQuestions))
      : Math.max(10, Math.round(picked.length * 0.6));
    const templateId = `plan-test-${test.id}`;
    await this.prisma.testTemplate.upsert({
      where: { id: templateId },
      create: {
        id: templateId,
        title: `Study Plan Test — ${exam?.name ?? 'SSC'}`,
        description: 'Customised test from the chapters you marked complete (full exam pattern).',
        type: 'CUSTOM',
        durationMinutes,
        totalQuestions: picked.length,
        totalMarks: picked.length * 2,
        isPremium: false,
        isActive: true,
        examId: test.examId,
      },
      update: { durationMinutes, totalQuestions: picked.length, totalMarks: picked.length * 2 },
    });

    const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);
    const attempt = await this.prisma.testAttempt.create({
      data: { userId, testTemplateId: templateId, status: 'IN_PROGRESS', startedAt: now, expiresAt, questionSnapshot: picked },
      select: { id: true },
    });
    await this.prisma.studyPlanTest.update({
      where: { id: test.id },
      data: { status: 'IN_PROGRESS', attemptId: attempt.id, startedAt: now },
    });

    return {
      resume: false,
      testId,
      attemptId: attempt.id,
      expiresAt,
      durationSec: durationMinutes * 60,
      examName: exam?.name ?? '',
      questions: await this.loadQuestions(picked),
      shortOfPattern: picked.length < (pattern?.totalQuestions || 100),
    };
  }

  /** GET /study-plan/test/:id/result — per-chapter verdict (weak vs complete) with bilingual message. */
  async testResult(userId: string, testId: string) {
    let test = await this.prisma.studyPlanTest.findFirst({ where: { id: testId, userId } });
    if (!test) throw new NotFoundException('Test not found');
    if (test.status !== 'SUBMITTED' && test.attemptId) {
      const att = await this.prisma.testAttempt.findUnique({ where: { id: test.attemptId }, select: { status: true } });
      if (att?.status === 'SUBMITTED') {
        await applyAttemptToChapters(this.prisma, userId, test.attemptId);
        test = (await this.prisma.studyPlanTest.findFirst({ where: { id: testId, userId } })) ?? test;
      }
    }
    if (test.status !== 'SUBMITTED') throw new BadRequestException('Submit the test first to see the result.');
    const verdicts = ((test.resultJson as any[]) ?? []) as any[];
    const weak = verdicts.filter((v) => v.status === 'WEAK');
    return {
      testId,
      attemptId: test.attemptId,
      scorePct: test.scorePct,
      submittedAt: test.submittedAt,
      chapters: verdicts,
      complete: verdicts.filter((v) => v.status === 'COMPLETE'),
      weak,
      message: weak.length ? MSG.weak(weak.map((w) => w.name)) : MSG.allComplete,
    };
  }

  /** GET /study-plan/attempt/:attemptId/verdict — null unless this attempt was a Study-Plan test. */
  async verdictByAttempt(userId: string, attemptId: string) {
    const t = await this.prisma.studyPlanTest.findFirst({ where: { userId, attemptId }, select: { id: true } });
    if (!t) return null;
    return this.testResult(userId, t.id);
  }

  // ----------------------------------------------------------- 4. weak board
  /** GET /study-plan/weak?examId= — exam-wise / subject-wise accuracy down to sub-topic. */
  async weakBoard(userId: string, examId?: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{ examId: string | null; subjectId: string | null; chapterId: string | null; topicId: string | null; subTopicId: string | null; total: bigint; correct: bigint }>
    >(Prisma.sql`
      SELECT q."examId", q."subjectId", q."chapterId", q."topicId", q."subTopicId",
             COUNT(*) AS total,
             SUM(CASE WHEN aa."isCorrect" THEN 1 ELSE 0 END) AS correct
      FROM "attempt_answers" aa
      JOIN "test_attempts" ta ON ta."id" = aa."testAttemptId"
      JOIN "questions" q ON q."id" = aa."questionId"
      WHERE ta."userId" = ${userId} AND ta."status" = 'SUBMITTED' AND aa."selectedOption" IS NOT NULL
      GROUP BY q."examId", q."subjectId", q."chapterId", q."topicId", q."subTopicId"
    `);

    const examTotals = new Map<string, { total: number; correct: number }>();
    for (const r of rows) {
      if (!r.examId) continue;
      const e = examTotals.get(r.examId) ?? { total: 0, correct: 0 };
      e.total += Number(r.total);
      e.correct += Number(r.correct);
      examTotals.set(r.examId, e);
    }
    const examList = await this.prisma.exam.findMany({ where: { id: { in: [...examTotals.keys()] } }, select: { id: true, name: true } });
    const exams = examList.map((e) => ({ id: e.id, name: e.name, attempted: examTotals.get(e.id)!.total, accuracyPct: Math.round((examTotals.get(e.id)!.correct / Math.max(1, examTotals.get(e.id)!.total)) * 100) }));

    const scoped = examId ? rows.filter((r) => r.examId === examId) : rows;
    type Agg = { total: number; correct: number };
    const add = (m: Map<string, Agg>, key: string | null, r: { total: bigint; correct: bigint }) => {
      if (!key) return;
      const e = m.get(key) ?? { total: 0, correct: 0 };
      e.total += Number(r.total);
      e.correct += Number(r.correct);
      m.set(key, e);
    };
    const chapterAgg = new Map<string, Agg>();
    const topicAgg = new Map<string, Agg>();
    const subAgg = new Map<string, Agg>();
    const chapterSubject = new Map<string, string>();
    const topicChapter = new Map<string, string>();
    const subTopic = new Map<string, string>();
    for (const r of scoped) {
      add(chapterAgg, r.chapterId, r);
      add(topicAgg, r.topicId, r);
      add(subAgg, r.subTopicId, r);
      if (r.chapterId && r.subjectId) chapterSubject.set(r.chapterId, r.subjectId);
      if (r.topicId && r.chapterId) topicChapter.set(r.topicId, r.chapterId);
      if (r.subTopicId && r.topicId) subTopic.set(r.subTopicId, r.topicId);
    }

    const [chapters, topics, subs, subjects, planRows] = await Promise.all([
      this.prisma.chapter.findMany({ where: { id: { in: [...chapterAgg.keys()] } }, select: { id: true, name: true, nameHindi: true } }),
      this.prisma.topic.findMany({ where: { id: { in: [...topicAgg.keys()] } }, select: { id: true, name: true, nameHindi: true } }),
      this.prisma.subTopic.findMany({ where: { id: { in: [...subAgg.keys()] } }, select: { id: true, name: true, nameHindi: true } }),
      this.prisma.subject.findMany({ where: { id: { in: [...new Set(chapterSubject.values())] } }, select: { id: true, name: true, nameHindi: true } }),
      this.prisma.studyPlanChapter.findMany({ where: { userId, status: 'WEAK' }, select: { chapterId: true } }),
    ]);
    const nm = <T extends { id: string }>(arr: T[]) => new Map(arr.map((x) => [x.id, x]));
    const chMap = nm(chapters);
    const tpMap = nm(topics);
    const stMap = nm(subs);
    const sjMap = nm(subjects);
    const flaggedWeak = new Set(planRows.map((p) => p.chapterId));

    const level = (pct: number) => (pct >= CHAPTER_COMPLETE_PCT ? 'STRONG' : pct >= 70 ? 'AVERAGE' : 'WEAK');
    const node = (agg: Agg) => {
      const pct = Math.round((agg.correct / Math.max(1, agg.total)) * 100);
      return { attempted: agg.total, correct: agg.correct, accuracyPct: pct, level: level(pct), belowTarget: pct < CHAPTER_COMPLETE_PCT };
    };

    const subjectNodes = new Map<string, any>();
    for (const [chapterId, agg] of chapterAgg) {
      const sid = chapterSubject.get(chapterId);
      if (!sid) continue;
      if (!subjectNodes.has(sid)) {
        const s = sjMap.get(sid);
        subjectNodes.set(sid, { id: sid, name: s?.name ?? '', nameHindi: s?.nameHindi ?? null, total: 0, correct: 0, chapters: [] });
      }
      const sn = subjectNodes.get(sid);
      sn.total += agg.total;
      sn.correct += agg.correct;
      const ch = chMap.get(chapterId);
      const topicNodes = [...topicAgg.entries()]
        .filter(([tid]) => topicChapter.get(tid) === chapterId)
        .map(([tid, tagg]) => {
          const t = tpMap.get(tid);
          const subNodes = [...subAgg.entries()]
            .filter(([sub]) => subTopic.get(sub) === tid)
            .map(([sub, sagg]) => ({ id: sub, name: stMap.get(sub)?.name ?? '', nameHindi: stMap.get(sub)?.nameHindi ?? null, ...node(sagg), practice: { chapterId, topicId: tid, subTopicId: sub } }))
            .sort((a, b) => a.accuracyPct - b.accuracyPct);
          return { id: tid, name: t?.name ?? '', nameHindi: t?.nameHindi ?? null, ...node(tagg), practice: { chapterId, topicId: tid }, subTopics: subNodes };
        })
        .sort((a, b) => a.accuracyPct - b.accuracyPct);
      sn.chapters.push({ id: chapterId, name: ch?.name ?? '', nameHindi: ch?.nameHindi ?? null, ...node(agg), flaggedWeak: flaggedWeak.has(chapterId), practice: { chapterId }, topics: topicNodes });
    }
    const subjectsOut = [...subjectNodes.values()].map((s) => {
      s.chapters.sort((a: any, b: any) => a.accuracyPct - b.accuracyPct);
      return { ...s, accuracyPct: Math.round((s.correct / Math.max(1, s.total)) * 100), attempted: s.total };
    });
    const weakChapters = subjectsOut.flatMap((s) => s.chapters.filter((c: any) => c.belowTarget || c.flaggedWeak).map((c: any) => ({ ...c, subjectId: s.id, subject: s.name })));
    weakChapters.sort((a, b) => a.accuracyPct - b.accuracyPct);

    return {
      exams,
      examId: examId ?? null,
      targetPct: CHAPTER_COMPLETE_PCT,
      subjects: subjectsOut,
      weakChapters: weakChapters.map((c) => ({ id: c.id, name: c.name, nameHindi: c.nameHindi, subjectId: c.subjectId, subject: c.subject, accuracyPct: c.accuracyPct, attempted: c.attempted, practice: c.practice })),
    };
  }

  // ------------------------------------------------------------ 5. today's plan
  /** GET /study-plan/today — the daily target derived from the exam date and progress. */
  async todayPlan(userId: string) {
    const plan = await this.latestPlan(userId);
    if (!plan) throw new BadRequestException({ message: MSG.noPlan.en, code: 'NO_PLAN', messages: MSG.noPlan });

    const board = await this.board(userId, plan.examId);
    const daysLeft = Math.max(1, Math.ceil((plan.targetDate.getTime() - istMidnightUtc(new Date()).getTime()) / DAY_MS));

    const all = board.subjects.flatMap((s) => s.chapters.filter((c: any) => c.testable).map((c: any) => ({ ...c, subjectId: s.id, subject: s.name })));
    const notDone = all.filter((c: any) => c.status !== 'COMPLETE');
    // The last ~20% of the runway (min 3 days when there is room) is kept for revision + full mocks.
    const reserve = daysLeft > 10 ? Math.max(3, Math.round(daysLeft * 0.2)) : 0;
    const studyDays = Math.max(1, daysLeft - reserve);
    const chaptersPerDay = notDone.length ? Math.max(1, Math.ceil(notDone.length / studyDays)) : 0;

    // Weak chapters first (fix what is broken), then the rest interleaved across subjects.
    const weak = notDone.filter((c: any) => c.status === 'WEAK');
    const rest = notDone.filter((c: any) => c.status !== 'WEAK');
    const bySubj = new Map<string, any[]>();
    for (const c of rest) {
      if (!bySubj.has(c.subjectId)) bySubj.set(c.subjectId, []);
      bySubj.get(c.subjectId)!.push(c);
    }
    const interleaved: any[] = [];
    const lists = [...bySubj.values()];
    for (let i = 0; interleaved.length < rest.length; i++) {
      let any = false;
      for (const l of lists) if (i < l.length) { interleaved.push(l[i]); any = true; }
      if (!any) break;
    }
    const todayChapters = [...weak, ...interleaved].slice(0, chaptersPerDay);

    const practiceTarget = Math.max(25, plan.dailyTarget || 25);
    const pyqPerWeek = daysLeft > 45 ? 1 : daysLeft > 21 ? 2 : daysLeft > 7 ? 3 : 7;
    const total = board.summary.total || 1;

    return {
      exam: board.exam,
      targetDate: plan.targetDate,
      daysLeft,
      revisionReserveDays: reserve,
      progress: { ...board.summary, pct: Math.round((board.summary.complete / total) * 100) },
      today: {
        chaptersToStudy: todayChapters.map((c: any) => ({ id: c.id, name: c.name, nameHindi: c.nameHindi, subject: c.subject, status: c.status })),
        chaptersPerDay,
        practiceQuestions: practiceTarget,
        practiceSets: Math.ceil(practiceTarget / 25),
        pyqTestsPerWeek: pyqPerWeek,
        pyqTestsRecommendedTotal: Math.ceil((daysLeft / 7) * pyqPerWeek),
      },
      message: {
        en: `${daysLeft} day(s) left. Today: study ${chaptersPerDay} chapter(s), practise ${practiceTarget} questions, and take ${pyqPerWeek} PYQ mock(s) this week.`,
        hi: `${daysLeft} दिन बाकी हैं। आज: ${chaptersPerDay} चैप्टर पढ़ें, ${practiceTarget} प्रश्न प्रैक्टिस करें, और इस हफ़्ते ${pyqPerWeek} PYQ मॉक दें।`,
      },
    };
  }
}
