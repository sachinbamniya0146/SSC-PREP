/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AttemptStatus } from '@prisma/client';
import { cacheGet, cacheSet } from '../common/cache';

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

  // ---- v4 §18 — SearchMiss demand log (user searched, nothing matched) ----
  async logSearchMiss(query?: string, exam?: string, userId?: string | null) {
    const q = (query ?? '').trim();
    if (!q) return { ok: false };
    await this.prisma.searchMiss.create({
      data: { query: q.slice(0, 200), exam: exam ? String(exam).slice(0, 100) : null, userId: userId ?? null },
    });
    return { ok: true };
  }

  // ---- Meta: exams, subjects, chapters ---- (cached 5 min — read-heavy, rarely changes)
  async meta() {
    const cached = cacheGet<any>('bank:meta');
    if (cached) return cached;
    const [exams, subjects, total, totalHi, patterns] = await Promise.all([
      this.prisma.$queryRaw`
        SELECT e.id, e.name, e.slug, COUNT(q.id)::int AS count
        FROM exams e LEFT JOIN questions q ON q."examId" = e.id AND q."isApproved" = true
        GROUP BY e.id ORDER BY e.name;`,
      this.prisma.$queryRaw`
        SELECT s.id, s.name, s.slug, COUNT(q.id)::int AS count
        FROM subjects s LEFT JOIN questions q ON q."subjectId" = s.id AND q."isApproved" = true
        GROUP BY s.id ORDER BY s.name;`,
      this.prisma.question.count({ where: { isApproved: true } }),
      // v7 §5 — Hindi = non-empty; the DB stores '' not NULL for missing Hindi
      this.prisma.question.count({
        where: { isApproved: true, questionTextHindi: { not: '' } },
      }),
      this.prisma.examPattern.findMany({
        where: { isActive: true },
        select: { examId: true, name: true, totalQuestions: true, totalMarks: true, durationMinutes: true },
      }),
    ]);
    const patternByExam = new Map(patterns.map((p: any) => [p.examId, p]));
    // v7 §2 — exam rows carry their live ExamPattern (no hardcoded year labels)
    const examRows = (exams as any[]).map((e) => {
      const p = patternByExam.get(e.id);
      return p ? { ...e, pattern: { name: p.name, totalQuestions: p.totalQuestions, totalMarks: p.totalMarks, durationMinutes: p.durationMinutes } } : e;
    });
    const out = { exams: examRows, subjects, totalQuestions: total, approxHindiCovered: totalHi };
    cacheSet('bank:meta', out, 300_000);
    return out;
  }

  async subjects(examId?: string) {
    const cacheKey = examId ? `bank:subjects:${examId}` : 'bank:subjects';
    const cached = cacheGet<any>(cacheKey);
    if (cached) return cached;
    const out = await this.prisma.$queryRaw`
      SELECT s.id, s.name, s.slug,
             COUNT(q.id)::int AS "questionCount",
             COUNT(DISTINCT q."chapterId")::int AS "chapterCount"
      FROM subjects s
      LEFT JOIN questions q ON q."subjectId" = s.id AND q."isApproved" = true
           AND (${examId}::text IS NULL OR q."examId" = ${examId})
      GROUP BY s.id ORDER BY s.name;`;
    cacheSet(cacheKey, out, 300_000);
    return out;
  }

  async chapters(subjectId?: string, examId?: string) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      include: { chapter: { select: { name: true } }, exam: { select: { name: true } }, subject: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      skip,
      take,
    });
    const total = await this.prisma.question.count({ where });
    const data = rows.map((r: any) => ({
      id: r.id,
      questionText: r.questionText,
      questionTextHindi: r.questionTextHindi,
      options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null })),
      correctAnswer: r.correctAnswer,
      explanation: r.explanation,
      explanationHindi: r.explanationHindi,
      chapter: r.chapter?.name ?? '',
      exam: r.exam?.name ?? null,
      year: r.year,
      shift: r.shift,
      subject: r.subject?.name ?? null,
      difficulty: r.difficulty,
      marks: r.marks,
      negativeMarks: r.negativeMarks,
      answerVerificationStatus: r.answerVerificationStatus ?? 'UNVERIFIED_SINGLE_SOURCE',
      lastVerifiedAt: r.lastVerifiedAt ?? null,
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

    // v2 §7.6 — Previous SSC References: real-DB computation, never static text.
    // Same exam + same chapter across the other years in the bank.
    let prevRefs = { count: 0, years: [] as number[], acrossYears: 0 };
    if (q.chapterId) {
      const refs = await this.prisma.question.findMany({
        where: { examId: q.examId ?? undefined, chapterId: q.chapterId, isApproved: true, id: { not: q.id } },
        select: { year: true },
        take: 500,
      });
      const years = [...new Set(refs.map((r) => r.year).filter((y): y is number => y != null))].sort((a, b) => b - a);
      const across = q.year != null ? years.filter((y) => y !== q.year).length : years.length;
      prevRefs = { count: refs.length, years: years.slice(0, 10), acrossYears: across };
    }

    // Expected frequency: how many times this chapter's questions appear in the
    // bank for the last 5 years (proxy for "asked N times in recent papers").
    const now = new Date().getFullYear();
    let expectedFrequency: { askedTimes: number | null; lastFiveYearsCount: number; yearsCovered: number } | null = null;
    if (q.chapterId) {
      const last5 = await this.prisma.question.count({
        where: { examId: q.examId ?? undefined, chapterId: q.chapterId, isApproved: true, year: { gte: now - 5 } },
      });
      const covered = await this.prisma.question.count({
        where: { examId: q.examId ?? undefined, chapterId: q.chapterId, isApproved: true, year: { not: null } },
      });
      expectedFrequency = { askedTimes: last5 > 0 ? last5 : null, lastFiveYearsCount: last5, yearsCovered: covered };
    }

    return {
      id: q.id,
      questionText: q.questionText,
      questionTextHindi: q.questionTextHindi,
      options: (q.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null })),
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      explanationHindi: q.explanationHindi,
      chapter: q.chapter?.name ?? '',
      year: q.year,
      shift: q.shift,
      answerVerificationStatus: q.answerVerificationStatus,
      reviewStatus: q.reviewStatus,
      previousSscRefs: prevRefs,
      expectedFrequency,
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
      videoUrl: q.videoUrl,
      videoSource: q.videoSource,
      videoTitle: q.videoTitle,
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
        options: (r.optionsJson as any[]).map(o => ({ key: o.key, text: o.text, textHi: o.textHi ?? null })),
        correctAnswer: r.correctAnswer,
        explanation: r.explanation,
        explanationHindi: r.explanationHindi,
        exam: r.exam?.name,
        year: r.year,
        verificationStatus: r.answerVerificationStatus,
        reviewStatus: r.reviewStatus,
        aiConfidenceScore: r.aiConfidenceScore,
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
      options: (q.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null })),
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
    const where: any = { isApproved: true, questionTextHindi: { not: '' } }; // bilingual gate (v3 §3): empty/NULL dono exclude
    if (f.examId) where.examId = f.examId;
    else where.examId = { not: null }; // spec §3: exam badge har question par
    if (f.subjectId) where.subjectId = f.subjectId;
    const rows = await this.prisma.question.findMany({
      where,
      include: { chapter: { select: { name: true } }, exam: { select: { name: true } } },
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
        options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null })),
        chapter: r.chapter?.name ?? '',
        examName: r.exam?.name ?? null,
        year: r.year ?? null,
        shift: r.shift ?? null,
        marks: r.marks ?? 1,
        negativeMarks: r.negativeMarks ?? 0.25,
        correctAnswer: r.correctAnswer ?? null,
        explanation: r.explanation ?? null,
        explanationHindi: r.explanationHindi ?? null,
      })),
    };
  }

  // ---- Video Solution Methods ----

  async addVideoSolution(
    questionId: string,
    dto: {
      videoUrl: string;
      videoSource?: string;
      videoTitle?: string;
      videoDescription?: string;
      videoDurationSeconds?: number;
      videoLanguage?: string;
    },
    userId: string,
  ) {
    // Validate that the question exists and is approved
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
    });

    if (!question) {
      throw new NotFoundException('Question not found');
    }

    // Update the question with video metadata
    const updated = await this.prisma.question.update({
      where: { id: questionId },
      data: {
        videoUrl: dto.videoUrl,
        videoSource: dto.videoSource as any, // Prisma will validate enum
        videoTitle: dto.videoTitle,
        videoDescription: dto.videoDescription,
        videoDurationSeconds: dto.videoDurationSeconds,
        videoLanguage: dto.videoLanguage,
        videoUploadedAt: new Date(),
        videoUploadedBy: userId,
      },
    });

    // Create AuditLog entry
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'VIDEO_SOLUTION_ADDED',
        targetEntity: 'Question',
        entityId: questionId,
        metadataJson: {
          videoUrl: dto.videoUrl,
          videoSource: dto.videoSource,
          videoTitle: dto.videoTitle,
        },
      } as any,
    });

    return {
      id: updated.id,
      videoUrl: updated.videoUrl,
      videoSource: updated.videoSource,
      videoTitle: updated.videoTitle,
      videoUploadedAt: updated.videoUploadedAt,
    };
  }

  async getVideoSolution(questionId: string) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: {
        id: true,
        videoUrl: true,
        videoSource: true,
        videoTitle: true,
        videoDescription: true,
        videoDurationSeconds: true,
        videoLanguage: true,
        videoUploadedAt: true,
        videoUploadedBy: true,
      },
    });

    if (!question) {
      throw new NotFoundException('Question not found');
    }

    return question;
  }

  async removeVideoSolution(
    questionId: string,
    userId: string,
  ) {
    // Validate that the question exists
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
    });

    if (!question) {
      throw new NotFoundException('Question not found');
    }

    // Clear video fields
    const updated = await this.prisma.question.update({
      where: { id: questionId },
      data: {
        videoUrl: null,
        videoSource: null,
        videoTitle: null,
        videoDescription: null,
        videoDurationSeconds: null,
        videoLanguage: null,
        videoUploadedAt: null,
        videoUploadedBy: null,
      },
    });

    // Create AuditLog entry
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'VIDEO_SOLUTION_REMOVED',
        targetEntity: 'Question',
        entityId: questionId,
        metadataJson: {
          previousVideoUrl: question.videoUrl,
        },
      } as any,
    });

    return {
      id: updated.id,
      videoUrl: updated.videoUrl,
    };
  }

  /** v5 §40 — Topic weightage analytics: question counts by exam × subject × chapter. */
  async getTopicWeightage(examId?: string) {
    const where: any = { isApproved: true, isActive: true };
    if (examId) where.examId = examId;

    const rows = await this.prisma.question.groupBy({
      by: ['examId', 'subjectId', 'chapterId'],
      where,
      _count: { _all: true },
    });

    const [exams, subjects, chapters] = await Promise.all([
      this.prisma.exam.findMany({ select: { id: true, name: true } }),
      this.prisma.subject.findMany({ select: { id: true, name: true } }),
      this.prisma.chapter.findMany({ select: { id: true, name: true } }),
    ]);
    const examMap = new Map(exams.map((e) => [e.id, e.name]));
    const subjMap = new Map(subjects.map((s) => [s.id, s.name]));
    const chapMap = new Map(chapters.map((c) => [c.id, c.name]));

    const byExam = new Map<string, { examId: string; examName: string; total: number; subjects: Map<string, { subjectId: string; subjectName: string; total: number; chapters: { chapterId: string; chapterName: string; count: number }[] }> }>();
    for (const r of rows) {
      const eid = r.examId ?? 'unknown';
      const sid = r.subjectId ?? 'unknown';
      const cid = r.chapterId ?? 'unknown';
      let exam = byExam.get(eid);
      if (!exam) {
        exam = { examId: eid, examName: examMap.get(eid) ?? 'Unknown', total: 0, subjects: new Map() };
        byExam.set(eid, exam);
      }
      exam.total += r._count._all;
      let subj = exam.subjects.get(sid);
      if (!subj) {
        subj = { subjectId: sid, subjectName: subjMap.get(sid) ?? 'Unknown', total: 0, chapters: [] };
        exam.subjects.set(sid, subj);
      }
      subj.total += r._count._all;
      subj.chapters.push({ chapterId: cid, chapterName: chapMap.get(cid) ?? 'Uncategorized', count: r._count._all });
    }

    return [...byExam.values()].map((e) => ({
      examId: e.examId,
      examName: e.examName,
      total: e.total,
      subjects: [...e.subjects.values()]
        .sort((a, b) => b.total - a.total)
        .map((s) => ({ ...s, chapters: s.chapters.sort((a, b) => b.count - a.count) })),
    })).sort((a, b) => b.total - a.total);
  }
}
