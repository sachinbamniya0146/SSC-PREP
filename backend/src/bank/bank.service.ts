import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AttemptStatus } from '@prisma/client';

export interface QuestionCard {
  id: string;
  questionText: string;        // EN
  questionTextHindi?: string | null; // HI
  options: { key: string; text: string }[]; // text = EN
  optionsHi?: { key: string; text: string }[] | null;
  chapter: string;
  exam?: string;
  year?: number | null;
  isAnswered?: boolean;
}

@Injectable()
export class BankService {
  constructor(private prisma: PrismaService) {}

  // ---- Meta: exams, subjects, chapters ----
  async meta() {
    const [exams, subjects, total, totalHi] = await Promise.all([
      this.prisma.$queryRaw`
        SELECT e.id, e.name, e.slug, COUNT(q.id)::int AS count
        FROM exams e LEFT JOIN questions q ON q."examId" = e.id AND q."isApproved" = true
        GROUP BY e.id ORDER BY e.name;`,
      this.prisma.$queryRaw`
        SELECT s.id, s.name, s.slug, COUNT(q.id)::int AS count
        FROM subjects s LEFT JOIN questions q ON q."subjectId" = s.id AND q."isApproved" = true
        GROUP BY s.id ORDER BY s.name;`,
      this.prisma.question.count({ where: { isApproved: true } }),
      this.prisma.question.count({
        where: { isApproved: true, questionTextHindi: { not: null } },
      }),
    ]);
    return { exams, subjects, totalQuestions: total, approxHindiCovered: totalHi };
  }

  async subjects() {
    return this.prisma.$queryRaw`
      SELECT s.id, s.name, s.slug,
             COUNT(q.id)::int AS "questionCount",
             COUNT(DISTINCT q."chapterId")::int AS "chapterCount"
      FROM subjects s
      LEFT JOIN questions q ON q."subjectId" = s.id AND q."isApproved" = true
      GROUP BY s.id ORDER BY s.name;`;
  }

  async chapters(subjectId?: string, examId?: string) {
    const where = { subjectId };
    return this.prisma.$queryRaw`
      SELECT c.id, c.name, c.slug, sub.name AS subject, COUNT(q.id)::int AS count
      FROM chapters c
      JOIN subjects sub ON sub.id = c."subjectId"
      LEFT JOIN questions q ON q."chapterId" = c.id AND q."isApproved" = true AND (${examId}::text IS NULL OR q."examId" = ${examId})
      WHERE (${subjectId}::text IS NULL OR c."subjectId" = ${subjectId})
      GROUP BY c.id, sub.name
      HAVING COUNT(q.id) > 0
      ORDER BY c.name;`;
  }

  // Browse questions by filters (exam/subject/chapter), bilingual rows.
  async browse(f: { examId?: string; subjectId?: string; chapterId?: string; skip?: number; take?: number }) {
    const take = Math.min(f.take ?? 20, 50);
    const skip = f.skip ?? 0;
    const where: any = { isApproved: true };
    if (f.examId) where.examId = f.examId;
    if (f.chapterId) where.chapterId = f.chapterId;
    else if (f.subjectId) where.subjectId = f.subjectId;
    const rows = await this.prisma.question.findMany({
      where,
      include: { chapter: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      skip,
      take,
    });
    const total = await this.prisma.question.count({ where });
    const data: QuestionCard[] = rows.map((r: any) => ({
      id: r.id,
      questionText: r.questionText,
      questionTextHindi: r.questionTextHindi,
      options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text })),
      optionsHi: null,
      chapter: r.chapter?.name ?? '',
      answerVerificationStatus: r.answerVerificationStatus ?? 'UNVERIFIED_SINGLE_SOURCE',
      lastVerifiedAt: r.lastVerifiedAt ?? null,
      // exam/year handled server-side in a typed served mode
    }));
    return { total, data };
  }

  // Single question + its solution (for display during review)
  async getById(id: string) {
    const q = await this.prisma.question.findFirst({
      where: { id, isApproved: true },
      include: { chapter: { select: { name: true } } },
    });
    if (!q) throw new NotFoundException('Question not found');
    return {
      id: q.id,
      questionText: q.questionText,
      questionTextHindi: q.questionTextHindi,
      options: (q.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text })),
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      explanationHindi: q.explanationHindi,
      chapter: q.chapter?.name ?? '',
      year: q.year,
    };
  }

  // Instant-feedback practice attempt
  async attempt(userId: string, dto: { questionId: string; selectedOption: string; templateId?: string }) {
    if (!dto.questionId || !dto.selectedOption) {
      throw new BadRequestException('questionId and selectedOption required');
    }
    const q = await this.prisma.question.findFirst({ where: { id: dto.questionId, isApproved: true } });
    if (!q) throw new NotFoundException('Question not found');

    const option = dto.selectedOption.trim().toUpperCase();
    const correct = option === q.correctAnswer;

    // Log attempt as a TestAttempt (single-question practice set)
    const templateId = dto.templateId ?? 'tpl-practice';
    // Ensure the practice template exists (FK constraint)
    try {
      await this.prisma.testTemplate.upsert({
        where: { id: templateId },
        update: {},
        create: {
          id: templateId,
          title: 'Quick Practice',
          description: 'Instant-feedback single-question practice',
          type: 'DAILY_PRACTICE',
          durationMinutes: 0,
          totalQuestions: 1,
        },
      });
    } catch (e) {
      // template may already exist with different required fields — ignore
      if (!(e as any)?.code?.startsWith?.('P2002')) throw e;
    }
    const attempt = await this.prisma.testAttempt.create({
      data: {
        userId,
        testTemplateId: templateId,
        status: AttemptStatus.SUBMITTED,
        score: correct ? 1 : 0,
        totalCorrect: correct ? 1 : 0,
        totalWrong: correct ? 0 : 1,
        totalSkipped: 0,
        accuracyPercent: correct ? 100 : 0,
        submittedAt: new Date(),
      },
    });
    await this.prisma.attemptAnswer.create({
      data: {
        testAttemptId: attempt.id,
        questionId: q.id,
        selectedOption: option,
        isCorrect: correct,
      },
    });

    return {
      correct,
      correctAnswer: q.correctAnswer,
      selectedOption: option,
      explanation: q.explanation,
      explanationHindi: q.explanationHindi,
      scoreDelta: correct ? q.marks : -q.negativeMarks,
    };
  }

  // Chapter-wise PYQ: get all questions for a chapter, with year filters
  async chapterPyq(f: { chapterId: string; examId?: string; year?: number; skip?: number; take?: number }) {
    const take = Math.min(f.take ?? 25, 50);
    const skip = f.skip ?? 0;
    const where: any = { isApproved: true, chapterId: f.chapterId };
    if (f.examId) where.examId = f.examId;
    if (f.year) where.year = f.year;
    const rows = await this.prisma.question.findMany({
      where,
      include: { exam: { select: { name: true } } },
      orderBy: [{ year: 'desc' }, { createdAt: 'asc' }],
      skip,
      take,
    });
    const total = await this.prisma.question.count({ where });
    const years = await this.prisma.question.groupBy({
      by: ['year'],
      where: { isApproved: true, chapterId: f.chapterId, year: { not: null } },
      _count: true,
      orderBy: { year: 'desc' },
    });
    return {
      total,
      years: years.map(y => ({ year: y.year, count: y._count })),
      questions: rows.map(r => ({
        id: r.id,
        questionText: r.questionText,
        questionTextHindi: r.questionTextHindi,
        options: (r.optionsJson as any[]).map(o => ({ key: o.key, text: o.text })),
        correctAnswer: r.correctAnswer,
        explanation: r.explanation,
        explanationHindi: r.explanationHindi,
        exam: r.exam?.name,
        year: r.year,
        verificationStatus: r.answerVerificationStatus,
        difficulty: r.difficulty,
      })),
    };
  }
  // ---- Verification Pipeline ----

  async verifyQuestion(questionId: string, status: string, adminId?: string) {
    const validStatuses = ['VERIFIED_OFFICIAL', 'VERIFIED_MULTI_SOURCE', 'VERIFIED_COMPUTED', 'UNVERIFIED_SINGLE_SOURCE', 'DISPUTED'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException(`Invalid verification status: ${status}`);
    }

    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!question) throw new NotFoundException('Question not found');

    const updated = await this.prisma.question.update({
      where: { id: questionId },
      data: {
        answerVerificationStatus: status,
        lastVerifiedAt: new Date(),
      },
    });

    // Create AuditLog entry
    if (adminId) {
      await this.prisma.auditLog.create({
        data: {
          userId: adminId,
          action: 'VERIFICATION_UPDATED',
          targetEntity: 'Question',
          entityId: questionId,
          metadataJson: {
            previousStatus: question.answerVerificationStatus,
            newStatus: status,
          },
        } as any,
      });
    }

    return {
      id: updated.id,
      answerVerificationStatus: updated.answerVerificationStatus,
      lastVerifiedAt: updated.lastVerifiedAt,
    };
  }

  async getVerificationStats() {
    const rows = await this.prisma.question.groupBy({
      by: ['answerVerificationStatus'],
      _count: true,
      where: { isApproved: true },
    });
    const allStatuses = ['VERIFIED_OFFICIAL', 'VERIFIED_MULTI_SOURCE', 'VERIFIED_COMPUTED', 'UNVERIFIED_SINGLE_SOURCE', 'DISPUTED'];
    const stats: Record<string, number> = {};
    for (const s of allStatuses) stats[s] = 0;
    for (const row of rows) stats[row.answerVerificationStatus] = row._count;
    return { stats, total: Object.values(stats).reduce((a, b) => a + b, 0) };
  }

  async getQuestionWithVerification(questionId: string) {
    const q = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: { chapter: { select: { name: true } }, exam: { select: { name: true } } },
    });
    if (!q) throw new NotFoundException('Question not found');
    return {
      id: q.id,
      questionText: q.questionText,
      questionTextHindi: q.questionTextHindi,
      options: (q.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text })),
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      explanationHindi: q.explanationHindi,
      chapter: q.chapter?.name ?? '',
      exam: q.exam?.name ?? null,
      year: q.year,
      answerVerificationStatus: q.answerVerificationStatus,
      lastVerifiedAt: q.lastVerifiedAt,
    };
  }

  async getSet(f: { examId?: string; subjectId?: string; count?: number }) {
    const takeN = Math.min(f.count ?? 10, 25);
    const where: any = { isApproved: true };
    if (f.examId) where.examId = f.examId;
    if (f.subjectId) where.subjectId = f.subjectId;
    const rows = await this.prisma.question.findMany({
      where,
      include: { chapter: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 1000,
    });
    const shuffled = rows.slice().sort(() => Math.random() - 0.5).slice(0, takeN);
    return {
      count: shuffled.length,
      questions: shuffled.map((r: any) => ({
        id: r.id,
        questionText: r.questionText,
        questionTextHindi: r.questionTextHindi,
        options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text })),
        chapter: r.chapter?.name ?? '',
      })),
    };
  }
}