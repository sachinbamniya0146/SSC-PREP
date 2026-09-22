/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLISHED_QUESTION_WHERE, PRACTICE_QUESTION_WHERE } from '../common/question-visibility';

export interface PracticeQuestion {
  id: string;
  questionText: string;
  questionTextHindi?: string | null;
  options: { key: string; text: string; textHi?: string | null }[];
  chapter: string;
  examName?: string | null;
  year?: number | null;
  shift?: string | null;
  marks?: number;
  negativeMarks?: number;
  correctAnswer?: string | null;
  explanation?: string | null;
  explanationHindi?: string | null;
  subjectId?: string;
  topic?: string | null;
  subTopic?: string | null;
  _weakMeta?: { chapterId: string; chapterName: string; wasWrong: boolean; wasSkipped: boolean };
}

export interface PracticeSet {
  id: string;
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
  subTopicId?: string;
  examId?: string;
  setNumber: number;
  questions: PracticeQuestion[];
  currentIndex: number;
  answers: Record<string, string>;
  startedAt: Date;
  completedAt?: Date;
  score?: number;
  isCompleted: boolean;
  mode: string;
  subjectName?: string;
  chapterName?: string;
  examName?: string;
}

export interface UserProgressSummary {
  subjectId: string;
  subjectName: string;
  chapterId?: string;
  chapterName?: string;
  examId?: string;
  examName?: string;
  setsCompleted: number;
  totalQuestions: number;
  correctAnswers: number;
  wrongAnswers: number;
  skippedAnswers: number;
  accuracyPercent: number;
  lastPracticedAt: Date;
}

@Injectable()
export class QuestionBankPracticeService {
  private readonly QUESTIONS_PER_SET = 25;
  private readonly FREE_SETS_LIMIT = 3;

  constructor(private prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // scope resolution (NEW — Sep 21 2026)
  //
  // A practice set can now be scoped to a subject, a chapter, a TOPIC or a
  // SUB-TOPIC. The client only ever has to send the deepest id it knows —
  // the parents are derived here from the database so the four ids can never
  // disagree with each other (a topic that doesn't belong to the chapter the
  // client claimed, etc).
  // ---------------------------------------------------------------------------
  private async resolveScope(input: {
    subjectId?: string;
    chapterId?: string;
    topicId?: string;
    subTopicId?: string;
  }): Promise<{ subjectId?: string; chapterId?: string; topicId?: string; subTopicId?: string }> {
    const clean = (v?: string) => (v && String(v).trim() ? String(v).trim() : undefined);
    const subTopicId = clean(input.subTopicId);
    const topicId = clean(input.topicId);
    const chapterId = clean(input.chapterId);
    const subjectId = clean(input.subjectId);

    if (subTopicId) {
      const sub = await this.prisma.subTopic.findUnique({
        where: { id: subTopicId },
        select: { id: true, topicId: true, topic: { select: { chapterId: true, chapter: { select: { subjectId: true } } } } },
      });
      if (!sub) throw new NotFoundException('Sub-topic not found');
      return { subjectId: sub.topic.chapter.subjectId, chapterId: sub.topic.chapterId, topicId: sub.topicId, subTopicId: sub.id };
    }
    if (topicId) {
      const topic = await this.prisma.topic.findUnique({
        where: { id: topicId },
        select: { id: true, chapterId: true, chapter: { select: { subjectId: true } } },
      });
      if (!topic) throw new NotFoundException('Topic not found');
      return { subjectId: topic.chapter.subjectId, chapterId: topic.chapterId, topicId: topic.id };
    }
    if (chapterId) {
      const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId }, select: { id: true, subjectId: true } });
      if (!chapter) throw new NotFoundException('Chapter not found');
      return { subjectId: chapter.subjectId, chapterId: chapter.id };
    }
    return { subjectId };
  }

  // Get or create a practice set for a user
  //
  // REWRITTEN (Sep 21 2026) — root causes fixed here:
  //  1. Students could not see admin-uploaded practice questions: the pool
  //     query demanded `questionTextHindi != ''` on top of isApproved, so an
  //     approved English question with no Hindi text (every Noun/Spotting-Errors
  //     sheet) never matched. The single gate is now isApproved (the upload /
  //     approve step already enforces the bilingual rule — see
  //     isHindiExemptSubjectSlug()).
  //  2. PYQ questions leaked into Practice: the pool now only takes year-less
  //     (practice) questions (PRACTICE_QUESTION_WHERE).
  //  3. The "existing incomplete set" lookup passed `chapterId: undefined` to
  //     Prisma, which means "no filter" — so clicking a NEW topic returned an
  //     OLD in-progress set of some other scope. Scope is now matched exactly
  //     (null means null), including topic + sub-topic.
  //  4. setNumber was always 1 (client default), so the free-set gate never
  //     advanced. The server now numbers sets itself.
  //  5. Topic and sub-topic scoped practice (the whole syllabus tree).
  async getOrCreateSet(
    userId: string,
    options: {
      subjectId?: string;
      chapterId?: string;
      topicId?: string;
      subTopicId?: string;
      examId?: string;
      setNumber?: number; // accepted for backwards compatibility, ignored — the server numbers sets
      mode?: 'practice' | 'test';
      resume?: boolean; // accepted for backwards compatibility — resuming an in-progress set is always the default
      size?: number; // student-chosen set size (server clamps to 10-50)
    }
  ): Promise<PracticeSet> {
    const mode = options.mode ?? 'practice';
    const examId = options.examId && String(options.examId).trim() ? String(options.examId).trim() : undefined;
    const size = Math.min(50, Math.max(10, Number(options.size) || this.QUESTIONS_PER_SET));

    const scope = await this.resolveScope({
      subjectId: options.subjectId,
      chapterId: options.chapterId,
      topicId: options.topicId,
      subTopicId: options.subTopicId,
    });
    const { subjectId, chapterId, topicId, subTopicId } = scope;

    // Exact-scope filter: null really means null (never "ignore this field").
    const scopeWhere = {
      userId,
      subjectId: subjectId ?? null,
      chapterId: chapterId ?? null,
      topicId: topicId ?? null,
      subTopicId: subTopicId ?? null,
      examId: examId ?? null,
    };

    // 1) Resume an unfinished set of the SAME scope (this is the normal
    //    "continue where I left off" flow).
    const existingIncomplete = await this.prisma.questionBankSet.findFirst({
      where: { ...scopeWhere, isCompleted: false },
      orderBy: { startedAt: 'desc' },
    });
    if (existingIncomplete) {
      const ordered = await this.loadOrderedQuestions(existingIncomplete.questions as string[], true);
      if (ordered.length > 0) {
        return this.formatSet(existingIncomplete, ordered);
      }
      // Every question of that old set was since deleted/unpublished by an
      // admin — retire the dead set and fall through to build a fresh one.
      await this.prisma.questionBankSet.update({
        where: { id: existingIncomplete.id },
        data: { isCompleted: true, completedAt: new Date() },
      });
    }

    // 2) Free-tier gate. `scopeSets` = how many sets this student has already
    //    started in exactly this scope. A student who is WEAK in a topic (or
    //    sub-topic) is never gated for it — unlimited free practice there.
    const scopeSets = await this.prisma.questionBankSet.count({ where: scopeWhere });
    const isFreeWeakScope = topicId || subTopicId ? await this.isScopeWeakForUser(userId, topicId, subTopicId) : false;
    if (scopeSets >= this.FREE_SETS_LIMIT && !isFreeWeakScope) {
      const premium = await this.checkPremiumAccess(userId);
      if (!premium) {
        throw new ForbiddenException({
          message: `Free users can only practice ${this.FREE_SETS_LIMIT} sets per subject/chapter/topic. Upgrade to Premium for unlimited practice.`,
          code: 'PREMIUM_REQUIRED',
          freeSetsUsed: this.FREE_SETS_LIMIT,
          nextSetNumber: scopeSets + 1,
        });
      }
    }

    // 3) Pick the questions.
    const questions = await this.fetchQuestionsForSet(userId, { subjectId, chapterId, topicId, subTopicId, examId }, size);
    if (questions.length === 0) {
      throw new NotFoundException(
        'Is selection me abhi koi practice question available nahi hai. Koi aur chapter/topic chunein, ya thodi der baad try karein.',
      );
    }

    // 4) Create the set. setNumber is unique per (user, subject, chapter,
    //    exam) — number it as max+1 across ALL scopes sharing that tuple so a
    //    topic set can never collide with a chapter-wide one. One retry
    //    covers two requests racing for the same number.
    let created: any = null;
    for (let attempt = 0; attempt < 2 && !created; attempt++) {
      const agg = await this.prisma.questionBankSet.aggregate({
        where: { userId, subjectId: subjectId ?? null, chapterId: chapterId ?? null, examId: examId ?? null },
        _max: { setNumber: true },
      });
      const setNumber = (agg._max.setNumber ?? 0) + 1;
      try {
        created = await this.prisma.questionBankSet.create({
          data: {
            userId,
            subjectId: subjectId ?? null,
            chapterId: chapterId ?? null,
            topicId: topicId ?? null,
            subTopicId: subTopicId ?? null,
            examId: examId ?? null,
            setNumber,
            questions: questions.map((q) => q.id),
            currentIndex: 0,
            answers: {},
            mode,
          },
        });
      } catch (e: any) {
        if (e?.code !== 'P2002' || attempt === 1) throw e;
      }
    }

    await this.updateUserProgress(userId, subjectId, chapterId, examId, {
      setsCompleted: 0,
      totalQuestions: 0,
      correctAnswers: 0,
      wrongAnswers: 0,
      skippedAnswers: 0,
    });

    // A brand-new set has no answers yet, so formatSet() strips
    // correctAnswer/explanation from every question (no answer-key leak).
    return this.formatSet(created, questions);
  }

  // Fetch questions for a practice set.
  //
  // Pool = APPROVED + live + year-less (practice) questions inside the exact
  // scope. Questions this student has already been shown in a past set of the
  // same scope are excluded until the whole pool has been used once — only
  // then are the longest-unseen ones recycled. (Previously the pool was
  // capped at the 1000 OLDEST rows, so on a big subject most questions could
  // never appear at all; now only ids are pulled — cheap — and the chosen ids
  // are loaded afterwards.)
  private async fetchQuestionsForSet(
    userId: string,
    scope: { subjectId?: string; chapterId?: string; topicId?: string; subTopicId?: string; examId?: string },
    size: number = this.QUESTIONS_PER_SET,
  ): Promise<any[]> {
    const where: any = { ...PRACTICE_QUESTION_WHERE };
    if (scope.subjectId) where.subjectId = scope.subjectId;
    if (scope.chapterId) where.chapterId = scope.chapterId;
    if (scope.topicId) where.topicId = scope.topicId;
    if (scope.subTopicId) where.subTopicId = scope.subTopicId;
    if (scope.examId) where.examId = scope.examId;
    else where.examId = { not: null }; // must carry an exam badge

    const poolRows = await this.prisma.question.findMany({
      where,
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 50000,
    });
    if (poolRows.length === 0) return [];
    const poolIds = poolRows.map((r) => r.id);
    const poolSet = new Set(poolIds);

    const pastSets = await this.prisma.questionBankSet.findMany({
      where: {
        userId,
        subjectId: scope.subjectId ?? null,
        chapterId: scope.chapterId ?? null,
        topicId: scope.topicId ?? null,
        subTopicId: scope.subTopicId ?? null,
        examId: scope.examId ?? null,
      },
      orderBy: { startedAt: 'asc' },
      select: { questions: true },
    });
    const seenOrder: string[] = []; // first-seen order, de-duplicated
    const seen = new Set<string>();
    for (const s of pastSets) {
      for (const qid of (s.questions as string[]) ?? []) {
        if (!seen.has(qid)) {
          seen.add(qid);
          seenOrder.push(qid);
        }
      }
    }

    const unseen = poolIds.filter((id) => !seen.has(id));
    // Fisher-Yates — the old `sort(() => Math.random() - 0.5)` is biased.
    for (let i = unseen.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unseen[i], unseen[j]] = [unseen[j], unseen[i]];
    }

    let chosen: string[];
    if (unseen.length >= size) {
      chosen = unseen.slice(0, size);
    } else {
      // Pool exhausted for this student: everything unseen + the
      // longest-unseen ones (that still exist in the pool) to reach `size`.
      const need = size - unseen.length;
      const recycled = seenOrder.filter((id) => poolSet.has(id)).slice(0, need);
      chosen = [...unseen, ...recycled];
    }

    return this.loadOrderedQuestions(chosen, false);
  }

  // Loads full question rows for a list of ids, preserving that order.
  // `onlyPublished` drops questions an admin has since deleted/unpublished
  // (used when RESUMING an old set — a hidden question must not reappear).
  private async loadOrderedQuestions(questionIds: string[], onlyPublished = false): Promise<any[]> {
    if (questionIds.length === 0) return [];
    const questions = await this.prisma.question.findMany({
      where: { id: { in: questionIds }, ...(onlyPublished ? PUBLISHED_QUESTION_WHERE : {}) },
      include: {
        chapter: { select: { name: true } },
        exam: { select: { name: true } },
        subject: { select: { name: true } },
        topic: { select: { name: true } },
        subTopic: { select: { name: true } },
      },
    });
    const questionMap = new Map(questions.map((q) => [q.id, q]));
    return questionIds.map((id) => questionMap.get(id)).filter(Boolean);
  }

  // Get a specific set by ID
  async getSetById(userId: string, setId: string, _resume = false): Promise<PracticeSet> {
    const set = await this.prisma.questionBankSet.findFirst({
      where: { id: setId, userId },
    });

    if (!set) {
      throw new NotFoundException('Practice set not found');
    }

    const orderedQuestions = await this.loadOrderedQuestions(set.questions as string[]);
    return this.formatSet(set, orderedQuestions);
  }

  // Submit answer for current question
  async submitAnswer(
    userId: string,
    setId: string,
    questionId: string,
    selectedOption: string
  ): Promise<{
    correct: boolean;
    correctAnswer: string;
    explanation?: string;
    explanationHindi?: string;
    nextQuestion?: PracticeQuestion;
    isComplete: boolean;
    score?: number;
    progress: {
      current: number;
      total: number;
      correct: number;
      wrong: number;
      skipped: number;
    };
  }> {
    const set = await this.prisma.questionBankSet.findFirst({
      where: { id: setId, userId },
    });

    if (!set) {
      throw new NotFoundException('Practice set not found');
    }

    if (set.isCompleted) {
      throw new BadRequestException('Practice set already completed');
    }

    const questionIds = set.questions as string[];
    const currentIndex = set.currentIndex;

    if (currentIndex >= questionIds.length) {
      throw new BadRequestException('Invalid question index');
    }

    const currentQuestionId = questionIds[currentIndex];
    if (currentQuestionId !== questionId) {
      throw new BadRequestException('Question ID mismatch');
    }

    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
    });

    if (!question) {
      throw new NotFoundException('Question not found');
    }

    const option = selectedOption.trim().toUpperCase();
    const correct = option === question.correctAnswer;

    // Update answers
    const answers = (set.answers as Record<string, string>) || {};
    answers[questionId] = option;

    const nextIndex = currentIndex + 1;
    const isComplete = nextIndex >= questionIds.length;

    // Update set
    await this.prisma.questionBankSet.update({
      where: { id: setId },
      data: {
        answers,
        currentIndex: nextIndex,
        isCompleted: isComplete,
        completedAt: isComplete ? new Date() : null,
      },
    });

    // Calculate score if complete
    let score: number | undefined;
    let correctCount = 0;
    let wrongCount = 0;
    let skippedCount = 0;

    if (isComplete) {
      for (const qId of questionIds) {
        const userAnswer = answers[qId];
        if (!userAnswer) {
          skippedCount++;
        } else {
          const q = await this.prisma.question.findUnique({ where: { id: qId } });
          if (q && userAnswer === q.correctAnswer) {
            correctCount++;
          } else {
            wrongCount++;
          }
        }
      }

      score = Math.round((correctCount / questionIds.length) * 100);

      // Update set with score
      await this.prisma.questionBankSet.update({
        where: { id: setId },
        data: { score },
      });

      // Update user progress
      await this.updateUserProgress(userId, set.subjectId ?? undefined, set.chapterId ?? undefined, set.examId ?? undefined, {
        setsCompleted: 1,
        totalQuestions: questionIds.length,
        correctAnswers: correctCount,
        wrongAnswers: wrongCount,
        skippedAnswers: skippedCount,
      });
    }

    // Get next question if not complete.
    // BUGFIX: the upcoming question has NOT been answered yet, so its
    // correctAnswer/explanation must never be sent to the client here
    // (previously formatQuestion() always included them — answer key leak).
    let nextQuestion: PracticeQuestion | undefined;
    if (!isComplete) {
      const nextQ = await this.prisma.question.findUnique({
        where: { id: questionIds[nextIndex] },
        include: { chapter: { select: { name: true } }, exam: { select: { name: true } } },
      });
      if (nextQ) {
        nextQuestion = this.formatQuestion(nextQ, false);
      }
    }

    return {
      correct,
      correctAnswer: question.correctAnswer ?? '',
      explanation: question.explanation ?? undefined,
      explanationHindi: question.explanationHindi ?? undefined,
      nextQuestion,
      isComplete,
      score,
      progress: {
        current: nextIndex + 1,
        total: questionIds.length,
        correct: correctCount,
        wrong: wrongCount,
        skipped: skippedCount,
      },
    };
  }

  // Skip current question
  async skipQuestion(userId: string, setId: string, questionId: string): Promise<{
    nextQuestion?: PracticeQuestion;
    isComplete: boolean;
    progress: { current: number; total: number };
  }> {
    const set = await this.prisma.questionBankSet.findFirst({
      where: { id: setId, userId },
    });

    if (!set) throw new NotFoundException('Practice set not found');
    if (set.isCompleted) throw new BadRequestException('Practice set already completed');

    const questionIds = set.questions as string[];
    const currentIndex = set.currentIndex;
    const nextIndex = currentIndex + 1;
    const isComplete = nextIndex >= questionIds.length;

    const answers = (set.answers as Record<string, string>) || {};
    answers[questionId] = 'SKIPPED';

    await this.prisma.questionBankSet.update({
      where: { id: setId },
      data: {
        answers,
        currentIndex: nextIndex,
        isCompleted: isComplete,
        completedAt: isComplete ? new Date() : null,
      },
    });

    // BUGFIX: skipped question's own answer key is fine to leak nowhere here —
    // but the NEXT question (unanswered) must not reveal its correctAnswer.
    let nextQuestion: PracticeQuestion | undefined;
    if (!isComplete) {
      const nextQ = await this.prisma.question.findUnique({
        where: { id: questionIds[nextIndex] },
        include: { chapter: { select: { name: true } }, exam: { select: { name: true } } },
      });
      if (nextQ) nextQuestion = this.formatQuestion(nextQ, false);
    }

    return { nextQuestion, isComplete, progress: { current: nextIndex + 1, total: questionIds.length } };
  }

  // Go to previous question
  // BUGFIX: previous questions were always already answered/skipped (you can
  // only move forward via answer/skip), so it's safe and expected to reveal
  // their correctAnswer/explanation for review here.
  async previousQuestion(userId: string, setId: string): Promise<{
    question?: PracticeQuestion;
    progress: { current: number; total: number };
  }> {
    const set = await this.prisma.questionBankSet.findFirst({
      where: { id: setId, userId },
    });

    if (!set) throw new NotFoundException('Practice set not found');
    if (set.currentIndex <= 0) throw new BadRequestException('Already at first question');

    const prevIndex = set.currentIndex - 1;
    const questionIds = set.questions as string[];
    const prevQuestionId = questionIds[prevIndex];
    const answers = (set.answers as Record<string, string>) || {};
    const wasAnswered = Object.prototype.hasOwnProperty.call(answers, prevQuestionId);
    const prevQ = await this.prisma.question.findUnique({
      where: { id: prevQuestionId },
      include: { chapter: { select: { name: true } }, exam: { select: { name: true } } },
    });

    await this.prisma.questionBankSet.update({
      where: { id: setId },
      data: { currentIndex: prevIndex },
    });

    return {
      question: prevQ ? this.formatQuestion(prevQ, wasAnswered) : undefined,
      progress: { current: prevIndex + 1, total: questionIds.length },
    };
  }

  // Go to specific question index
  // BUGFIX: only reveal correctAnswer/explanation if THAT specific question
  // has already been answered/skipped — jumping ahead to an unattempted
  // question (e.g. via the question palette) must not leak its answer.
  async goToQuestion(userId: string, setId: string, index: number): Promise<{
    question?: PracticeQuestion;
    progress: { current: number; total: number };
  }> {
    const set = await this.prisma.questionBankSet.findFirst({
      where: { id: setId, userId },
    });

    if (!set) throw new NotFoundException('Practice set not found');
    const questionIds = set.questions as string[];
    if (index < 0 || index >= questionIds.length) {
      throw new BadRequestException('Invalid question index');
    }

    const targetQuestionId = questionIds[index];
    const answers = (set.answers as Record<string, string>) || {};
    const wasAnswered = Object.prototype.hasOwnProperty.call(answers, targetQuestionId);

    const q = await this.prisma.question.findUnique({
      where: { id: targetQuestionId },
      include: { chapter: { select: { name: true } }, exam: { select: { name: true } } },
    });

    await this.prisma.questionBankSet.update({
      where: { id: setId },
      data: { currentIndex: index },
    });

    return {
      question: q ? this.formatQuestion(q, wasAnswered) : undefined,
      progress: { current: index + 1, total: questionIds.length },
    };
  }

  // Get user's practice history
  async getPracticeHistory(userId: string, subjectId?: string): Promise<PracticeSet[]> {
    const where: any = { userId, isCompleted: true };
    if (subjectId) where.subjectId = subjectId;

    const sets = await this.prisma.questionBankSet.findMany({
      where,
      orderBy: { completedAt: 'desc' },
      take: 50,
    });

    // Fetch subject/chapter/exam names
    const subjectIds = [...new Set(sets.map(s => s.subjectId).filter((id): id is string => Boolean(id)))];
    const chapterIds = [...new Set(sets.map(s => s.chapterId).filter((id): id is string => Boolean(id)))];
    const examIds = [...new Set(sets.map(s => s.examId).filter((id): id is string => Boolean(id)))];

    const [subjects, chapters, exams] = await Promise.all([
      subjectIds.length > 0 ? this.prisma.subject.findMany({ where: { id: { in: subjectIds } }, select: { id: true, name: true } }) : [],
      chapterIds.length > 0 ? this.prisma.chapter.findMany({ where: { id: { in: chapterIds } }, select: { id: true, name: true } }) : [],
      examIds.length > 0 ? this.prisma.exam.findMany({ where: { id: { in: examIds } }, select: { id: true, name: true } }) : [],
    ]);

    const subjectMap = new Map(subjects.map(s => [s.id, s.name]));
    const chapterMap = new Map(chapters.map(c => [c.id, c.name]));
    const examMap = new Map(exams.map(e => [e.id, e.name]));

    return sets.map(s => this.formatSet(s, undefined, {
      subjectName: s.subjectId ? subjectMap.get(s.subjectId) : undefined,
      chapterName: s.chapterId ? chapterMap.get(s.chapterId) : undefined,
      examName: s.examId ? examMap.get(s.examId) : undefined,
    }));
  }

  // Get user progress summary
  async getUserProgress(userId: string): Promise<UserProgressSummary[]> {
    const progress = await this.prisma.userProgress.findMany({
      where: { userId },
      include: {
        subject: { select: { name: true } },
        chapter: { select: { name: true } },
        exam: { select: { name: true } },
      },
      orderBy: { lastPracticedAt: 'desc' },
    });

    return progress.map(p => ({
      subjectId: p.subjectId,
      subjectName: p.subject?.name ?? '',
      chapterId: p.chapterId ?? undefined,
      chapterName: p.chapter?.name ?? undefined,
      examId: p.examId ?? undefined,
      examName: p.exam?.name ?? undefined,
      setsCompleted: p.setsCompleted,
      totalQuestions: p.totalQuestions,
      correctAnswers: p.correctAnswers,
      wrongAnswers: p.wrongAnswers,
      skippedAnswers: p.skippedAnswers,
      accuracyPercent: p.totalQuestions > 0 ? Math.round((p.correctAnswers / p.totalQuestions) * 100) : 0,
      lastPracticedAt: p.lastPracticedAt,
    }));
  }

  // Get available subjects for practice (legacy flat shape — kept so any old
  // client keeps working; the new /practice page uses getPracticeTaxonomy()).
  //
  // FIXED (Sep 21 2026): only PRACTICE (year-less) questions count, and the
  // extra Hindi-text filter is gone (isApproved is the single gate).
  async getAvailableSubjects(userId: string, examId?: string): Promise<any[]> {
    const qWhere: any = { ...PRACTICE_QUESTION_WHERE };
    if (examId) qWhere.examId = examId;
    const subjects = await this.prisma.subject.findMany({
      where: { questions: { some: qWhere } },
      include: {
        chapters: {
          where: { questions: { some: qWhere } },
          select: { id: true, name: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const userProgress = await this.prisma.userProgress.findMany({ where: { userId } });
    const progressMap = new Map(
      userProgress.map((p) => {
        const chapterKey = p.chapterId ? `-${p.chapterId}` : '-';
        const examKey = p.examId ? `-${p.examId}` : '-';
        return [`${p.subjectId}${chapterKey}${examKey}`, p];
      }),
    );

    return subjects.map((s) => ({
      id: s.id,
      name: s.name,
      chapters: s.chapters.map((c) => ({
        id: c.id,
        name: c.name,
        progress: progressMap.get(`${s.id}-${c.id}-${examId ?? '-'}`) ?? null,
      })),
      progress: progressMap.get(`${s.id}--${examId ?? '-'}`) ?? null,
    }));
  }

  // ---------------------------------------------------------------------------
  // NEW (Sep 21 2026) — the FULL syllabus tree for the student Practice screen:
  //   Subject → Chapter → Topic → Sub-topic
  // with the number of PRACTICE questions at every level, a weak flag on every
  // topic/sub-topic the student has got wrong, and any in-progress sets.
  //
  // The tree comes from the SYLLABUS tables (not from "which topics happen to
  // have questions"), so a topic/sub-topic the admin just created in
  // Chapter/Topic Manage shows up for students immediately — with a 0 count —
  // and lights up the moment questions are uploaded into it. Nothing is typed
  // by anyone; everything is picked from this list.
  // ---------------------------------------------------------------------------
  async getPracticeTaxonomy(userId: string, examId?: string) {
    const qWhere: any = { ...PRACTICE_QUESTION_WHERE };
    if (examId) qWhere.examId = examId;
    else qWhere.examId = { not: null };

    const [subjects, grouped, examGroups, weakRows, inProgress] = await Promise.all([
      this.prisma.subject.findMany({
        select: {
          id: true,
          name: true,
          nameHindi: true,
          slug: true,
          chapters: {
            select: {
              id: true,
              name: true,
              nameHindi: true,
              slug: true,
              topics: {
                select: {
                  id: true,
                  name: true,
                  nameHindi: true,
                  slug: true,
                  subTopics: { select: { id: true, name: true, nameHindi: true, slug: true }, orderBy: { name: 'asc' } },
                },
                orderBy: { name: 'asc' },
              },
            },
            orderBy: { name: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.question.groupBy({
        by: ['subjectId', 'chapterId', 'topicId', 'subTopicId'],
        where: qWhere,
        _count: { _all: true },
      }),
      this.prisma.question.groupBy({
        by: ['examId'],
        where: { ...PRACTICE_QUESTION_WHERE, examId: { not: null } },
        _count: { _all: true },
      }),
      this.weakScopeRows(userId),
      this.getInProgressSets(userId),
    ]);

    const subjectCount = new Map<string, number>();
    const chapterCount = new Map<string, number>();
    const chapterUnassigned = new Map<string, number>();
    const topicCount = new Map<string, number>();
    const subTopicCount = new Map<string, number>();
    for (const g of grouped) {
      const n = g._count._all;
      subjectCount.set(g.subjectId, (subjectCount.get(g.subjectId) ?? 0) + n);
      if (g.chapterId) {
        chapterCount.set(g.chapterId, (chapterCount.get(g.chapterId) ?? 0) + n);
        if (!g.topicId) chapterUnassigned.set(g.chapterId, (chapterUnassigned.get(g.chapterId) ?? 0) + n);
      }
      if (g.topicId) topicCount.set(g.topicId, (topicCount.get(g.topicId) ?? 0) + n);
      if (g.subTopicId) subTopicCount.set(g.subTopicId, (subTopicCount.get(g.subTopicId) ?? 0) + n);
    }

    const weakTopics = new Set<string>();
    const weakSubTopics = new Set<string>();
    for (const w of weakRows) {
      if (w.topicId) weakTopics.add(w.topicId);
      if (w.subTopicId) weakSubTopics.add(w.subTopicId);
    }

    const examIds = examGroups.map((g) => g.examId).filter((id): id is string => Boolean(id));
    const exams = examIds.length
      ? await this.prisma.exam.findMany({ where: { id: { in: examIds } }, select: { id: true, name: true } })
      : [];
    const examCountMap = new Map(examGroups.map((g) => [g.examId, g._count._all]));

    const tree = subjects
      .map((s) => ({
        id: s.id,
        name: s.name,
        nameHindi: s.nameHindi,
        slug: s.slug,
        questionCount: subjectCount.get(s.id) ?? 0,
        chapters: s.chapters
          .map((c) => ({
            id: c.id,
            name: c.name,
            nameHindi: c.nameHindi,
            questionCount: chapterCount.get(c.id) ?? 0,
            unassignedCount: chapterUnassigned.get(c.id) ?? 0,
            topics: c.topics.map((t) => ({
              id: t.id,
              name: t.name,
              nameHindi: t.nameHindi,
              questionCount: topicCount.get(t.id) ?? 0,
              isWeak: weakTopics.has(t.id),
              subTopics: t.subTopics.map((st) => ({
                id: st.id,
                name: st.name,
                nameHindi: st.nameHindi,
                questionCount: subTopicCount.get(st.id) ?? 0,
                isWeak: weakSubTopics.has(st.id),
              })),
            })),
          }))
          // chapters that actually have practice questions first, then the rest of the syllabus
          .sort((a, b) => (b.questionCount > 0 ? 1 : 0) - (a.questionCount > 0 ? 1 : 0)),
      }))
      // a subject with no chapters at all (empty duplicate) is just noise for a student
      .filter((s) => s.chapters.length > 0)
      .sort((a, b) => (b.questionCount > 0 ? 1 : 0) - (a.questionCount > 0 ? 1 : 0));

    return {
      subjects: tree,
      exams: exams
        .map((e) => ({ id: e.id, name: e.name, count: examCountMap.get(e.id) ?? 0 }))
        .sort((a, b) => b.count - a.count),
      inProgress,
      freeSetsPerScope: this.FREE_SETS_LIMIT,
    };
  }

  // Unfinished sets of this student, with human-readable scope names, for the
  // "Continue where you left off" cards.
  async getInProgressSets(userId: string) {
    const sets = await this.prisma.questionBankSet.findMany({
      where: { userId, isCompleted: false },
      orderBy: { startedAt: 'desc' },
      take: 12,
    });
    if (sets.length === 0) return [];
    const uniq = (arr: (string | null | undefined)[]) => [...new Set(arr.filter((x): x is string => Boolean(x)))];
    const [subjects, chapters, topics, subTopics, exams] = await Promise.all([
      this.prisma.subject.findMany({ where: { id: { in: uniq(sets.map((s) => s.subjectId)) } }, select: { id: true, name: true } }),
      this.prisma.chapter.findMany({ where: { id: { in: uniq(sets.map((s) => s.chapterId)) } }, select: { id: true, name: true } }),
      this.prisma.topic.findMany({ where: { id: { in: uniq(sets.map((s) => s.topicId)) } }, select: { id: true, name: true } }),
      this.prisma.subTopic.findMany({ where: { id: { in: uniq(sets.map((s) => s.subTopicId)) } }, select: { id: true, name: true } }),
      this.prisma.exam.findMany({ where: { id: { in: uniq(sets.map((s) => s.examId)) } }, select: { id: true, name: true } }),
    ]);
    const nameOf = (list: { id: string; name: string }[]) => new Map(list.map((x) => [x.id, x.name]));
    const sM = nameOf(subjects);
    const cM = nameOf(chapters);
    const tM = nameOf(topics);
    const stM = nameOf(subTopics);
    const eM = nameOf(exams);
    return sets.map((s) => ({
      id: s.id,
      setNumber: s.setNumber,
      total: Array.isArray(s.questions) ? (s.questions as any[]).length : 0,
      answered: s.answers && typeof s.answers === 'object' ? Object.keys(s.answers as object).length : 0,
      subject: s.subjectId ? sM.get(s.subjectId) ?? null : null,
      chapter: s.chapterId ? cM.get(s.chapterId) ?? null : null,
      topic: s.topicId ? tM.get(s.topicId) ?? null : null,
      subTopic: s.subTopicId ? stM.get(s.subTopicId) ?? null : null,
      exam: s.examId ? eM.get(s.examId) ?? null : null,
      startedAt: s.startedAt,
    }));
  }

  // Finish a practice set. The /test screen scores the answers itself (and
  // records the TestAttempt used by Results / Deep Analysis), but it never
  // told THIS service the set was done — so every set stayed "in progress"
  // forever, the student was handed the SAME set again on every Start, the
  // free-set counter never moved and progress never updated. The test page
  // now calls this once on submit.
  async completeSet(userId: string, setId: string, answers?: Record<string, string>) {
    const set = await this.prisma.questionBankSet.findFirst({ where: { id: setId, userId } });
    if (!set) throw new NotFoundException('Practice set not found');
    if (set.isCompleted) {
      return { alreadyCompleted: true, score: set.score ?? 0 };
    }
    const questionIds = (set.questions as string[]) ?? [];
    const rows = await this.prisma.question.findMany({
      where: { id: { in: questionIds } },
      select: { id: true, correctAnswer: true },
    });
    const correctMap = new Map(rows.map((r) => [r.id, String(r.correctAnswer ?? '').trim().toUpperCase()]));

    const given = answers && typeof answers === 'object' ? answers : {};
    const stored: Record<string, string> = {};
    let correct = 0;
    let wrong = 0;
    let skipped = 0;
    for (const qid of questionIds) {
      const a = String(given[qid] ?? '').trim().toUpperCase();
      if (!a || a === 'SKIPPED') {
        skipped++;
        stored[qid] = 'SKIPPED';
      } else if (correctMap.get(qid) === a) {
        correct++;
        stored[qid] = a;
      } else {
        wrong++;
        stored[qid] = a;
      }
    }
    const score = questionIds.length ? Math.round((correct / questionIds.length) * 100) : 0;

    await this.prisma.questionBankSet.update({
      where: { id: setId },
      data: { answers: stored, currentIndex: questionIds.length, isCompleted: true, completedAt: new Date(), score },
    });
    await this.updateUserProgress(userId, set.subjectId ?? undefined, set.chapterId ?? undefined, set.examId ?? undefined, {
      setsCompleted: 1,
      totalQuestions: questionIds.length,
      correctAnswers: correct,
      wrongAnswers: wrong,
      skippedAnswers: skipped,
    });
    return { alreadyCompleted: false, score, correct, wrong, skipped, total: questionIds.length };
  }

  // Check if user has premium access.
  // ADMIN BYPASS: admins never need an active Subscription row — the whole
  // point of the ADMIN role is unrestricted access for managing/testing the
  // platform. Previously this only ever checked the Subscription table, so
  // even a logged-in admin without a personally-granted subscription hit
  // "Free users can only practice N sets... Upgrade to Premium" like any
  // student. Now role is checked first (one extra cheap indexed lookup by
  // id) and ADMIN short-circuits to true before touching Subscription at all.
  private async checkPremiumAccess(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role === 'ADMIN') return true;

    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        endsAt: { gt: new Date() },
      },
    });
    return !!subscription;
  }

  // NEW (Sachin — "khud sey un chapter k weak topic jo honge, jin ka
  // answer glt hoga students ka, un topics ke questions direct practice ke
  // liye"): a topic / sub-topic is "weak" for a user if they have at least one
  // wrong or skipped AttemptAnswer on a question that belongs to it, across
  // every submitted test they've ever taken. Deliberately simple/binary (not
  // accuracy-percentage-based) to match how the chapter-level weak-areas
  // feature (tests.service.ts getWeakAreasPractice) already defines "weak".
  // Practice-set attempts count too, because the /test screen records every
  // finished practice set as a submitted TestAttempt.
  private async isScopeWeakForUser(userId: string, topicId?: string, subTopicId?: string): Promise<boolean> {
    if (!topicId && !subTopicId) return false;
    const wrongOrSkipped = await this.prisma.attemptAnswer.findFirst({
      where: {
        testAttempt: { userId, status: 'SUBMITTED' },
        question: subTopicId ? { subTopicId } : { topicId },
        OR: [{ isCorrect: false }, { selectedOption: null }],
      },
      select: { id: true },
    });
    return !!wrongOrSkipped;
  }

  // One grouped query: every (topic, sub-topic) the user has got wrong/skipped.
  // Never throws — a failure here must not take the whole practice screen down.
  private async weakScopeRows(userId: string): Promise<{ topicId: string | null; subTopicId: string | null }[]> {
    try {
      return await this.prisma.$queryRaw<{ topicId: string | null; subTopicId: string | null }[]>`
        SELECT DISTINCT q."topicId" AS "topicId", q."subTopicId" AS "subTopicId"
        FROM attempt_answers aa
        JOIN test_attempts ta ON ta.id = aa."testAttemptId"
        JOIN questions q ON q.id = aa."questionId"
        WHERE ta."userId" = ${userId}
          AND ta.status = 'SUBMITTED'
          AND (aa."isCorrect" = false OR aa."selectedOption" IS NULL)
          AND (q."topicId" IS NOT NULL OR q."subTopicId" IS NOT NULL)`;
    } catch {
      return [];
    }
  }

  // Powers the "browse all topics under this chapter, weak ones flagged" UI
  // (GET /bank/topics/weak-status). Kept for the weak-practice page.
  async getTopicsWithWeakStatus(userId: string, chapterId: string) {
    const topics = await this.prisma.topic.findMany({
      where: { chapterId },
      select: { id: true, name: true, nameHindi: true, slug: true },
      orderBy: { name: 'asc' },
    });
    if (topics.length === 0) return [];

    const wrongOrSkipped = await this.prisma.attemptAnswer.findMany({
      where: {
        testAttempt: { userId, status: 'SUBMITTED' },
        question: { chapterId, topicId: { not: null } },
        OR: [{ isCorrect: false }, { selectedOption: null }],
      },
      select: { question: { select: { topicId: true } } },
    });
    const weakTopicIds = new Set(wrongOrSkipped.map((w) => w.question?.topicId).filter((id): id is string => Boolean(id)));

    return topics.map((t) => ({
      id: t.id,
      name: t.name,
      nameHindi: t.nameHindi,
      slug: t.slug,
      isWeak: weakTopicIds.has(t.id),
    }));
  }

  // Update user progress.
  //
  // BUGFIX (Sep 21 2026): this used Prisma's compound-unique upsert with
  // `chapterId ?? ''` / `examId ?? ''` in the WHERE. Rows are stored with
  // NULL (not '') for "no chapter / no exam", and NULL never equals '' — so
  // the upsert never found the existing row and inserted a NEW progress row
  // on every single Start and every Finish (and a NULL in a unique index is
  // never a conflict, so nothing stopped it). The Progress cards then showed
  // the same subject many times with split counters. Now: look the row up
  // with real nulls, update it if it exists, create it otherwise.
  private async updateUserProgress(
    userId: string,
    subjectId: string | undefined,
    chapterId: string | undefined,
    examId: string | undefined,
    delta: {
      setsCompleted: number;
      totalQuestions: number;
      correctAnswers: number;
      wrongAnswers: number;
      skippedAnswers: number;
    }
  ): Promise<void> {
    if (!subjectId) return;

    const existing = await this.prisma.userProgress.findFirst({
      where: { userId, subjectId, chapterId: chapterId ?? null, examId: examId ?? null },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.userProgress.update({
        where: { id: existing.id },
        data: {
          setsCompleted: { increment: delta.setsCompleted },
          totalQuestions: { increment: delta.totalQuestions },
          correctAnswers: { increment: delta.correctAnswers },
          wrongAnswers: { increment: delta.wrongAnswers },
          skippedAnswers: { increment: delta.skippedAnswers },
          lastPracticedAt: new Date(),
        },
      });
      return;
    }

    await this.prisma.userProgress.create({
      data: {
        userId,
        subjectId,
        chapterId: chapterId ?? null,
        examId: examId ?? null,
        setsCompleted: delta.setsCompleted,
        totalQuestions: delta.totalQuestions,
        correctAnswers: delta.correctAnswers,
        wrongAnswers: delta.wrongAnswers,
        skippedAnswers: delta.skippedAnswers,
      },
    });
  }

  // Format set for response.
  // BUGFIX: previously every question in the set — including ones the user
  // hasn't reached yet — was serialized with its correctAnswer + explanation,
  // effectively handing out the full answer key the moment a set was started
  // or resumed. Now a question only reveals those fields once the user has
  // actually answered/skipped it (or the whole set is completed, in which
  // case reviewing all answers is expected behaviour).
  private formatSet(set: any, questions?: any[], meta?: { subjectName?: string; chapterName?: string; examName?: string }): PracticeSet {
    const answers = (set.answers as Record<string, string>) || {};
    const formattedQuestions = questions
      ? questions.map(q => this.formatQuestion(q, set.isCompleted || Object.prototype.hasOwnProperty.call(answers, q.id)))
      : [];

    return {
      id: set.id,
      subjectId: set.subjectId ?? undefined,
      chapterId: set.chapterId ?? undefined,
      topicId: set.topicId ?? undefined,
      subTopicId: set.subTopicId ?? undefined,
      examId: set.examId ?? undefined,
      setNumber: set.setNumber,
      questions: formattedQuestions,
      currentIndex: set.currentIndex,
      answers: (set.answers as Record<string, string>) || {},
      startedAt: set.startedAt,
      completedAt: set.completedAt ?? undefined,
      score: set.score ?? undefined,
      isCompleted: set.isCompleted,
      mode: set.mode,
      subjectName: meta?.subjectName,
      chapterName: meta?.chapterName,
      examName: meta?.examName,
    };
  }

  // Format question for response.
  // `revealAnswer` MUST be false for any question the user has not answered
  // or skipped yet — otherwise the correct answer leaks to the client before
  // it's supposed to (visible in the network tab even if the UI hides it).
  private formatQuestion(q: any, revealAnswer = false): PracticeQuestion {
    return {
      id: q.id,
      questionText: q.questionText,
      questionTextHindi: q.questionTextHindi,
      options: (q.optionsJson as any[]).map((o: any) => ({
        key: o.key,
        text: o.text,
        textHi: o.textHi ?? null,
      })),
      chapter: q.chapter?.name ?? '',
      topic: q.topic?.name ?? null,
      subTopic: q.subTopic?.name ?? null,
      examName: q.exam?.name ?? null,
      year: q.year ?? null,
      shift: q.shift ?? null,
      marks: q.marks ?? 1,
      negativeMarks: q.negativeMarks ?? 0.25,
      correctAnswer: revealAnswer ? (q.correctAnswer ?? null) : null,
      explanation: revealAnswer ? (q.explanation ?? null) : null,
      explanationHindi: revealAnswer ? (q.explanationHindi ?? null) : null,
      subjectId: q.subjectId,
    };
  }
}
