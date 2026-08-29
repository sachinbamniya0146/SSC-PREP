/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLISHED_QUESTION_WHERE } from '../common/question-visibility';

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
  _weakMeta?: { chapterId: string; chapterName: string; wasWrong: boolean; wasSkipped: boolean };
}

export interface PracticeSet {
  id: string;
  subjectId?: string;
  chapterId?: string;
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

  // Get or create a practice set for a user
  async getOrCreateSet(
    userId: string,
    options: {
      subjectId?: string;
      chapterId?: string;
      examId?: string;
      setNumber?: number;
      mode?: 'practice' | 'test';
      resume?: boolean; // if true, resume existing incomplete set
    }
  ): Promise<PracticeSet> {
    const { subjectId, chapterId, examId, setNumber = 1, mode = 'practice', resume = false } = options;

    // If resume is true, try to find existing incomplete set
    if (resume) {
      const existingSet = await this.prisma.questionBankSet.findFirst({
        where: {
          userId,
          subjectId,
          chapterId,
          examId,
          setNumber,
          isCompleted: false,
        },
        orderBy: { startedAt: 'desc' },
      });

      if (existingSet) {
        return this.formatSet(existingSet);
      }
    }

    // Check if user has an existing incomplete set for this subject/chapter/setNumber (prevent duplicates)
    const existingIncompleteSet = await this.prisma.questionBankSet.findFirst({
      where: {
        userId,
        subjectId,
        chapterId,
        examId,
        setNumber: setNumber || 1,
        isCompleted: false,
      },
      orderBy: { startedAt: 'desc' },
    });

    if (existingIncompleteSet) {
      return this.formatSet(existingIncompleteSet);
    }

    // Check if user has completed sets for this subject/chapter
    const completedSets = await this.prisma.questionBankSet.findMany({
      where: {
        userId,
        subjectId,
        chapterId,
        examId,
        isCompleted: true,
      },
      orderBy: { setNumber: 'asc' },
    });

    const nextSetNumber = setNumber || (completedSets.length + 1);

    // Check free limit
    if (nextSetNumber > this.FREE_SETS_LIMIT) {
      const subscription = await this.checkPremiumAccess(userId);
      if (!subscription) {
        throw new ForbiddenException({
          message: `Free users can only practice ${this.FREE_SETS_LIMIT} sets per subject/chapter. Upgrade to Premium for unlimited practice.`,
          code: 'PREMIUM_REQUIRED',
          freeSetsUsed: this.FREE_SETS_LIMIT,
          nextSetNumber,
        });
      }
    }

    // Fetch questions for the set
    const questions = await this.fetchQuestionsForSet(subjectId, chapterId, examId);

    if (questions.length === 0) {
      throw new NotFoundException('No questions available for this subject/chapter/exam combination');
    }

    // Create new practice set
    const newSet = await this.prisma.questionBankSet.create({
      data: {
        userId,
        subjectId,
        chapterId,
        examId,
        setNumber: nextSetNumber,
        questions: questions.map(q => q.id),
        currentIndex: 0,
        answers: {},
        mode,
      },
    });

    // Create or update user progress
    await this.updateUserProgress(userId, subjectId, chapterId, examId, {
      setsCompleted: 0,
      totalQuestions: 0,
      correctAnswers: 0,
      wrongAnswers: 0,
      skippedAnswers: 0,
    });

    // BUGFIX: a brand-new set has zero answers recorded yet, so no question in
    // it should reveal correctAnswer/explanation. formatSet() strips those
    // fields for any question not present in `answers` (see formatSet below).
    return this.formatSet(newSet, questions);
  }

  // Fetch questions for a practice set
  private async fetchQuestionsForSet(
    subjectId?: string,
    chapterId?: string,
    examId?: string
  ): Promise<any[]> {
    const where: any = {
      ...PUBLISHED_QUESTION_WHERE,
      questionTextHindi: { not: null },
    };

    if (subjectId) where.subjectId = subjectId;
    if (chapterId) where.chapterId = chapterId;
    if (examId) where.examId = examId;
    else where.examId = { not: null }; // Must have exam badge

    const rows = await this.prisma.question.findMany({
      where,
      include: {
        chapter: { select: { name: true } },
        exam: { select: { name: true } },
        subject: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 1000,
    });

    // Shuffle and take 25
    const shuffled = rows.slice().sort(() => Math.random() - 0.5).slice(0, this.QUESTIONS_PER_SET);
    return shuffled;
  }

  // Get a specific set by ID
  async getSetById(userId: string, setId: string, _resume = false): Promise<PracticeSet> {
    const set = await this.prisma.questionBankSet.findFirst({
      where: { id: setId, userId },
    });

    if (!set) {
      throw new NotFoundException('Practice set not found');
    }

    // Fetch full question details
    const questions = await this.prisma.question.findMany({
      where: { id: { in: set.questions as string[] } },
      include: {
        chapter: { select: { name: true } },
        exam: { select: { name: true } },
        subject: { select: { name: true } },
      },
    });

    // Maintain order
    const questionMap = new Map(questions.map(q => [q.id, q]));
    const orderedQuestions = (set.questions as string[])
      .map(id => questionMap.get(id))
      .filter(Boolean);

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

  // Get available subjects for practice
  async getAvailableSubjects(userId: string, examId?: string): Promise<any[]> {
    // Get subjects with approved bilingual questions
    const subjects = await this.prisma.subject.findMany({
      where: {
        questions: {
          some: { ...PUBLISHED_QUESTION_WHERE, questionTextHindi: { not: '' } },
        },
      },
      include: {
        chapters: {
          where: {
            questions: {
              some: { ...PUBLISHED_QUESTION_WHERE, questionTextHindi: { not: '' } },
            },
          },
          select: { id: true, name: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Add progress info
    const userProgress = await this.prisma.userProgress.findMany({
      where: { userId },
    });

    const progressMap = new Map(
      userProgress.map(p => {
        const chapterKey = p.chapterId ? `-${p.chapterId}` : '-';
        const examKey = p.examId ? `-${p.examId}` : '-';
        return [`${p.subjectId}${chapterKey}${examKey}`, p];
      })
    );

    return subjects.map(s => ({
      id: s.id,
      name: s.name,
      chapters: s.chapters.map(c => ({
        id: c.id,
        name: c.name,
        progress: progressMap.get(`${s.id}-${c.id}-${examId ?? '-'}`) ?? null,
      })),
      progress: progressMap.get(`${s.id}--${examId ?? '-'}`) ?? null,
    }));
  }

  // Check if user has premium access
  private async checkPremiumAccess(userId: string): Promise<boolean> {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        endsAt: { gt: new Date() },
      },
    });
    return !!subscription;
  }

  // Update user progress
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

    await this.prisma.userProgress.upsert({
      where: {
        userId_subjectId_chapterId_examId: {
          userId,
          subjectId,
          chapterId: chapterId ?? '',
          examId: examId ?? '',
        },
      },
      create: {
        userId,
        subjectId,
        chapterId,
        examId,
        setsCompleted: delta.setsCompleted,
        totalQuestions: delta.totalQuestions,
        correctAnswers: delta.correctAnswers,
        wrongAnswers: delta.wrongAnswers,
        skippedAnswers: delta.skippedAnswers,
      },
      update: {
        setsCompleted: { increment: delta.setsCompleted },
        totalQuestions: { increment: delta.totalQuestions },
        correctAnswers: { increment: delta.correctAnswers },
        wrongAnswers: { increment: delta.wrongAnswers },
        skippedAnswers: { increment: delta.skippedAnswers },
        lastPracticedAt: new Date(),
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
