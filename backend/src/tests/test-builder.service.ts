/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PRACTICE_QUESTION_WHERE, PYQ_QUESTION_WHERE } from '../common/question-visibility';
import { HINDI_EXEMPT_SUBJECT_FILTER, subjectIdsFor } from '../common/slug-core';
import { dropDuplicateQuestions } from '../common/question-fingerprint';
import { resolveMarking, totalMarksFor } from '../common/marking';
import { loadMarkingScheme } from './marking-scheme';
import { TestsService } from './tests.service';
import { readPaperSnapshot } from './attempt-paper';
import { freeCustomTestsPerDay, freeSmartMocks, planPriceInr } from '../common/free-limits';
import { Candidate, allocateWithCaps, chosenMinutes, pickQuestions, shuffled } from './test-blueprint';

const MAX_TEST_QUESTIONS = 100;
const MAX_ITEMS = 40;
const BANK_CAP = 3000; // candidates read per topic

type Item = { chapterId?: string; topicId?: string; count?: number };

/** Four non-empty options (or a figure) - the same test the other paper composers use. */
const validOptions = (r: any) =>
  Array.isArray(r.optionsJson) && r.optionsJson.length === 4 && r.optionsJson.every((o: any) => o && ((o.text && String(o.text).trim().length > 0) || o.diagramType || o.imageUrl));

/**
 * S48 — tests built from the PRACTICE bank (the half kept for tests first):
 *   - custom test : the student picks chapters / topics and how many questions of each, and the minutes;
 *   - smart mock  : one exam; the questions are spread over the topics the exam really asked, in proportion to its previous-year papers.
 * Only topics that have questions are offered; for an exam only topics that appear in ITS previous-year papers are offered / used.
 */
@Injectable()
export class TestBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tests: TestsService,
  ) {}

  private bilingualPractice() {
    return { ...PRACTICE_QUESTION_WHERE, OR: [{ questionTextHindi: { not: '' } }, HINDI_EXEMPT_SUBJECT_FILTER] };
  }

  // --------------------------------------------------------------------------------------------- catalog
  /** Tree of subject -> chapter -> topic with the number of questions a test can use; nodes without questions are not listed. */
  async catalog(examId?: string) {
    const [subjects, practice, pyq] = await Promise.all([
      this.prisma.subject.findMany({
        select: {
          id: true, name: true, nameHindi: true,
          chapters: { select: { id: true, name: true, nameHindi: true, topics: { select: { id: true, name: true, nameHindi: true }, orderBy: { name: 'asc' } } }, orderBy: { name: 'asc' } },
        },
        orderBy: { name: 'asc' },
      }),
      (this.prisma.question as any).groupBy({ by: ['chapterId', 'topicId'], where: this.bilingualPractice() as any, _count: { _all: true } }),
      examId ? (this.prisma.question as any).groupBy({ by: ['chapterId', 'topicId'], where: { ...PYQ_QUESTION_WHERE, examId }, _count: { _all: true } }) : Promise.resolve([] as any[]),
    ]);
    const examHasPyq = pyq.length > 0;
    const topicP = new Map<string, number>();
    const chapterP = new Map<string, number>();
    for (const g of practice as any[]) {
      const n = g._count._all;
      if (g.topicId) topicP.set(g.topicId, (topicP.get(g.topicId) ?? 0) + n);
      if (g.chapterId) chapterP.set(g.chapterId, (chapterP.get(g.chapterId) ?? 0) + n);
    }
    const topicY = new Map<string, number>();
    const chapterY = new Map<string, number>();
    for (const g of pyq as any[]) {
      const n = g._count._all;
      if (g.topicId) topicY.set(g.topicId, (topicY.get(g.topicId) ?? 0) + n);
      if (g.chapterId) chapterY.set(g.chapterId, (chapterY.get(g.chapterId) ?? 0) + n);
    }
    // for an exam that has previous-year papers, a topic / chapter the exam never asked is not offered
    const allowed = (y: number) => !examId || !examHasPyq || y > 0;
    const tree = subjects
      .map((s) => {
        const chapters = s.chapters
          .map((c) => {
            const topics = c.topics
              .map((t) => ({ id: t.id, name: t.name, nameHindi: t.nameHindi, available: topicP.get(t.id) ?? 0, pyq: topicY.get(t.id) ?? 0 }))
              .filter((t) => t.available > 0 && allowed(t.pyq));
            const available = chapterP.get(c.id) ?? 0;
            const pyqN = chapterY.get(c.id) ?? 0;
            return { id: c.id, name: c.name, nameHindi: c.nameHindi, available, pyq: pyqN, topics, ok: available > 0 && allowed(pyqN) };
          })
          .filter((c) => c.ok)
          .map(({ ok: _ok, ...c }) => c);
        return { id: s.id, name: s.name, nameHindi: s.nameHindi, available: chapters.reduce((a, c) => a + c.available, 0), chapters };
      })
      .filter((s) => s.chapters.length > 0);
    return { examId: examId ?? null, pyqBased: !!examId && examHasPyq, subjects: tree };
  }

  // --------------------------------------------------------------------------------------------- free limits
  /** Start of today in IST, as a UTC instant. */
  private istDayStart(now = new Date()): Date {
    const ist = new Date(now.getTime() + 5.5 * 3_600_000);
    return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3_600_000);
  }

  /** Staff and students with a running plan are never limited. */
  private async isUnlimited(userId: string): Promise<boolean> {
    const u: any = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, subscriptions: { where: { status: 'ACTIVE' }, select: { endsAt: true }, take: 1 } },
    });
    if (!u) return false;
    if (u.role === 'ADMIN' || u.role === 'MODERATOR') return true;
    const sub = u.subscriptions?.[0];
    return !!sub && new Date(sub.endsAt) > new Date();
  }

  /** What this student may still start for free: smart mocks in total, custom tests today. Premium = unlimited. */
  async quota(userId: string) {
    const unlimited = await this.isUnlimited(userId);
    const smartLimit = freeSmartMocks();
    const customLimit = freeCustomTestsPerDay();
    const [smartUsed, customUsed] = await Promise.all([
      this.prisma.testAttempt.count({ where: { userId, testTemplate: { description: { startsWith: 'Smart mock' } } } }),
      this.prisma.testAttempt.count({ where: { userId, startedAt: { gte: this.istDayStart() }, testTemplate: { description: { startsWith: 'Custom test' } } } }),
    ]);
    return {
      premium: unlimited,
      smart: { limit: unlimited ? null : smartLimit, used: smartUsed, left: unlimited ? null : Math.max(0, smartLimit - smartUsed) },
      custom: { limit: unlimited ? null : customLimit, usedToday: customUsed, leftToday: unlimited ? null : Math.max(0, customLimit - customUsed) },
      priceInr: planPriceInr(),
    };
  }

  // --------------------------------------------------------------------------------------------- pool
  private async candidatesFor(userId: string, where: any): Promise<(Candidate & { row: any })[]> {
    const rows = await this.prisma.question.findMany({
      where,
      select: { id: true, questionText: true, optionsJson: true, questionImageUrl: true, questionDiagramType: true, questionDiagramLabels: true, testReserved: true },
      orderBy: { questionNo: 'asc' },
      take: BANK_CAP,
    });
    const usable = dropDuplicateQuestions(rows.filter(validOptions) as any[]) as any[];
    if (usable.length === 0) return [];
    const seenRows = await this.prisma.attemptAnswer.findMany({
      where: { questionId: { in: usable.map((r) => r.id) }, testAttempt: { userId } },
      select: { questionId: true },
      distinct: ['questionId'],
    });
    const seen = new Set(seenRows.map((r: { questionId: string }) => r.questionId));
    return usable.map((r) => ({ id: r.id, reserved: !!r.testReserved, seen: seen.has(r.id), row: r }));
  }

  // --------------------------------------------------------------------------------------------- custom
  private async pickCustom(userId: string, examId: string, items: Item[]) {
    const clean = items
      .map((i) => ({ chapterId: i.chapterId ? String(i.chapterId) : '', topicId: i.topicId ? String(i.topicId) : '', count: Math.floor(Number(i.count)) }))
      .filter((i) => (i.chapterId || i.topicId) && Number.isFinite(i.count) && i.count > 0);
    if (clean.length === 0) throw new BadRequestException('Choose at least one chapter or topic and how many questions you want from it.');
    if (clean.length > MAX_ITEMS) throw new BadRequestException(`Choose at most ${MAX_ITEMS} chapters / topics.`);
    const total = clean.reduce((a, i) => a + i.count, 0);
    if (total > MAX_TEST_QUESTIONS) throw new BadRequestException(`A test can have at most ${MAX_TEST_QUESTIONS} questions (you asked for ${total}).`);

    // the exam's own previous-year topics: a whole-chapter pick uses only topics the exam asked (when the exam has previous-year papers at all)
    const pyqNodes = (await (this.prisma.question as any).groupBy({ by: ['chapterId', 'topicId'], where: { ...PYQ_QUESTION_WHERE, examId }, _count: { _all: true } })) as any[];
    const examHasPyq = pyqNodes.length > 0;
    const askedTopics = new Map<string, Set<string>>();
    for (const g of pyqNodes) if (g.chapterId && g.topicId) (askedTopics.get(g.chapterId) ?? askedTopics.set(g.chapterId, new Set()).get(g.chapterId)!).add(g.topicId);

    const used = new Set<string>();
    const picked: string[] = [];
    const shortfalls: { chapterId?: string; topicId?: string; asked: number; got: number }[] = [];
    for (const it of clean) {
      const where: any = { ...this.bilingualPractice() };
      if (it.topicId) where.topicId = it.topicId;
      else {
        where.chapterId = it.chapterId;
        const asked = askedTopics.get(it.chapterId);
        if (examHasPyq && asked && asked.size > 0) where.AND = [{ OR: [{ topicId: null }, { topicId: { in: Array.from(asked) } }] }];
      }
      const cands = await this.candidatesFor(userId, where);
      const ids = pickQuestions(cands, it.count, used);
      ids.forEach((id) => { used.add(id); picked.push(id); });
      if (ids.length < it.count) shortfalls.push({ chapterId: it.chapterId || undefined, topicId: it.topicId || undefined, asked: it.count, got: ids.length });
    }
    return { ids: picked, shortfalls };
  }

  // --------------------------------------------------------------------------------------------- smart mock
  private async pickSmartMock(userId: string, examId: string, tier?: string) {
    const scheme = await loadMarkingScheme(this.prisma as any, { examId, examTier: tier ?? null }, []);
    const subjects = await this.prisma.subject.findMany({ select: { id: true, slug: true, name: true } });
    const sections = scheme?.sections?.length
      ? scheme.sections.map((s) => ({ name: s.name, subjectSlug: s.subjectSlug, questions: s.questions }))
      : [
          { name: 'Reasoning', subjectSlug: 'reasoning', questions: 25 },
          { name: 'General Awareness', subjectSlug: 'general_awareness', questions: 25 },
          { name: 'Quantitative Aptitude', subjectSlug: 'quantitative_aptitude', questions: 25 },
          { name: 'English', subjectSlug: 'english', questions: 25 },
        ];
    const examPyqTotal = await this.prisma.question.count({ where: { ...PYQ_QUESTION_WHERE, examId } });
    const used = new Set<string>();
    const ids: string[] = [];
    const summary: { name: string; asked: number; got: number; note?: string }[] = [];

    for (const sec of sections) {
      const subjectIds = subjectIdsFor(subjects as any, sec.subjectSlug);
      if (subjectIds.length === 0) { summary.push({ name: sec.name, asked: sec.questions, got: 0, note: 'subject not found' }); continue; }
      const pyq = (await (this.prisma.question as any).groupBy({ by: ['chapterId', 'topicId'], where: { ...PYQ_QUESTION_WHERE, examId, subjectId: { in: subjectIds } }, _count: { _all: true } })) as any[];
      // an exam with previous-year papers but none in this subject never asked it: the section is skipped, not invented
      if (examPyqTotal > 0 && pyq.length === 0) { summary.push({ name: sec.name, asked: sec.questions, got: 0, note: 'this exam has no previous-year question in this subject' }); continue; }
      const practice = (await (this.prisma.question as any).groupBy({ by: ['chapterId', 'topicId'], where: { ...this.bilingualPractice(), subjectId: { in: subjectIds } } as any, _count: { _all: true } })) as any[];
      const topicAvail = new Map<string, number>();
      const chapterAvail = new Map<string, number>();
      for (const g of practice) {
        if (g.topicId) topicAvail.set(g.topicId, (topicAvail.get(g.topicId) ?? 0) + g._count._all);
        if (g.chapterId) chapterAvail.set(g.chapterId, (chapterAvail.get(g.chapterId) ?? 0) + g._count._all);
      }
      // weight = how many times the exam asked it; a new exam with no previous-year paper at all falls back to equal weights over the topics that exist
      const nodes: { key: string; weight: number; available: number; chapterId: string | null; topicId: string | null }[] = [];
      if (examPyqTotal > 0) {
        for (const g of pyq) {
          const key = g.topicId ? `t:${g.topicId}` : `c:${g.chapterId}`;
          const available = g.topicId ? topicAvail.get(g.topicId) ?? 0 : chapterAvail.get(g.chapterId) ?? 0;
          const hit = nodes.find((n) => n.key === key);
          if (hit) hit.weight += g._count._all;
          else nodes.push({ key, weight: g._count._all, available, chapterId: g.chapterId ?? null, topicId: g.topicId ?? null });
        }
      } else {
        for (const g of practice) {
          const key = g.topicId ? `t:${g.topicId}` : `c:${g.chapterId}`;
          if (!nodes.find((n) => n.key === key)) nodes.push({ key, weight: 1, available: g._count._all, chapterId: g.chapterId ?? null, topicId: g.topicId ?? null });
        }
      }
      const { alloc } = allocateWithCaps(sec.questions, nodes, true);
      const secIds: string[] = [];
      for (const n of nodes) {
        const want = alloc[n.key] ?? 0;
        if (want <= 0) continue;
        const where: any = { ...this.bilingualPractice(), subjectId: { in: subjectIds } };
        if (n.topicId) where.topicId = n.topicId; else where.chapterId = n.chapterId;
        const cands = await this.candidatesFor(userId, where);
        pickQuestions(cands, want, used).forEach((id) => { used.add(id); secIds.push(id); });
      }
      // a node that held fewer usable questions than counted (invalid rows, duplicates) leaves a gap: fill it from the other asked topics of the subject
      if (secIds.length < sec.questions) {
        const rest = nodes.filter((n) => n.weight > 0);
        for (const n of shuffled(rest)) {
          if (secIds.length >= sec.questions) break;
          const where: any = { ...this.bilingualPractice(), subjectId: { in: subjectIds } };
          if (n.topicId) where.topicId = n.topicId; else where.chapterId = n.chapterId;
          const cands = await this.candidatesFor(userId, where);
          pickQuestions(cands, sec.questions - secIds.length, used).forEach((id) => { used.add(id); secIds.push(id); });
        }
      }
      secIds.forEach((id) => ids.push(id));
      summary.push({ name: sec.name, asked: sec.questions, got: secIds.length });
    }
    return { ids, summary, patternBased: !!scheme, minutes: await this.patternMinutes(scheme?.patternId) };
  }

  private async patternMinutes(patternId?: string | null): Promise<number | null> {
    if (!patternId) return null;
    const p = await this.prisma.examPattern.findUnique({ where: { id: patternId }, select: { durationMinutes: true } });
    return p?.durationMinutes ?? null;
  }

  // --------------------------------------------------------------------------------------------- start (shared)
  async start(
    userId: string,
    body: { mode?: string; examId?: string; items?: Item[]; durationMinutes?: number | string; tier?: string },
  ) {
    const mode = body?.mode === 'smart' ? 'smart' : 'custom';
    const examId = String(body?.examId ?? '').trim();
    if (!examId) throw new BadRequestException('Choose your exam first.');
    const exam = await this.prisma.exam.findFirst({ where: { id: examId, isActive: true }, select: { id: true, name: true } });
    if (!exam) throw new BadRequestException('This exam is not available.');

    // free limits (checked before any question is picked, so a refused start costs nothing)
    const q = await this.quota(userId);
    if (!q.premium) {
      const out = mode === 'smart' ? (q.smart.left ?? 0) <= 0 : (q.custom.leftToday ?? 0) <= 0;
      if (out) {
        const price = q.priceInr;
        throw new BadRequestException({
          statusCode: 400,
          code: 'PREMIUM_REQUIRED',
          message: mode === 'smart' ? `You have used your ${q.smart.limit} free smart mocks. Get the plan (from ₹${price}) for unlimited.` : `You have used today's ${q.custom.limit} free custom tests. Come back tomorrow, or get the plan (from ₹${price}) for unlimited.`,
          messages: {
            en: mode === 'smart' ? `You have used your ${q.smart.limit} free smart mocks. Get the plan (from ₹${price}) for unlimited.` : `You have used today's ${q.custom.limit} free custom tests. Come back tomorrow, or get the plan (from ₹${price}) for unlimited.`,
            hi: mode === 'smart' ? `आपके ${q.smart.limit} फ्री स्मार्ट मॉक पूरे हो गए। अनलिमिटेड के लिए प्लान लें (₹${price} से)।` : `आज के ${q.custom.limit} फ्री कस्टम टेस्ट पूरे हो गए। कल फिर आइए, या अनलिमिटेड के लिए प्लान लें (₹${price} से)।`,
          },
        });
      }
    }

    let ids: string[] = [];
    let summary: any = null;
    let shortfalls: any[] = [];
    let defaultMin: number | null = null;
    if (mode === 'custom') {
      const r = await this.pickCustom(userId, examId, Array.isArray(body.items) ? body.items : []);
      ids = r.ids;
      shortfalls = r.shortfalls;
    } else {
      const r = await this.pickSmartMock(userId, examId, body.tier ? String(body.tier) : undefined);
      ids = r.ids;
      summary = r.summary;
      defaultMin = r.minutes;
    }
    if (ids.length === 0) {
      throw new BadRequestException('There are not enough questions yet for this choice. Try other topics, or come back after more questions are added.');
    }

    const rows = await this.prisma.question.findMany({
      where: { id: { in: ids } },
      include: { exam: { select: { name: true } }, subject: { select: { name: true, slug: true } }, chapter: { select: { name: true, nameHindi: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);

    const scheme = await loadMarkingScheme(this.prisma as any, { examId, examTier: body.tier ? String(body.tier) : null }, ordered as any[]);
    const ruleOf = (r: any) => resolveMarking({ scheme, subjectSlug: r.subject?.slug, question: r });
    const totalMarks = totalMarksFor(scheme, ordered.map((r: any) => ({ subjectSlug: r.subject?.slug, marks: r.marks })));
    // the student's own minutes win; a smart mock otherwise gets the real exam's time scaled to the number of questions it holds
    const scaled = defaultMin && summary ? Math.max(5, Math.round((defaultMin * ordered.length) / Math.max(1, summary.reduce((a: number, s: any) => a + s.asked, 0)))) : null;
    const durationMinutes = body.durationMinutes != null && String(body.durationMinutes) !== '' ? chosenMinutes(body.durationMinutes, ordered.length) : scaled ?? chosenMinutes(null, ordered.length);

    const title = mode === 'smart' ? `${exam.name} — Smart Mock` : `${exam.name} — Custom Test`;
    const template = await this.prisma.testTemplate.create({
      data: {
        title,
        type: 'CUSTOM',
        durationMinutes,
        totalQuestions: ordered.length,
        totalMarks,
        isPremium: false,
        description: mode === 'smart' ? `Smart mock - questions follow the topics ${exam.name} really asked` : `Custom test - ${exam.name}`,
        examId,
      },
    });
    const attempt = await this.tests.startAttempt(userId, template.id, { questionIds: ordered.map((r) => r.id) });

    return {
      attemptId: (attempt as any).id,
      templateId: template.id,
      title,
      durationMinutes,
      totalMarks,
      resumed: (attempt as any).resumed,
      summary,
      shortfalls,
      questions: ordered.map((r: any) => this.shape(r, ruleOf(r))),
    };
  }

  // --------------------------------------------------------------------------------------------- unfinished tests
  /** Tests this student started and has not finished while the clock still runs. Newest first, at most 5. */
  async activeAttempts(userId: string) {
    const rows = await this.prisma.testAttempt.findMany({
      where: { userId, status: 'IN_PROGRESS', expiresAt: { gt: new Date() } },
      orderBy: { startedAt: 'desc' },
      take: 5,
      select: {
        id: true, startedAt: true, expiresAt: true, questionSnapshot: true,
        testTemplate: { select: { id: true, title: true, type: true, totalQuestions: true } },
        _count: { select: { answers: true } },
      },
    });
    const items = rows
      .map((a: any) => {
        const t = a.testTemplate;
        if (!t) return null;
        const adhoc = t.type === 'CUSTOM' || t.type === 'YEAR_WISE';
        // ad-hoc tests are reopened by attempt id; ready-made mocks by their template (the server resumes the same attempt there)
        const resumeUrl = adhoc
          ? readPaperSnapshot(a.questionSnapshot) ? `/test?resume=${a.id}` : null
          : ['SHIFT_WISE', 'FULL_MOCK', 'MINI_MOCK', 'PREVIOUS_YEAR'].includes(t.type) ? `/test?template=${encodeURIComponent(t.id)}` : null;
        if (!resumeUrl) return null;
        return {
          attemptId: a.id,
          title: t.title,
          totalQuestions: t.totalQuestions,
          answered: a._count?.answers ?? 0,
          startedAt: a.startedAt,
          expiresAt: a.expiresAt,
          secondsLeft: Math.max(0, Math.floor((new Date(a.expiresAt).getTime() - Date.now()) / 1000)),
          resumeUrl,
        };
      })
      .filter(Boolean);
    return { items, serverNow: Date.now() };
  }

  /** Same shape as start(): the attempt's own questions (from its stored list), the saved answers and the server clock. No answer key. */
  async resumeAttempt(userId: string, attemptId: string) {
    const attempt: any = await this.prisma.testAttempt.findFirst({
      where: { id: attemptId, userId, status: 'IN_PROGRESS', expiresAt: { gt: new Date() } },
      select: {
        id: true, startedAt: true, expiresAt: true, questionSnapshot: true, tabSwitches: true,
        testTemplate: { select: { id: true, title: true, examId: true, examTier: true, tierPaper: true, totalMarks: true, durationMinutes: true } },
        answers: { select: { questionId: true, selectedOption: true } },
      },
    });
    if (!attempt) throw new BadRequestException('This test is finished or its time is over.');
    const ids = readPaperSnapshot(attempt.questionSnapshot);
    if (!ids) throw new BadRequestException('This test cannot be reopened here.');
    const rows = await this.prisma.question.findMany({
      where: { id: { in: ids } },
      include: { exam: { select: { name: true } }, subject: { select: { name: true, slug: true } }, chapter: { select: { name: true, nameHindi: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
    const scheme = await loadMarkingScheme(this.prisma as any, { examId: attempt.testTemplate?.examId ?? null, examTier: attempt.testTemplate?.examTier ?? null, tierPaper: attempt.testTemplate?.tierPaper ?? null }, ordered as any[]);
    const ruleOf = (r: any) => resolveMarking({ scheme, subjectSlug: r.subject?.slug, question: r });
    return {
      attemptId: attempt.id,
      templateId: attempt.testTemplate?.id,
      title: attempt.testTemplate?.title,
      startedAt: attempt.startedAt,
      expiresAt: attempt.expiresAt,
      serverNow: Date.now(),
      tabSwitches: attempt.tabSwitches ?? 0,
      durationMinutes: attempt.testTemplate?.durationMinutes,
      totalMarks: attempt.testTemplate?.totalMarks,
      answers: attempt.answers,
      questions: ordered.map((r: any) => this.shape(r, ruleOf(r))),
    };
  }

  private shape(r: any, rule: { marks: number; negative: number }) {
    return {
      id: r.id,
      questionText: r.questionText,
      questionNo: r.questionNo,
      paperQuestionNo: null,
      questionTextHindi: r.questionTextHindi,
      questionDiagramType: r.questionDiagramType ?? null,
      questionDiagramLabels: r.questionDiagramLabels ?? null,
      questionImageUrl: r.questionImageUrl ?? null,
      options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null, diagramType: o.diagramType ?? null, diagramLabels: o.diagramLabels ?? null, imageUrl: o.imageUrl ?? null })),
      // correctAnswer / explanation are deliberately NOT sent - revealed only after submit, like every other paper
      examName: r.exam?.name,
      subject: r.subject?.name,
      subjectId: r.subjectId,
      chapter: r.chapter?.name,
      year: r.year ?? null,
      shift: r.shift ?? null,
      marks: rule.marks,
      negativeMarks: rule.negative,
    };
  }
}
