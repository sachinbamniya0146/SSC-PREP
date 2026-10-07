/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BankUploadService } from './bank-upload.service';
import { cacheClearPrefix } from '../common/cache';
import { COMPARED_FIELDS, FIELD_LABELS, compareQuestions } from '../common/duplicate-compare';

/**
 * Duplicate review queue  (Sachin, Oct 6 2026)
 *
 * "jo duplicate question admin dalta hai ... question, options, solution, shift
 *  sab exactly same ho to admin ke review me jaye. Admin approve kare — ek hi
 *  rakhe (purana ya naya) ya dono rakhe."
 *
 * Where reviews come from
 *   1. UPLOAD mode — Excel / CSV / JSON / Word upload, or "add one question":
 *      the row is the same question as one already live. The not-yet-saved row
 *      waits in `candidateJson`; nothing is created until the admin decides.
 *   2. SCAN mode — scan() looks through questions ALREADY in the bank for
 *      copies of each other (old data) and queues the pairs.
 *
 * What the admin can do (resolve)
 *   KEEP_EXISTING  keep the old one only   (upload: drop the new row · scan: hide side B)
 *   KEEP_NEW       keep the new one only   (upload: save new + hide old · scan: hide side A)
 *   KEEP_BOTH      keep both               (upload: save new too · scan: nothing changes)
 *
 * "Remove" always means HIDE (isActive=false), never a hard delete: students may
 * have attempted/bookmarked the question, and a hidden question can be restored
 * from the Question Manager (status "hidden").
 */

export type DuplicateAction = 'KEEP_EXISTING' | 'KEEP_NEW' | 'KEEP_BOTH';
const ACTION_TO_STATUS: Record<DuplicateAction, string> = {
  KEEP_EXISTING: 'KEPT_EXISTING',
  KEEP_NEW: 'KEPT_NEW',
  KEEP_BOTH: 'KEPT_BOTH',
};

const BULK_RESOLVE_MAX = 2000;
const SCAN_GROUP_CHUNK = 200;

export interface DuplicateListQuery {
  /** PENDING (default) | RESOLVED | ALL */
  status?: string;
  /** EXACT | SIMILAR */
  matchType?: string;
  batchId?: string;
  skip?: number;
  take?: number;
}

@Injectable()
export class DuplicateReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly upload: BankUploadService,
  ) {}

  // ---------------------------------------------------------------- counts
  async counts() {
    const rows = await this.prisma.duplicateReview.groupBy({
      by: ['status', 'matchType'],
      _count: { _all: true },
    });
    let pendingExact = 0;
    let pendingSimilar = 0;
    let resolved = 0;
    for (const r of rows) {
      const n = r._count._all;
      if (r.status === 'PENDING') {
        if (r.matchType === 'EXACT') pendingExact += n;
        else pendingSimilar += n;
      } else {
        resolved += n;
      }
    }
    return { pendingExact, pendingSimilar, pending: pendingExact + pendingSimilar, resolved };
  }

  // ------------------------------------------------------------------ list
  async list(q: DuplicateListQuery) {
    const take = Math.min(Math.max(Number(q.take) || 20, 1), 50);
    const skip = Math.max(Number(q.skip) || 0, 0);
    const where: any = {};
    const st = String(q.status ?? 'PENDING').toUpperCase();
    if (st === 'PENDING') where.status = 'PENDING';
    else if (st === 'RESOLVED') where.status = { not: 'PENDING' };
    const mt = String(q.matchType ?? '').toUpperCase();
    if (mt === 'EXACT' || mt === 'SIMILAR') where.matchType = mt;
    if (q.batchId) where.uploadBatchId = String(q.batchId);

    const [total, rows] = await Promise.all([
      this.prisma.duplicateReview.count({ where }),
      this.prisma.duplicateReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);

    // load every live question referenced by this page in one query
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.existingQuestionId) ids.add(r.existingQuestionId);
      if (r.candidateQuestionId) ids.add(r.candidateQuestionId);
    }
    const dbRows = ids.size
      ? await this.prisma.question.findMany({
          where: { id: { in: Array.from(ids) } },
          select: this.viewSelect(),
        })
      : [];
    const byId = new Map<string, any>(dbRows.map((x: any) => [x.id, x]));

    // names for upload-mode candidates (exam / subject / chapter ids inside the JSON)
    const names = await this.loadNames(rows.map((r) => r.candidateJson as any).filter(Boolean));

    const items = rows.map((r) => {
      const uploadMode = !!r.candidateJson && !r.candidateQuestionId;
      const left = r.existingQuestionId ? this.fromDb(byId.get(r.existingQuestionId)) : null;
      const right = uploadMode
        ? this.fromSnapshot(r.candidateJson as any, names)
        : r.candidateQuestionId
          ? this.fromDb(byId.get(r.candidateQuestionId))
          : null;
      return {
        id: r.id,
        status: r.status,
        matchType: r.matchType,
        mode: uploadMode ? 'UPLOAD' : 'SCAN',
        differences: ((r.differences as any) ?? []) as string[],
        differenceLabels: (((r.differences as any) ?? []) as string[]).map((f) => (FIELD_LABELS as any)[f] ?? f),
        sourceRow: r.sourceRow,
        uploadBatchId: r.uploadBatchId,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        // left = the question already in the bank (old / side A)
        // right = the new upload row (upload mode) or the second bank question (scan mode / side B)
        left,
        right,
        leftMissing: !!r.existingQuestionId && !left,
      };
    });

    return { total, skip, take, items };
  }

  // --------------------------------------------------------------- resolve
  async resolve(id: string, actionRaw: string, adminId: string) {
    const action = this.parseAction(actionRaw);
    const review = await this.prisma.duplicateReview.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Ye duplicate review nahi mila. / Review not found.');
    if (review.status !== 'PENDING') {
      throw new ConflictException('Is duplicate par pehle hi decision ho chuka hai. / Already resolved.');
    }

    // claim it atomically so two admins (or a double click) cannot apply it twice
    const claim = await this.prisma.duplicateReview.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: ACTION_TO_STATUS[action], resolvedById: adminId, resolvedAt: new Date() },
    });
    if (claim.count === 0) throw new ConflictException('Is duplicate par pehle hi decision ho chuka hai. / Already resolved.');

    try {
      const detail = await this.apply(review, action, adminId);
      return { id, status: ACTION_TO_STATUS[action], ...detail };
    } catch (e) {
      // side effects failed: put the review back in the queue so nothing is lost
      await this.prisma.duplicateReview
        .updateMany({ where: { id }, data: { status: 'PENDING', resolvedById: null, resolvedAt: null } })
        .catch(() => undefined);
      throw e;
    }
  }

  /** Apply one decision to many reviews. Either explicit `ids`, or every PENDING review matching the filter (needs confirm). */
  async bulkResolve(
    body: { ids?: string[]; matchType?: string; batchId?: string; action: string },
    adminId: string,
  ) {
    const action = this.parseAction(body.action);
    let ids: string[] = [];
    if (Array.isArray(body.ids) && body.ids.length) {
      ids = Array.from(new Set(body.ids.map(String))).slice(0, BULK_RESOLVE_MAX);
    } else {
      const where: any = { status: 'PENDING' };
      const mt = String(body.matchType ?? '').toUpperCase();
      if (mt === 'EXACT' || mt === 'SIMILAR') where.matchType = mt;
      if (body.batchId) where.uploadBatchId = String(body.batchId);
      const found = await this.prisma.duplicateReview.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: BULK_RESOLVE_MAX,
        select: { id: true },
      });
      ids = found.map((f) => f.id);
    }

    let done = 0;
    let failed = 0;
    const errors: { id: string; error: string }[] = [];
    for (const id of ids) {
      try {
        await this.resolve(id, action, adminId);
        done++;
      } catch (e) {
        failed++;
        if (errors.length < 20) errors.push({ id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { requested: ids.length, done, failed, errors, capped: ids.length >= BULK_RESOLVE_MAX };
  }

  // ------------------------------------------------------------------ scan
  /**
   * Looks through questions already in the bank for copies of each other and queues
   * the pairs for review. Pairs the admin has already reviewed are never queued again.
   * By default only EXACT copies are queued (same question in a different shift/year
   * is a normal repeat in SSC papers); pass includeSimilar to see those too.
   */
  async scan(adminId: string, opts: { examId?: string; includeSimilar?: boolean; maxGroups?: number } = {}) {
    const maxGroups = Math.min(Math.max(Number(opts.maxGroups) || 2000, 1), 20000);
    const examId = opts.examId ? String(opts.examId) : null;

    const groups = (await this.prisma.$queryRaw<{ hash: string }[]>`
      SELECT q."searchHash" AS hash
      FROM questions q
      WHERE q."isActive" = true
        AND q."searchHash" IS NOT NULL AND q."searchHash" <> ''
        AND (${examId}::text IS NULL OR q."examId" = ${examId})
      GROUP BY q."searchHash"
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT ${maxGroups};`) as { hash: string }[];

    let queued = 0;
    let alreadyReviewed = 0;
    let similarSkipped = 0;

    for (let i = 0; i < groups.length; i += SCAN_GROUP_CHUNK) {
      const hashes = groups.slice(i, i + SCAN_GROUP_CHUNK).map((g) => g.hash);
      const rows = await this.prisma.question.findMany({
        where: { searchHash: { in: hashes }, isActive: true, ...(examId ? { examId } : {}) },
        orderBy: { createdAt: 'asc' },
        select: this.compareSelect(),
      });
      const byHash = new Map<string, any[]>();
      for (const r of rows) {
        const key = String(r.searchHash);
        const arr = byHash.get(key) ?? [];
        arr.push(r);
        byHash.set(key, arr);
      }

      // pairs already reviewed (any status, either direction)
      const idList = rows.map((r) => r.id);
      const prior = idList.length
        ? await this.prisma.duplicateReview.findMany({
            where: {
              candidateQuestionId: { not: null },
              OR: [{ existingQuestionId: { in: idList } }, { candidateQuestionId: { in: idList } }],
            },
            select: { existingQuestionId: true, candidateQuestionId: true },
          })
        : [];
      const seenPairs = new Set<string>();
      for (const p of prior) {
        seenPairs.add(`${p.existingQuestionId}|${p.candidateQuestionId}`);
        seenPairs.add(`${p.candidateQuestionId}|${p.existingQuestionId}`);
      }

      const toCreate: any[] = [];
      for (const [hash, list] of byHash) {
        if (list.length < 2) continue;
        const base = list[0]; // oldest copy is side A
        for (const other of list.slice(1)) {
          if (seenPairs.has(`${base.id}|${other.id}`)) {
            alreadyReviewed++;
            continue;
          }
          const cmp = compareQuestions(other, base);
          if (!cmp.exact && !opts.includeSimilar) {
            similarSkipped++;
            continue;
          }
          toCreate.push({
            status: 'PENDING',
            matchType: cmp.matchType,
            differences: cmp.differences as any,
            existingQuestionId: base.id,
            candidateQuestionId: other.id,
            searchHash: hash,
            createdById: adminId,
          });
        }
      }
      if (toCreate.length) {
        await this.prisma.duplicateReview.createMany({ data: toCreate });
        queued += toCreate.length;
      }
    }

    return { groupsChecked: groups.length, queued, alreadyReviewed, similarSkipped };
  }

  // ---------------------------------------------------------------- internals
  private parseAction(raw: string): DuplicateAction {
    const a = String(raw ?? '').toUpperCase();
    if (a === 'KEEP_EXISTING' || a === 'KEEP_NEW' || a === 'KEEP_BOTH') return a;
    throw new BadRequestException('action KEEP_EXISTING, KEEP_NEW ya KEEP_BOTH hona chahiye.');
  }

  private async apply(review: any, action: DuplicateAction, adminId: string) {
    const uploadMode = !!review.candidateJson && !review.candidateQuestionId;
    const out: { createdQuestionId?: string; hiddenQuestionId?: string; published?: boolean } = {};

    if (uploadMode) {
      if (action === 'KEEP_EXISTING') return out; // the new row is simply dropped
      const created = await this.upload.createFromReviewCandidate(review.candidateJson as any, adminId, review.uploadBatchId);
      out.createdQuestionId = created.id;
      out.published = created.published;
      if (action === 'KEEP_NEW' && review.existingQuestionId) {
        await this.hide(review.existingQuestionId, adminId, 'DUPLICATE_REVIEW_KEEP_NEW');
        out.hiddenQuestionId = review.existingQuestionId;
      }
      return out;
    }

    // scan mode: both questions already live
    if (action === 'KEEP_BOTH') return out;
    const loser = action === 'KEEP_EXISTING' ? review.candidateQuestionId : review.existingQuestionId;
    if (loser) {
      await this.hide(loser, adminId, action === 'KEEP_EXISTING' ? 'DUPLICATE_REVIEW_KEEP_A' : 'DUPLICATE_REVIEW_KEEP_B');
      out.hiddenQuestionId = loser;
    }
    return out;
  }

  /** Soft-remove: students stop seeing it, attempts/bookmarks stay intact, admin can restore it. */
  private async hide(questionId: string, adminId: string, reason: string) {
    const q = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { id: true, isActive: true, examId: true, year: true, shift: true, paperCode: true, examDate: true },
    });
    if (!q || !q.isActive) return;
    await this.prisma.question.update({ where: { id: questionId }, data: { isActive: false } });
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: adminId,
          action: reason,
          targetEntity: 'Question',
          entityId: questionId,
          metadataJson: { via: 'duplicate-review' } as any,
        },
      });
    } catch {
      /* audit is best effort */
    }
    cacheClearPrefix('bank:subjects');
    cacheClearPrefix('bank:chapters');
    cacheClearPrefix('bank:meta');
    cacheClearPrefix('bank:years');
    cacheClearPrefix('bank:shifts');
    if (q.examId && q.year && q.shift) {
      try {
        await this.upload.upsertPyqMockForPaper(q.examId, q.year, q.shift, q.paperCode ?? null, q.examDate ?? null);
      } catch {
        /* mock refresh is best effort */
      }
    }
  }

  private compareSelect() {
    return {
      id: true,
      searchHash: true,
      questionText: true,
      questionTextHindi: true,
      optionsJson: true,
      correctAnswer: true,
      explanation: true,
      explanationHindi: true,
      questionImageUrl: true,
      examId: true,
      year: true,
      shift: true,
      examDate: true,
      paperCode: true,
      createdAt: true,
    } as const;
  }

  private viewSelect() {
    return {
      ...this.compareSelect(),
      questionNo: true,
      isActive: true,
      isApproved: true,
      subject: { select: { name: true } },
      chapter: { select: { name: true } },
      exam: { select: { name: true } },
    } as const;
  }

  private viewOptions(raw: any): { key: string; text: string; textHi: string; imageUrl: string | null }[] {
    const list = Array.isArray(raw) ? raw : [];
    return list
      .slice()
      .sort((a, b) => String(a?.key ?? '').localeCompare(String(b?.key ?? '')))
      .map((o) => ({
        key: String(o?.key ?? ''),
        text: String(o?.text ?? ''),
        textHi: String(o?.textHi ?? ''),
        imageUrl: o?.imageUrl ? String(o.imageUrl) : null,
      }));
  }

  private fromDb(q: any) {
    if (!q) return null;
    return {
      id: q.id as string,
      questionNo: q.questionNo ?? null,
      source: 'BANK' as const,
      isLive: !!q.isActive && !!q.isApproved,
      isHidden: !q.isActive,
      questionText: q.questionText ?? '',
      questionTextHindi: q.questionTextHindi ?? '',
      questionImageUrl: q.questionImageUrl ?? null,
      options: this.viewOptions(q.optionsJson),
      correctAnswer: q.correctAnswer ?? '',
      explanation: q.explanation ?? '',
      explanationHindi: q.explanationHindi ?? '',
      examName: q.exam?.name ?? null,
      subjectName: q.subject?.name ?? null,
      chapterName: q.chapter?.name ?? null,
      year: q.year ?? null,
      shift: q.shift ?? null,
      examDate: q.examDate ?? null,
      paperCode: q.paperCode ?? null,
      createdAt: q.createdAt,
    };
  }

  private fromSnapshot(c: any, names: { exam: Map<string, string>; subject: Map<string, string>; chapter: Map<string, string> }) {
    if (!c) return null;
    return {
      id: null as string | null,
      questionNo: null,
      source: 'UPLOAD' as const,
      isLive: false,
      isHidden: false,
      questionText: c.questionText ?? '',
      questionTextHindi: c.questionTextHindi ?? '',
      questionImageUrl: c.questionImageUrl ?? null,
      options: this.viewOptions(c.options),
      correctAnswer: c.correctAnswer ?? '',
      explanation: c.explanation ?? '',
      explanationHindi: c.explanationHindi ?? '',
      examName: (c.examId && names.exam.get(c.examId)) || null,
      subjectName: (c.subjectId && names.subject.get(c.subjectId)) || null,
      chapterName: (c.chapterId && names.chapter.get(c.chapterId)) || null,
      year: c.year ?? null,
      shift: c.shift ?? null,
      examDate: c.examDate ?? null,
      paperCode: c.paperCode ?? null,
      createdAt: null,
    };
  }

  private async loadNames(snaps: any[]) {
    const examIds = new Set<string>();
    const subjectIds = new Set<string>();
    const chapterIds = new Set<string>();
    for (const c of snaps) {
      if (c.examId) examIds.add(c.examId);
      if (c.subjectId) subjectIds.add(c.subjectId);
      if (c.chapterId) chapterIds.add(c.chapterId);
    }
    const [exams, subjects, chapters] = await Promise.all([
      examIds.size ? this.prisma.exam.findMany({ where: { id: { in: Array.from(examIds) } }, select: { id: true, name: true } }) : [],
      subjectIds.size ? this.prisma.subject.findMany({ where: { id: { in: Array.from(subjectIds) } }, select: { id: true, name: true } }) : [],
      chapterIds.size ? this.prisma.chapter.findMany({ where: { id: { in: Array.from(chapterIds) } }, select: { id: true, name: true } }) : [],
    ]);
    return {
      exam: new Map<string, string>(exams.map((x: any) => [x.id, x.name])),
      subject: new Map<string, string>(subjects.map((x: any) => [x.id, x.name])),
      chapter: new Map<string, string>(chapters.map((x: any) => [x.id, x.name])),
    };
  }

  /** Field list the UI uses to highlight differences (kept in sync with common/duplicate-compare.ts). */
  fields() {
    return COMPARED_FIELDS.map((f) => ({ field: f, label: FIELD_LABELS[f] }));
  }
}
