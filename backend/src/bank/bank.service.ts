/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, BadRequestException, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AttemptStatus, Prisma } from '@prisma/client';
import { cacheGet, cacheSet } from '../common/cache';
import { PUBLISHED_QUESTION_WHERE } from '../common/question-visibility';

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

// BUG FIX ("Subject not found: quantitative-aptitude" crash on Start Mock):
// TestsService.paper()/sectionalExamForFamily() look up subjects by slug and
// hard-throw a BadRequestException if a row is missing. The real production
// database (confirmed via GET /bank/meta) already has 6 Subject rows —
// computer, english, general_awareness, hindi, quantitative_aptitude,
// reasoning — using UNDERSCORE slugs (except 'english', which has no
// '-comprehension' suffix at all). TestsService has been corrected to use
// these exact slugs instead of the hyphenated ones it had before. This
// seed list is kept in sync with that same underscore convention purely as
// a safety net for a brand-new/empty database (e.g. first-ever deploy
// before any import script has run) — on an existing DB like the current
// production one, every one of these already exists so nothing is created.
const CORE_SUBJECTS: { slug: string; name: string }[] = [
  { slug: 'reasoning', name: 'Reasoning' },
  { slug: 'quantitative_aptitude', name: 'Quantitative Aptitude' },
  { slug: 'english', name: 'English' },
  { slug: 'general_awareness', name: 'General Awareness' },
];

@Injectable()
export class BankService implements OnModuleInit {
  private readonly logger = new Logger(BankService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.seedCoreSubjects();
  }

  /** Idempotent: create any of the 4 core subjects that don't exist yet. */
  private async seedCoreSubjects(): Promise<void> {
    for (const s of CORE_SUBJECTS) {
      const existing = await this.prisma.subject.findUnique({ where: { slug: s.slug } });
      if (existing) continue;
      await this.prisma.subject.create({ data: { slug: s.slug, name: s.name } });
      this.logger.log(`Seeded missing core subject: ${s.slug}`);
    }
  }

  /**
   * FIX (CRITICAL answer-key leak — same bug class already fixed in
   * bookmarks.service.ts / search.service.ts / question-bank-practice.service.ts,
   * but never applied here even though this is the PRIMARY question-browsing
   * surface): browse(), getById(), chapterPyq() and getSet() below used to
   * return `correctAnswer` + `explanation` unconditionally to any logged-in
   * user, with no check that the user had ever actually attempted the
   * question. Any free (non-premium) logged-in student could page through
   * `/bank/questions?skip=0..N` and dump the entire answer key for the
   * whole question bank without answering a single question — completely
   * bypassing the "reveal only after answered/skipped/completed" rule the
   * rest of the app enforces on purpose. The `isAnswered` field already
   * declared on the QuestionCard interface above is the tell that this gate
   * was intended from day one but never wired up.
   *
   * This mirrors bookmarks.service.ts's list() gate exactly: a question's
   * answer counts as "revealed" once the student has a genuine attempt
   * record for it — either a scored TestAttempt (mock/sectional/daily-test,
   * via AttemptAnswer) or an in-progress/completed question-bank practice
   * set whose `answers` blob includes that question.
   */
  private async getAttemptedQuestionIds(userId: string | undefined | null, questionIds: string[]): Promise<Set<string>> {
    const attempted = new Set<string>();
    if (!userId || questionIds.length === 0) return attempted;

    const answeredInAttempts = await this.prisma.attemptAnswer.findMany({
      where: { testAttempt: { userId }, questionId: { in: questionIds } },
      select: { questionId: true },
    });
    for (const a of answeredInAttempts) attempted.add(a.questionId);

    if (attempted.size < questionIds.length) {
      const practiceSets = await this.prisma.questionBankSet.findMany({
        // Prisma 5.x: a nullable Json column can't be filtered with a plain
        // `null` literal (TS2322) — it must be one of Prisma.DbNull /
        // Prisma.JsonNull / Prisma.AnyNull. AnyNull excludes both possible
        // "no value" representations (SQL NULL and a stored literal JSON
        // null), which is exactly the "has answers" behavior this had before.
        where: { userId, answers: { not: Prisma.AnyNull } },
        select: { answers: true },
      });
      for (const set of practiceSets) {
        const answered = set.answers as Record<string, unknown> | null;
        if (!answered) continue;
        for (const qid of questionIds) {
          if (attempted.has(qid)) continue;
          if (Object.prototype.hasOwnProperty.call(answered, qid)) attempted.add(qid);
        }
      }
    }
    return attempted;
  }

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
      // FIX Error #8: raw SQL now matches PUBLISHED_QUESTION_WHERE
      // (isApproved AND isActive AND NOT autoSuspended), not isApproved alone.
      this.prisma.$queryRaw`
        SELECT e.id, e.name, e.slug, COUNT(q.id)::int AS count
        FROM exams e LEFT JOIN questions q ON q."examId" = e.id
          AND q."isApproved" = true AND q."isActive" = true AND q."autoSuspended" = false
        GROUP BY e.id ORDER BY e.name;`,
      this.prisma.$queryRaw`
        SELECT s.id, s.name, s.slug, COUNT(q.id)::int AS count
        FROM subjects s LEFT JOIN questions q ON q."subjectId" = s.id
          AND q."isApproved" = true AND q."isActive" = true AND q."autoSuspended" = false
        GROUP BY s.id ORDER BY s.name;`,
      this.prisma.question.count({ where: { ...PUBLISHED_QUESTION_WHERE } }),
      // v7 §5 — Hindi = non-empty; the DB stores '' not NULL for missing Hindi
      this.prisma.question.count({
        where: { ...PUBLISHED_QUESTION_WHERE, questionTextHindi: { not: '' } },
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

  // ---- Content coverage report (admin) ----
  // Answers exactly: "kitne question kis exam ke kis subject ke available
  // hain, aur unme se kitne translate (Hindi) hain" — a per exam × per
  // subject breakdown that neither meta() nor subjects() gives on its own
  // (meta() only totals exam-wise OR subject-wise separately, never both
  // together; neither one reports translation status). No endpoint like
  // this existed before, so the only way to answer this question was a
  // manual SQL query against the live DB.
  async contentCoverageReport() {
    const rows = await this.prisma.$queryRaw<
      Array<{
        examName: string | null;
        subjectName: string | null;
        totalQuestions: number;
        approvedLive: number;
        hindiTranslated: number;
        humanVerifiedTranslation: number;
      }>
    >`
      SELECT
        e.name AS "examName",
        s.name AS "subjectName",
        COUNT(q.id)::int AS "totalQuestions",
        COUNT(q.id) FILTER (
          WHERE q."isApproved" = true AND q."isActive" = true AND q."autoSuspended" = false
        )::int AS "approvedLive",
        COUNT(q.id) FILTER (
          WHERE q."questionTextHindi" IS NOT NULL AND q."questionTextHindi" <> ''
        )::int AS "hindiTranslated",
        COUNT(q.id) FILTER (
          WHERE q."translationStatus" = 'HUMAN_VERIFIED'
        )::int AS "humanVerifiedTranslation"
      FROM questions q
      LEFT JOIN exams e ON e.id = q."examId"
      LEFT JOIN subjects s ON s.id = q."subjectId"
      GROUP BY e.name, s.name
      ORDER BY e.name NULLS LAST, s.name NULLS LAST;
    `;
    const totals = rows.reduce(
      (acc, r) => {
        acc.totalQuestions += r.totalQuestions;
        acc.approvedLive += r.approvedLive;
        acc.hindiTranslated += r.hindiTranslated;
        acc.humanVerifiedTranslation += r.humanVerifiedTranslation;
        return acc;
      },
      { totalQuestions: 0, approvedLive: 0, hindiTranslated: 0, humanVerifiedTranslation: 0 },
    );
    return { rows, totals };
  }

  // ---- Content coverage report BY YEAR (exam × subject × year) ----
  // Sachin's request: "kis exam ke kis subject key kis year ke kitne
  // questions hey" — contentCoverageReport() above stops at exam × subject
  // (no year axis at all); this adds year as a third grouping level so the
  // admin can see, e.g., "SSC CGL → Reasoning → 2023: 42 questions,
  // 2024: 18 questions" and immediately spot which exam/subject/year
  // combination still needs more PYQs uploaded. Questions with no year set
  // are grouped under a NULL year row (labelled "(No Year)" by the
  // frontend) — deliberately kept visible rather than dropped, since a
  // missing year is itself something the admin needs to fix (see
  // scripts/audit-questions.mjs → missingYear).
  async contentCoverageReportByYear() {
    const rows = await this.prisma.$queryRaw<
      Array<{
        examName: string | null;
        subjectName: string | null;
        year: number | null;
        totalQuestions: number;
        approvedLive: number;
        hindiTranslated: number;
      }>
    >`
      SELECT
        e.name AS "examName",
        s.name AS "subjectName",
        q."year" AS "year",
        COUNT(q.id)::int AS "totalQuestions",
        COUNT(q.id) FILTER (
          WHERE q."isApproved" = true AND q."isActive" = true AND q."autoSuspended" = false
        )::int AS "approvedLive",
        COUNT(q.id) FILTER (
          WHERE q."questionTextHindi" IS NOT NULL AND q."questionTextHindi" <> ''
        )::int AS "hindiTranslated"
      FROM questions q
      LEFT JOIN exams e ON e.id = q."examId"
      LEFT JOIN subjects s ON s.id = q."subjectId"
      GROUP BY e.name, s.name, q."year"
      ORDER BY e.name NULLS LAST, s.name NULLS LAST, q."year" DESC NULLS LAST;
    `;
    const totals = rows.reduce(
      (acc, r) => {
        acc.totalQuestions += r.totalQuestions;
        acc.approvedLive += r.approvedLive;
        acc.hindiTranslated += r.hindiTranslated;
        return acc;
      },
      { totalQuestions: 0, approvedLive: 0, hindiTranslated: 0 },
    );
    return { rows, totals };
  }

  // ---- Content coverage drill-down (exam × subject × chapter) ----
  // BUG FIX / NEW FEATURE ("har exam ke har subject or chapter ka status
  // dikhna chahiye, kitna aur konsa question dala hai"): contentCoverageReport()
  // above stops at exam × subject — it can't tell an admin WHICH chapter
  // inside a subject is empty vs. covered. listAllChaptersForAdmin() lists
  // every chapter but with no per-exam question counts at all. Neither
  // answers "SSC CHSL → Quantitative Aptitude → Percentage: kitne questions
  // hain, aur kaunsa exam". This method walks Exam → Subject → Chapter and
  // reports a real count for every leaf, INCLUDING chapters with zero
  // questions for that exam (deliberately not filtered out — an empty cell
  // is exactly the information admin needs to know what to upload next).
  async contentCoverageDrilldown() {
    const [exams, subjects, chapters, counts] = await Promise.all([
      this.prisma.exam.findMany({
        select: { id: true, name: true, slug: true, code: true, isActive: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.subject.findMany({
        select: { id: true, name: true, slug: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.chapter.findMany({
        select: { id: true, name: true, slug: true, subjectId: true },
        orderBy: { name: 'asc' },
      }),
      // Approved+live count AND total count (including pending/unapproved),
      // grouped by exam+chapter — one raw query instead of N+1 per cell.
      this.prisma.$queryRaw<
        Array<{ examId: string | null; chapterId: string | null; total: number; approvedLive: number }>
      >`
        SELECT q."examId", q."chapterId",
               COUNT(q.id)::int AS total,
               COUNT(q.id) FILTER (
                 WHERE q."isApproved" = true AND q."isActive" = true AND q."autoSuspended" = false
               )::int AS "approvedLive"
        FROM questions q
        WHERE q."examId" IS NOT NULL AND q."chapterId" IS NOT NULL
        GROUP BY q."examId", q."chapterId";
      `,
    ]);

    const countKey = (examId: string, chapterId: string) => `${examId}:${chapterId}`;
    const countMap = new Map(counts.map((c) => [countKey(c.examId!, c.chapterId!), c]));
    const chaptersBySubject = new Map<string, typeof chapters>();
    for (const ch of chapters) {
      const list = chaptersBySubject.get(ch.subjectId) ?? [];
      list.push(ch);
      chaptersBySubject.set(ch.subjectId, list);
    }

    const tree = exams.map((exam) => {
      const subjectRows = subjects.map((subj) => {
        const chapterRows = (chaptersBySubject.get(subj.id) ?? []).map((ch) => {
          const c = countMap.get(countKey(exam.id, ch.id));
          return {
            chapterId: ch.id,
            chapterName: ch.name,
            chapterSlug: ch.slug,
            total: c?.total ?? 0,
            approvedLive: c?.approvedLive ?? 0,
          };
        });
        const subjectTotal = chapterRows.reduce((s, c) => s + c.total, 0);
        const subjectApproved = chapterRows.reduce((s, c) => s + c.approvedLive, 0);
        return {
          subjectId: subj.id,
          subjectName: subj.name,
          subjectSlug: subj.slug,
          total: subjectTotal,
          approvedLive: subjectApproved,
          chapters: chapterRows,
        };
      });
      const examTotal = subjectRows.reduce((s, sb) => s + sb.total, 0);
      const examApproved = subjectRows.reduce((s, sb) => s + sb.approvedLive, 0);
      return {
        examId: exam.id,
        examName: exam.name,
        examSlug: exam.slug,
        examCode: exam.code,
        isActive: exam.isActive,
        total: examTotal,
        approvedLive: examApproved,
        subjects: subjectRows,
      };
    });

    return { exams: tree };
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
      LEFT JOIN questions q ON q."subjectId" = s.id
           AND q."isApproved" = true AND q."isActive" = true AND q."autoSuspended" = false
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
      LEFT JOIN questions q ON q."chapterId" = c.id
           AND q."isApproved" = true AND q."isActive" = true AND q."autoSuspended" = false
           AND (${examId}::text IS NULL OR q."examId" = ${examId})
      WHERE (${subjectId}::text IS NULL OR c."subjectId" = ${subjectId})
      GROUP BY c.id, sub.name
      HAVING COUNT(q.id) > 0
      ORDER BY c.name;`;
  }

  // Session 18+ — Year-wise custom test picker: distinct years available
  // for an exam, from the PYQ metadata already set on upload (SourcePdf/
  // Question.year) — no new admin workflow needed. Powers the year
  // dropdown on /year-wise before the student narrows by subject/chapter/
  // topic or hits "Full Paper".
  async years(examId?: string) {
    const cacheKey = examId ? `bank:years:${examId}` : 'bank:years';
    const cached = cacheGet<any>(cacheKey);
    if (cached) return cached;
    const out = await this.prisma.$queryRaw`
      SELECT q.year AS year, COUNT(q.id)::int AS "questionCount"
      FROM questions q
      WHERE q."isApproved" = true AND q."isActive" = true AND q."autoSuspended" = false
        AND q.year IS NOT NULL
        AND (${examId}::text IS NULL OR q."examId" = ${examId})
      GROUP BY q.year
      ORDER BY q.year DESC;`;
    cacheSet(cacheKey, out, 300_000);
    return out;
  }

  // Topic picker for the year-wise test builder's "chapter → topic"
  // drill-down. Same HAVING-count-> 0 pattern as chapters() above so the UI
  // never offers a topic with zero actual questions in it.
  //
  // BUGFIX (Session 20 — "exam-wise button should only give that exam's
  // PYQs" audit): unlike subjects()/chapters()/years() just above — which
  // all accept an optional examId and filter by it — this method never did.
  // /year-wise stashes an examId as soon as the student picks an exam and
  // DOES pass it into every other picker (subjects/chapters/years), but the
  // topics fetch was the one call in that same drill-down that silently
  // dropped it. Result: a topic's listed count (and whether it even shows
  // up at all) came from questions across EVERY exam, not just the one the
  // student selected. A student could pick a topic that looked non-empty,
  // then hit "Start Customised Test" and get "No bilingual questions
  // available for this selection yet" from yearWiseStart() — because
  // yearWiseStart() DOES correctly scope by examId, so a topic whose
  // questions all belonged to a different exam produced zero real rows for
  // this exam+year+topic combination. Adding the same optional examId
  // parameter here, same pattern as subjects()/chapters()/years(), closes
  // that gap so the topic list a student sees is always honest for the
  // exam they actually picked.
  async topics(chapterId?: string, examId?: string) {
    return this.prisma.$queryRaw`
      SELECT t.id, t.name, t.slug, COUNT(q.id)::int AS count
      FROM topics t
      LEFT JOIN questions q ON q."topicId" = t.id
           AND q."isApproved" = true AND q."isActive" = true AND q."autoSuspended" = false
           AND (${examId}::text IS NULL OR q."examId" = ${examId})
      WHERE (${chapterId}::text IS NULL OR t."chapterId" = ${chapterId})
      GROUP BY t.id
      HAVING COUNT(q.id) > 0
      ORDER BY t.name;`;
  }

  // ---- Admin chapter management ----
  // MISSING-FEATURE FIX: bulk question upload (bank-upload.service.ts)
  // *requires* a valid, pre-existing chapterId on every row/object — it
  // will not create one on the fly (see validateReferences()). But there
  // was no way anywhere in the API to actually CREATE a chapter. The
  // upload template's own instructions sheet even tells admins to fetch
  // IDs from "GET /api/v1/admin/exams" and "GET /api/v1/admin/subjects" —
  // routes that don't exist either; the real equivalents are the public
  // /bank/meta and /bank/subjects endpoints. On a brand-new database with
  // zero chapters (like the current one), this made bulk question upload
  // completely impossible: every row would fail validateReferences() with
  // "chapterId not found" and there was no way to fix that. These two
  // methods (+ their /bank/admin/chapters routes below) close that gap.
  //
  // listAllChaptersForAdmin() deliberately does NOT filter by
  // `HAVING COUNT(q.id) > 0` the way chapters() above does (that filter is
  // for the student-facing browse UI, which shouldn't show empty chapters)
  // — an admin managing content needs to see freshly-created, still-empty
  // chapters too, otherwise a chapter they just created would look like it
  // never got created.
  async listAllChaptersForAdmin(subjectId?: string) {
    return this.prisma.chapter.findMany({
      where: subjectId ? { subjectId } : undefined,
      select: { id: true, name: true, slug: true, subjectId: true, subject: { select: { name: true, slug: true } } },
      orderBy: { name: 'asc' },
    });
  }

  /** Idempotent by (subjectId, slug): re-creating with the same name is a no-op, returns the existing row. */
  async createChapter(subjectId: string, name: string): Promise<{ id: string; name: string; slug: string; subjectId: string }> {
    const subject = await this.prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) throw new BadRequestException(`Subject not found: ${subjectId}`);
    const trimmedName = (name ?? '').trim();
    if (!trimmedName) throw new BadRequestException('Chapter name is required');
    const slug = trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'chapter';
    const existing = await this.prisma.chapter.findUnique({ where: { subjectId_slug: { subjectId, slug } } });
    if (existing) return existing;
    return this.prisma.chapter.create({ data: { subjectId, name: trimmedName, slug } });
  }

  // ---- Question review queue (bulk-upload questions, not PDF-ingestion) ----
  // BUG FIX / MISSING FEATURE ("admin pura ek ek question ko dekh paye"):
  // approve/reject/bulk-approve endpoints already existed in
  // pdf-ingestion.controller.ts, but EVERY ONE of them is scoped to a
  // batchId (GET /pdf-ingestion/batches/:id/questions) — they only ever
  // find questions that have an importBatchId set. bank-upload.service.ts's
  // createQuestion() (the actual method every Excel/CSV/JSON/Word bulk
  // upload funnels through) never sets importBatchId at all. The result:
  // a question uploaded via Excel without a Hindi translation goes
  // isApproved:false / reviewStatus:'PENDING' (see createQuestion()'s
  // bilingual gate) and then has NO review queue anywhere that will ever
  // find it — not the PDF-ingestion one (wrong source), not anywhere else
  // (didn't exist). It sits PENDING forever with no way for an admin to
  // even see it, let alone approve/edit/reject it. These three methods
  // are a source-agnostic review queue: list/approve/reject by Question.id
  // directly, no batch required.
  async listPendingQuestions(filters: { examId?: string; subjectId?: string; chapterId?: string; skip?: number; take?: number }) {
    const where: any = { isApproved: false, reviewStatus: 'PENDING' };
    if (filters.examId) where.examId = filters.examId;
    if (filters.subjectId) where.subjectId = filters.subjectId;
    if (filters.chapterId) where.chapterId = filters.chapterId;
    const take = Math.min(filters.take ?? 20, 100);
    const skip = filters.skip ?? 0;
    const [rows, total] = await Promise.all([
      this.prisma.question.findMany({
        where,
        include: {
          exam: { select: { name: true } },
          subject: { select: { name: true } },
          chapter: { select: { name: true } },
          topic: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.question.count({ where }),
    ]);
    return {
      total,
      data: rows.map((r) => ({
        id: r.id,
        questionText: r.questionText,
        questionTextHindi: r.questionTextHindi,
        options: r.optionsJson,
        correctAnswer: r.correctAnswer,
        explanation: r.explanation,
        explanationHindi: r.explanationHindi,
        examName: r.exam?.name ?? null,
        subjectName: r.subject?.name ?? null,
        chapterName: r.chapter?.name ?? null,
        topicName: r.topic?.name ?? null,
        year: r.year,
        shift: r.shift,
        difficulty: r.difficulty,
        createdAt: r.createdAt,
      })),
    };
  }

  /**
   * Approve a pending question, with optional edits applied at the same
   * time (e.g. admin fills in the missing Hindi translation right here and
   * approves in one action, instead of needing a separate edit screen).
   */
  async approvePendingQuestion(
    id: string,
    adminId: string,
    edits?: Partial<{
      questionText: string;
      questionTextHindi: string;
      explanation: string;
      explanationHindi: string;
      options: Array<{ key: string; text: string; textHi?: string }>;
      correctAnswer: string;
    }>,
  ) {
    const question = await this.prisma.question.findUnique({ where: { id } });
    if (!question) throw new BadRequestException(`Question not found: ${id}`);
    const updated = await this.prisma.question.update({
      where: { id },
      data: {
        ...(edits?.questionText !== undefined ? { questionText: edits.questionText } : {}),
        ...(edits?.questionTextHindi !== undefined ? { questionTextHindi: edits.questionTextHindi } : {}),
        ...(edits?.explanation !== undefined ? { explanation: edits.explanation } : {}),
        ...(edits?.explanationHindi !== undefined ? { explanationHindi: edits.explanationHindi } : {}),
        ...(edits?.options !== undefined ? { optionsJson: edits.options as any } : {}),
        ...(edits?.correctAnswer !== undefined ? { correctAnswer: edits.correctAnswer } : {}),
        isApproved: true,
        isActive: true,
        reviewStatus: 'APPROVED',
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'QUESTION_MANUALLY_APPROVED',
        targetEntity: 'Question',
        entityId: id,
        metadataJson: { hadEdits: !!edits } as any,
      },
    });
    return updated;
  }

  async rejectPendingQuestion(id: string, adminId: string, reason?: string) {
    const question = await this.prisma.question.findUnique({ where: { id } });
    if (!question) throw new BadRequestException(`Question not found: ${id}`);
    const updated = await this.prisma.question.update({
      where: { id },
      data: { isApproved: false, isActive: false, reviewStatus: 'REJECTED' },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'QUESTION_MANUALLY_REJECTED',
        targetEntity: 'Question',
        entityId: id,
        metadataJson: { reason: reason ?? null } as any,
      },
    });
    return updated;
  }

  // ---- Admin topic management ----
  // NEW ("chapter mein bhi topic hona tha jaise English mein Noun, Pronoun
  // — vesa har subject mein"): the Topic model (Chapter → Topic →
  // SubTopic, schema.prisma line ~274) already existed, and questions
  // already carry an optional topicId, but there was no way anywhere in
  // the API to CREATE a topic under a chapter — exactly the gap
  // createChapter() above closed for chapters. Mirrors that method
  // exactly: idempotent by (chapterId, slug), doesn't filter out
  // zero-question topics (an admin managing content needs to see a
  // freshly-created, still-empty topic, not have it silently hidden).
  async listAllTopicsForAdmin(chapterId?: string) {
    return this.prisma.topic.findMany({
      where: chapterId ? { chapterId } : undefined,
      select: {
        id: true,
        name: true,
        slug: true,
        chapterId: true,
        chapter: { select: { name: true, slug: true, subject: { select: { name: true } } } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createTopic(chapterId: string, name: string): Promise<{ id: string; name: string; slug: string; chapterId: string }> {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new BadRequestException(`Chapter not found: ${chapterId}`);
    const trimmedName = (name ?? '').trim();
    if (!trimmedName) throw new BadRequestException('Topic name is required');
    const slug = trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'topic';
    const existing = await this.prisma.topic.findUnique({ where: { chapterId_slug: { chapterId, slug } } });
    if (existing) return existing;
    return this.prisma.topic.create({ data: { chapterId, name: trimmedName, slug } });
  }

  // Browse questions by filters (exam/subject/chapter), bilingual rows.
  async browse(f: { examId?: string; subjectId?: string; chapterId?: string; skip?: number; take?: number }, userId?: string | null) {
    const take = Math.min(f.take ?? 20, 50);
    const skip = f.skip ?? 0;
    // FIX Error #6: was { isApproved: true } only — auto-suspended /
    // deactivated questions could still be served here.
    const where: any = { ...PUBLISHED_QUESTION_WHERE };
    if (f.examId) where.examId = f.examId;
    if (f.chapterId) where.chapterId = f.chapterId;
    else if (f.subjectId) where.subjectId = f.subjectId;
    const rows = await this.prisma.question.findMany({
      where,
      include: {
        chapter: { select: { name: true } },
        exam: { select: { name: true } },
        subject: { select: { name: true } },
        topic: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
      skip,
      take,
    });
    const total = await this.prisma.question.count({ where });
    const attemptedSet = await this.getAttemptedQuestionIds(userId, rows.map((r: any) => r.id));
    const data = rows.map((r: any) => {
      const canReveal = attemptedSet.has(r.id);
      return {
        id: r.id,
        questionText: r.questionText,
        questionTextHindi: r.questionTextHindi,
        questionDiagramType: r.questionDiagramType ?? null,
        questionDiagramLabels: r.questionDiagramLabels ?? null,
        questionImageUrl: r.questionImageUrl ?? null,
        options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null, diagramType: o.diagramType ?? null, diagramLabels: o.diagramLabels ?? null, imageUrl: o.imageUrl ?? null })),
        // Only revealed once this user has a genuine attempt for this
        // question elsewhere — never sent up-front from a browse listing.
        correctAnswer: canReveal ? r.correctAnswer : null,
        explanation: canReveal ? r.explanation : null,
        explanationHindi: canReveal ? r.explanationHindi : null,
        isAnswered: canReveal,
        chapter: r.chapter?.name ?? '',
        exam: r.exam?.name ?? null,
        year: r.year,
        shift: r.shift,
        paperCode: r.paperCode ?? null,
        subject: r.subject?.name ?? null,
        // FIX ("chapter mein bhi topic hona tha jaise English mein Noun,
        // Pronoun") — Topic model (Chapter → Topic → SubTopic) already
        // existed in the schema and questions already carry a topicId, but
        // this browse() response never surfaced the topic's name, and no
        // frontend page displayed it even when present. Now included.
        topic: r.topic?.name ?? null,
        difficulty: r.difficulty,
        marks: r.marks,
        negativeMarks: r.negativeMarks,
        answerVerificationStatus: r.answerVerificationStatus ?? 'UNVERIFIED_SINGLE_SOURCE',
        lastVerifiedAt: r.lastVerifiedAt ?? null,
      };
    });
    return { total, data };
  }

  // Single question + its solution (for display during review)
  async getById(id: string, userId?: string | null) {
    // FIX Error #6/#8: apply the shared visibility filter here too.
    const q = await this.prisma.question.findFirst({
      where: { id, ...PUBLISHED_QUESTION_WHERE },
      include: { chapter: { select: { name: true } } },
    });
    if (!q) throw new NotFoundException('Question not found');
    const canReveal = (await this.getAttemptedQuestionIds(userId, [q.id])).has(q.id);

    // v2 §7.6 — Previous SSC References: real-DB computation, never static text.
    // Same exam + same chapter across the other years in the bank.
    let prevRefs = { count: 0, years: [] as number[], acrossYears: 0 };
    if (q.chapterId) {
      const refs = await this.prisma.question.findMany({
        where: { examId: q.examId ?? undefined, chapterId: q.chapterId, ...PUBLISHED_QUESTION_WHERE, id: { not: q.id } },
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
        where: { examId: q.examId ?? undefined, chapterId: q.chapterId, ...PUBLISHED_QUESTION_WHERE, year: { gte: now - 5 } },
      });
      const covered = await this.prisma.question.count({
        where: { examId: q.examId ?? undefined, chapterId: q.chapterId, ...PUBLISHED_QUESTION_WHERE, year: { not: null } },
      });
      expectedFrequency = { askedTimes: last5 > 0 ? last5 : null, lastFiveYearsCount: last5, yearsCovered: covered };
    }

    return {
      id: q.id,
      questionText: q.questionText,
      questionTextHindi: q.questionTextHindi,
      questionDiagramType: q.questionDiagramType ?? null,
      questionDiagramLabels: q.questionDiagramLabels ?? null,
      questionImageUrl: q.questionImageUrl ?? null,
      options: (q.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null, diagramType: o.diagramType ?? null, diagramLabels: o.diagramLabels ?? null, imageUrl: o.imageUrl ?? null })),
      correctAnswer: canReveal ? q.correctAnswer : null,
      explanation: canReveal ? q.explanation : null,
      explanationHindi: canReveal ? q.explanationHindi : null,
      isAnswered: canReveal,
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
    const q = await this.prisma.question.findFirst({ where: { id: dto.questionId, ...PUBLISHED_QUESTION_WHERE } });
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
  //
  // NOTE (bonus-grep pass): unlike browse()/getById() above, this endpoint's
  // only frontend consumer is /test's chapter-wise-PYQ practice mode, which
  // deliberately shows a "Show Answer" / "AI Hint" button per question
  // *before* the student picks an option — that is the feature, not a bug,
  // so correctAnswer/explanation are intentionally left ungated here. Do not
  // apply the browse()/getById() attempted-gate to this method.
  async chapterPyq(f: { chapterId: string; examId?: string; year?: number; skip?: number; take?: number }) {
    const take = Math.min(f.take ?? 25, 50);
    const skip = f.skip ?? 0;
    const where: any = { ...PUBLISHED_QUESTION_WHERE, chapterId: f.chapterId };
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
      where: { ...PUBLISHED_QUESTION_WHERE, chapterId: f.chapterId, year: { not: null } },
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
        questionDiagramType: r.questionDiagramType ?? null,
        questionDiagramLabels: r.questionDiagramLabels ?? null,
        questionImageUrl: r.questionImageUrl ?? null,
        options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null, diagramType: o.diagramType ?? null, diagramLabels: o.diagramLabels ?? null, imageUrl: o.imageUrl ?? null })),
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
      where: { ...PUBLISHED_QUESTION_WHERE },
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
      questionDiagramType: q.questionDiagramType ?? null,
      questionDiagramLabels: q.questionDiagramLabels ?? null,
      questionImageUrl: q.questionImageUrl ?? null,
      options: (q.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null, diagramType: o.diagramType ?? null, diagramLabels: o.diagramLabels ?? null, imageUrl: o.imageUrl ?? null })),
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

  // NOTE (bonus-grep pass): this "quick set" is /test's default random-mix
  // question source, which — same as chapterPyq() above — has a deliberate
  // "Show Answer" / "AI Hint" self-check button per question before the
  // student answers. correctAnswer/explanation are intentionally left
  // ungated here; do not apply the browse()/getById() attempted-gate.
  async getSet(f: { examId?: string; subjectId?: string; count?: number }) {
    const takeN = Math.min(f.count ?? 10, 25);
    const where: any = { ...PUBLISHED_QUESTION_WHERE, questionTextHindi: { not: '' } }; // bilingual gate (v3 §3): empty/NULL dono exclude
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
        questionDiagramType: r.questionDiagramType ?? null,
        questionDiagramLabels: r.questionDiagramLabels ?? null,
        questionImageUrl: r.questionImageUrl ?? null,
        options: (r.optionsJson as any[]).map((o: any) => ({ key: o.key, text: o.text, textHi: o.textHi ?? null, diagramType: o.diagramType ?? null, diagramLabels: o.diagramLabels ?? null, imageUrl: o.imageUrl ?? null })),
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
    // FIX: was missing autoSuspended check (only had isApproved + isActive)
    const where: any = { ...PUBLISHED_QUESTION_WHERE };
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
