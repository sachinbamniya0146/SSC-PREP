/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewService } from '../review/review.service';
import { GamificationService } from '../gamification/gamification.service';

@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);

  constructor(
    private prisma: PrismaService,
    private review: ReviewService,
    private gamification: GamificationService,
  ) {}

  /** Get today's daily quiz (10 questions across subjects). Auto-creates if none. */
  async getToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateStr = today.toISOString().split('T')[0];

    let quiz = await this.prisma.dailyQuiz.findUnique({ where: { date: today } });
    if (!quiz) {
      // Pull a balanced set of 10 random active questions
      // FIX Error #8: raw SQL was missing "autoSuspended" = false check
      // (only had isActive + isApproved), same gap flagged in bank.service.ts.
      const questions = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM questions
        WHERE "isActive" = true AND "isApproved" = true AND "autoSuspended" = false
        ORDER BY random() LIMIT 10`;
      if (questions.length === 0) {
        throw new BadRequestException('No approved questions available yet');
      }
      const qids = questions.map((q) => q.id);
      quiz = await this.prisma.dailyQuiz.create({
        data: {
          date: today,
          title: `Daily Quiz ${dateStr}`,
          questionsJson: qids as unknown as object,
        },
      });
    }

    const qids: string[] = Array.isArray(quiz.questionsJson) ? (quiz.questionsJson as unknown as string[]) : [];
    const questionRecords = await this.prisma.question.findMany({
      where: { id: { in: qids } },
      include: { exam: true },
    });
    const fmt = (q: (typeof questionRecords)[number]) => ({
      id: q.id,
      q: q.questionText,
      qh: q.questionTextHindi,
      opts: ((q.optionsJson as Array<{ key: string; text: string }>) ?? []).map(
        (o) => `${o.key}. ${o.text}`,
      ),
      examName: q.exam?.name ?? null,
      year: q.year,
      shift: q.shift,
      marks: q.marks,
      negativeMarks: q.negativeMarks,
    });

    return { quizId: quiz.id, date: dateStr, title: quiz.title, questions: questionRecords.map(fmt), questionCount: qids.length };
  }

  /** Submit and score today's quiz. answers: [{questionId, selectedOption}] */
  async submitQuiz(userId: string, quizId: string, answers: Array<{ questionId: string; selectedOption?: string | null }>) {
    const quiz = await this.prisma.dailyQuiz.findUnique({ where: { id: quizId } });
    if (!quiz) throw new BadRequestException('Quiz not found');

    const existing = await this.prisma.dailyQuizAttempt.findUnique({
      where: { userId_dailyQuizId: { userId, dailyQuizId: quizId } },
    });
    if (existing?.submittedAt) {
      return { alreadySubmitted: true, result: existing };
    }

    const qids: string[] = Array.isArray(quiz.questionsJson)
      ? (quiz.questionsJson as unknown as string[])
      : (JSON.parse((quiz.questionsJson as unknown as string) || '[]') as string[]);
    const questions = await this.prisma.question.findMany({
      where: { id: { in: qids } },
      include: { exam: true },
    });
    const byId = new Map(questions.map((q) => [q.id, q]));

    let totalCorrect = 0;
    let totalWrong = 0;
    let totalSkipped = 0;
    let score = 0;

    for (const ans of answers) {
      const q = byId.get(ans.questionId);
      if (!q) continue;
      if (!ans.selectedOption) {
        totalSkipped += 1;
        continue;
      }
      if (ans.selectedOption.trim().toUpperCase() === q.correctAnswer.trim().toUpperCase()) {
        totalCorrect += 1;
        score += q.marks;
      } else {
        totalWrong += 1;
        score -= q.negativeMarks;
      }
    }

    const result = await this.prisma.dailyQuizAttempt.upsert({
      where: { userId_dailyQuizId: { userId, dailyQuizId: quizId } },
      create: { userId, dailyQuizId: quizId, score, totalCorrect, totalWrong, totalSkipped, submittedAt: new Date() },
      update: { score, totalCorrect, totalWrong, totalSkipped, submittedAt: new Date() },
    });

    // v1 Phase 6 — daily quiz XP (8/correct) + streak check-in
    this.gamification
      .awardTestXp(userId, totalCorrect, 'daily')
      .catch(() => undefined);

    // Spaced repetition: queue every wrong/skipped question for review
    for (const ans of answers) {
      const q = byId.get(ans.questionId);
      if (!q) continue;
      const submitted = ans.selectedOption?.trim().toUpperCase();
      const isCorrect = submitted && submitted === q.correctAnswer.trim().toUpperCase();
      if (!isCorrect) {
        await this.review.schedule(userId, q.id, submitted ? 'wrong' : 'skipped').catch((e) => {
          this.logger.warn(`review.schedule failed for ${q.id}: ${e.message}`);
        });
      }
    }

    // Build answer key + full solutions for the student's review (teacher-grade)
    const review = questions.map((q) => {
      const submitted = answers.find((a) => a.questionId === q.id)?.selectedOption ?? null;
      const isCorrect =
        submitted && submitted.trim().toUpperCase() === q.correctAnswer.trim().toUpperCase();
      return {
        questionId: q.id,
        question: q.questionText,
        questionHindi: q.questionTextHindi,
        examName: (q as any).exam?.name ?? null,
        year: q.year,
        shift: q.shift,
        options: (q.optionsJson as Array<{ key: string; text: string }>) ?? [],
        correctAnswer: q.correctAnswer,
        submittedAnswer: submitted,
        isCorrect: isCorrect ?? false,
        wasSkipped: !submitted,
        explanation: q.explanation,
        explanationHindi: q.explanationHindi,
        videoUrl: q.videoUrl,
        videoSource: q.videoSource,
        videoTitle: q.videoTitle,
        topicId: q.topicId,
      };
    });

    return { alreadySubmitted: false, result, review };
  }

  /** User's quiz history. */
  async getHistory(userId: string) {
    return this.prisma.dailyQuizAttempt.findMany({
      where: { userId },
      include: { dailyQuiz: true },
      orderBy: { startedAt: 'desc' },
      take: 30,
    });
  }
}
