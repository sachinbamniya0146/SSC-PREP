/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BankUploadService } from './bank-upload.service';
import { cacheClearPrefix } from '../common/cache';
import { COMPARED_FIELDS, FIELD_LABELS, PAPER_IDENTITY_FIELDS, compareQuestions, isCrossPaperRepeat } from '../common/duplicate-compare';

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
 * UNDO (Oct 14 2026)
 *   undo()/bulkUndo() take a resolved review back to PENDING: the new question that was saved is hidden again,
 *   the old question that was hidden is made live again. What was created/hidden is remembered inside
 *   candidateJson._undo (upload mode); reviews resolved BEFORE this feature are re-discovered (same searchHash,
 *   created right after resolvedAt, written to the audit log).
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

const BULK_RESOLVE_MAX = 5000;
// Oct 14 2026: one bulk request stops after this long (Cloudflare cuts requests at 100 s); the UI simply calls again for the rest.
const BULK_TIME_BUDGET_MS = 40_000;
const BULK_CONCURRENCY = 6;

/** Work collected while many reviews are resolved, flushed ONCE at the end instead of after every review. */
type KeyedRow = { examId: string | null; examTier: string | null; tierPaper: string | null; examDate: string | null; shift: string | null };
interface BulkCtx {
  papers: Map<string, { examId: string; year: number; shift: string; paperCode: string | null; examDate: string | null }>;
  /** 27 Oct 2026: date-wise + tier-wise papers touched by this run — rebuilt ONCE in flushBulk (they were never rebuilt before). */
  keyed: KeyedRow[];
  audits: any[];
}
interface ResolveOpts {
  /** keep-new / keep-both: make the surviving new question live at once */
  publish?: boolean;
  ctx?: BulkCtx;
}
const SCAN_GROUP_CHUNK = 200;

export interface DuplicateListQuery {
  /** PENDING (default) | RESOLVED | ALL */
  status?: string;
  /** EXACT | SIMILAR */
  matchType?: string;
  batchId?: string;
  /** with status=RESOLVED: only KEPT_NEW | KEPT_EXISTING | KEPT_BOTH */
  resolvedStatus?: string;
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
    else if (st === 'RESOLVED') {
      const rs = String(q.resolvedStatus ?? '').toUpperCase();
      where.status = ['KEPT_NEW', 'KEPT_EXISTING', 'KEPT_BOTH'].includes(rs) ? rs : { not: 'PENDING' };
    }
    const mt = String(q.matchType ?? '').toUpperCase();
    if (mt === 'EXACT' || mt === 'SIMILAR') where.matchType = mt;
    if (q.batchId) where.uploadBatchId = String(q.batchId);

    const [total, rows] = await Promise.all([
      this.prisma.duplicateReview.count({ where }),
      this.prisma.duplicateReview.findMany({
        where,
        orderBy: st === 'PENDING' ? { createdAt: 'desc' } : { resolvedAt: 'desc' },
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
        // 27 Oct 2026: same question in a DIFFERENT paper (shift / date / tier / year ...) — the usual decision is
        // KEEP_BOTH ("dono paper me rakho"); a same-paper repeat is a true duplicate (keep one).
        crossPaper: isCrossPaperRepeat((r.differences as any) ?? []),
        crossPaperLabels: (((r.differences as any) ?? []) as string[]).filter((f) => (PAPER_IDENTITY_FIELDS as readonly string[]).includes(f)).map((f) => (FIELD_LABELS as any)[f] ?? f),
        suggestedAction: isCrossPaperRepeat((r.differences as any) ?? []) ? 'KEEP_BOTH' : r.matchType === 'EXACT' ? 'KEEP_EXISTING' : null,
        sourceRow: r.sourceRow,
        uploadBatchId: r.uploadBatchId,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        canUndo: r.status !== 'PENDING',
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
  async resolve(id: string, actionRaw: string, adminId: string, opts: ResolveOpts = {}) {
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
      const detail = await this.apply(review, action, adminId, opts);
      // remember what this decision created / hid, so "Undo" is exact
      if (review.candidateJson && !review.candidateQuestionId && (detail.createdQuestionId || detail.hiddenQuestionId)) {
        const { _undo: _old, ...cand } = (review.candidateJson as any) ?? {};
        void _old;
        await this.prisma.duplicateReview
          .update({
            where: { id },
            data: { candidateJson: { ...cand, _undo: { createdQuestionId: detail.createdQuestionId ?? null, hiddenQuestionId: detail.hiddenQuestionId ?? null } } as any },
          })
          .catch(() => undefined);
      }
      return { id, status: ACTION_TO_STATUS[action], ...detail };
    } catch (e) {
      // side effects failed: put the review back in the queue so nothing is lost
      await this.prisma.duplicateReview
        .updateMany({ where: { id }, data: { status: 'PENDING', resolvedById: null, resolvedAt: null } })
        .catch(() => undefined);
      throw e;
    }
  }

  /**
   * Apply one decision to many reviews. Either explicit `ids`, or every PENDING review matching the filter (needs confirm).
   * Oct 14 2026: runs 6 at a time, rebuilds each PYQ mock / clears caches ONCE at the end, stops after ~40 s and reports
   * `remaining` so the UI can call again until it is 0 (no more 100 s timeouts on thousands of duplicates).
   * `publish` makes every kept NEW question live immediately. `skipIds` = reviews that already failed this run.
   */
  async bulkResolve(
    body: { ids?: string[]; matchType?: string; batchId?: string; action: string; publish?: boolean; skipIds?: string[] },
    adminId: string,
  ) {
    const action = this.parseAction(body.action);
    const started = Date.now();
    const skip = new Set((body.skipIds ?? []).map(String));
    const baseWhere: any = { status: 'PENDING' };
    const mt = String(body.matchType ?? '').toUpperCase();
    if (mt === 'EXACT' || mt === 'SIMILAR') baseWhere.matchType = mt;
    if (body.batchId) baseWhere.uploadBatchId = String(body.batchId);

    let ids: string[] = [];
    if (Array.isArray(body.ids) && body.ids.length) {
      ids = Array.from(new Set(body.ids.map(String))).filter((x) => !skip.has(x)).slice(0, BULK_RESOLVE_MAX);
    } else {
      const found = await this.prisma.duplicateReview.findMany({
        where: { ...baseWhere, ...(skip.size ? { id: { notIn: Array.from(skip) } } : {}) },
        orderBy: { createdAt: 'asc' },
        take: BULK_RESOLVE_MAX,
        select: { id: true },
      });
      ids = found.map((f) => f.id);
    }

    const ctx: BulkCtx = { papers: new Map(), keyed: [], audits: [] };
    let done = 0;
    let failed = 0;
    let cursor = 0;
    const errors: { id: string; error: string }[] = [];
    const failedIds: string[] = [];
    const worker = async () => {
      while (cursor < ids.length && Date.now() - started < BULK_TIME_BUDGET_MS) {
        const id = ids[cursor++];
        try {
          await this.resolve(id, action, adminId, { publish: !!body.publish, ctx });
          done++;
        } catch (e) {
          failed++;
          failedIds.push(id);
          if (errors.length < 20) errors.push({ id, error: e instanceof Error ? e.message : String(e) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, Math.max(ids.length, 1)) }, () => worker()));
    const attempted = Math.min(cursor, ids.length);
    await this.flushBulk(ctx, adminId);

    // how many are still waiting for this filter (not counting the ones that failed)
    const stillPending = await this.prisma.duplicateReview.count({
      where: { ...baseWhere, ...(skip.size || failedIds.length ? { id: { notIn: [...skip, ...failedIds] } } : {}) },
    });
    const remaining = Array.isArray(body.ids) && body.ids.length ? Math.max(ids.length - attempted, 0) : stillPending;
    return { requested: ids.length, done, failed, failedIds, errors, remaining, capped: remaining > 0 };
  }

  // ------------------------------------------------------------------ undo (NEW Oct 14 2026)

  /**
   * Take ONE resolved review back to PENDING.
   *   upload mode  KEPT_NEW / KEPT_BOTH : the question that was saved from the upload row is hidden again,
   *                KEPT_NEW also makes the old (hidden) question live again
   *   upload mode  KEPT_EXISTING        : nothing was saved, the review just goes back to the queue
   *   scan mode    KEPT_EXISTING / KEPT_NEW : the question that was hidden becomes live again
   *   scan mode    KEPT_BOTH            : nothing changed, review goes back to the queue
   * If the saved question cannot be found, NOTHING is changed (the admin hides it by hand) — no half undo.
   */
  async undo(id: string, adminId: string, ctx?: BulkCtx) {
    const review = await this.prisma.duplicateReview.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Ye duplicate review nahi mila. / Review not found.');
    if (review.status === 'PENDING') throw new ConflictException('Ye pehle se pending hai — undo ke liye kuch nahi. / Already pending.');

    const uploadMode = !!review.candidateJson && !review.candidateQuestionId;
    let createdId: string | null = null;
    let restoreId: string | null = null;

    if (uploadMode) {
      if (review.status === 'KEPT_NEW' || review.status === 'KEPT_BOTH') {
        createdId = await this.findCreatedQuestion(review);
        if (!createdId) {
          throw new BadRequestException('Is decision se bana naya question dhoondh nahi paaye — Question Manager me haath se hide karein. Kuch change nahi kiya.');
        }
      }
      if (review.status === 'KEPT_NEW') restoreId = review.existingQuestionId ?? null;
    } else if (review.status === 'KEPT_EXISTING') {
      restoreId = review.candidateQuestionId ?? null;
    } else if (review.status === 'KEPT_NEW') {
      restoreId = review.existingQuestionId ?? null;
    }

    // claim atomically (double click / two admins)
    const claim = await this.prisma.duplicateReview.updateMany({
      where: { id, status: review.status },
      data: { status: 'PENDING', resolvedById: null, resolvedAt: null },
    });
    if (claim.count === 0) throw new ConflictException('Is review par abhi kisi aur ne kaam kiya. / Changed meanwhile.');

    try {
      const out: { hiddenQuestionId?: string; restoredQuestionId?: string } = {};
      if (createdId) {
        await this.unpublishAndHide(createdId, adminId, ctx);
        out.hiddenQuestionId = createdId;
      }
      if (restoreId) {
        const restored = await this.restore(restoreId, adminId, ctx);
        if (restored) out.restoredQuestionId = restoreId;
      }
      if (uploadMode) {
        // forget the old undo info: the next decision writes a fresh one
        const { _undo: _o, ...cand } = (review.candidateJson as any) ?? {};
        void _o;
        await this.prisma.duplicateReview.update({ where: { id }, data: { candidateJson: cand as any } }).catch(() => undefined);
      }
      return { id, status: 'PENDING', ...out };
    } catch (e) {
      await this.prisma.duplicateReview
        .updateMany({ where: { id }, data: { status: review.status, resolvedById: review.resolvedById, resolvedAt: review.resolvedAt } })
        .catch(() => undefined);
      throw e;
    }
  }

  /** The question that a KEPT_NEW / KEPT_BOTH upload decision saved. */
  private async findCreatedQuestion(review: any): Promise<string | null> {
    const remembered = (review.candidateJson as any)?._undo?.createdQuestionId;
    if (remembered) {
      const q = await this.prisma.question.findUnique({ where: { id: String(remembered) }, select: { id: true } });
      return q ? q.id : null;
    }
    // resolved before undo existed: same searchHash, saved right after the decision
    if (!review.searchHash || !review.resolvedAt) return null;
    const from = new Date(review.resolvedAt.getTime() - 5_000);
    const to = new Date(review.resolvedAt.getTime() + 30 * 60_000);
    const rows = await this.prisma.question.findMany({
      where: {
        searchHash: review.searchHash,
        createdAt: { gte: from, lte: to },
        ...(review.existingQuestionId ? { id: { not: review.existingQuestionId } } : {}),
        ...(review.uploadBatchId ? { uploadBatchId: review.uploadBatchId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 5,
      select: { id: true },
    });
    if (rows.length === 0) return null;
    // prefer the one the audit log says was created from a duplicate review
    const audited = await this.prisma.auditLog.findMany({
      where: { action: 'QUESTION_CREATED_FROM_DUPLICATE_REVIEW', entityId: { in: rows.map((r) => r.id) } },
      select: { entityId: true },
    });
    const auditedIds = new Set(audited.map((a) => a.entityId));
    return (rows.find((r) => auditedIds.has(r.id)) ?? rows[0]).id;
  }

  /** The "new" question goes back to where it was before the decision: not live, waiting (like Unpublish). */
  private async unpublishAndHide(questionId: string, adminId: string, ctx?: BulkCtx) {
    const q = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { id: true, examId: true, year: true, shift: true, paperCode: true, examDate: true, examTier: true, tierPaper: true },
    });
    if (!q) return;
    await this.prisma.question.update({ where: { id: questionId }, data: { isActive: false, isApproved: false, reviewStatus: 'PENDING' } });
    await this.afterVisibilityChange(q, questionId, adminId, 'DUPLICATE_REVIEW_UNDO_HIDE_NEW', ctx);
  }

  /** The old question that a decision hid is live again. Returns false if it does not exist any more. */
  private async restore(questionId: string, adminId: string, ctx?: BulkCtx): Promise<boolean> {
    const q = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { id: true, isActive: true, examId: true, year: true, shift: true, paperCode: true, examDate: true, examTier: true, tierPaper: true },
    });
    if (!q) return false;
    if (q.isActive) return true;
    await this.prisma.question.update({ where: { id: questionId }, data: { isActive: true } });
    await this.afterVisibilityChange(q, questionId, adminId, 'DUPLICATE_REVIEW_UNDO_RESTORE_OLD', ctx);
    return true;
  }

  private async afterVisibilityChange(
    q: { examId: string | null; year: number | null; shift: string | null; paperCode: string | null; examDate: string | null; examTier?: string | null; tierPaper?: string | null },
    questionId: string,
    adminId: string,
    action: string,
    ctx?: BulkCtx,
  ) {
    await this.refreshKeyed(q, ctx);
    const audit = { userId: adminId, action, targetEntity: 'Question', entityId: questionId, metadataJson: { via: 'duplicate-review-undo' } as any };
    const paper = q.examId && q.year && q.shift ? { examId: q.examId, year: q.year, shift: q.shift, paperCode: q.paperCode ?? null, examDate: q.examDate ?? null } : null;
    if (ctx) {
      ctx.audits.push(audit);
      if (paper) ctx.papers.set(`${paper.examId}|${paper.year}|${paper.shift}|${paper.paperCode ?? ''}`, paper);
      return;
    }
    try {
      await this.prisma.auditLog.create({ data: audit });
    } catch {
      /* audit is best effort */
    }
    this.clearBankCaches();
    if (paper) {
      try {
        await this.upload.upsertPyqMockForPaper(paper.examId, paper.year, paper.shift, paper.paperCode, paper.examDate);
      } catch {
        /* mock refresh is best effort */
      }
    }
  }

  /**
   * Undo many resolved reviews: explicit `ids`, or every resolved review matching the filter (needs confirm).
   * Same shape as bulkResolve: 6 at a time, ~40 s per request, `remaining` tells the UI to call again.
   * Undone reviews leave the RESOLVED list by themselves, so "call again until remaining = 0" just works.
   */
  async bulkUndo(body: { ids?: string[]; resolvedStatus?: string; batchId?: string; skipIds?: string[] }, adminId: string) {
    const started = Date.now();
    const skip = new Set((body.skipIds ?? []).map(String));
    const baseWhere: any = { status: { not: 'PENDING' } };
    const rs = String(body.resolvedStatus ?? '').toUpperCase();
    if (['KEPT_NEW', 'KEPT_EXISTING', 'KEPT_BOTH'].includes(rs)) baseWhere.status = rs;
    if (body.batchId) baseWhere.uploadBatchId = String(body.batchId);

    let ids: string[] = [];
    if (Array.isArray(body.ids) && body.ids.length) {
      ids = Array.from(new Set(body.ids.map(String))).filter((x) => !skip.has(x)).slice(0, BULK_RESOLVE_MAX);
    } else {
      const found = await this.prisma.duplicateReview.findMany({
        where: { ...baseWhere, ...(skip.size ? { id: { notIn: Array.from(skip) } } : {}) },
        orderBy: { resolvedAt: 'desc' },
        take: BULK_RESOLVE_MAX,
        select: { id: true },
      });
      ids = found.map((f) => f.id);
    }

    const ctx: BulkCtx = { papers: new Map(), keyed: [], audits: [] };
    let done = 0;
    let failed = 0;
    let cursor = 0;
    const errors: { id: string; error: string }[] = [];
    const failedIds: string[] = [];
    const worker = async () => {
      while (cursor < ids.length && Date.now() - started < BULK_TIME_BUDGET_MS) {
        const id = ids[cursor++];
        try {
          await this.undo(id, adminId, ctx);
          done++;
        } catch (e) {
          failed++;
          failedIds.push(id);
          if (errors.length < 20) errors.push({ id, error: e instanceof Error ? e.message : String(e) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, Math.max(ids.length, 1)) }, () => worker()));
    const attempted = Math.min(cursor, ids.length);
    await this.flushBulk(ctx, adminId);

    const stillResolved = await this.prisma.duplicateReview.count({
      where: { ...baseWhere, ...(skip.size || failedIds.length ? { id: { notIn: [...skip, ...failedIds] } } : {}) },
    });
    const remaining = Array.isArray(body.ids) && body.ids.length ? Math.max(ids.length - attempted, 0) : stillResolved;
    return { requested: ids.length, done, failed, failedIds, errors, remaining, capped: remaining > 0 };
  }

  /** One-time work after a bulk run: audit rows, caches, and each affected PYQ mock rebuilt once. */
  private async flushBulk(ctx: BulkCtx, adminId: string) {
    if (ctx.audits.length) {
      try {
        await this.prisma.auditLog.createMany({ data: ctx.audits });
      } catch {
        /* audit is best effort */
      }
    }
    if (ctx.audits.length || ctx.papers.size || ctx.keyed.length) this.clearBankCaches();
    if (ctx.keyed.length) await this.upload.rebuildKeyedPapersForRows(ctx.keyed); // never throws
    for (const g of ctx.papers.values()) {
      try {
        await this.upload.upsertPyqMockForPaper(g.examId, g.year, g.shift, g.paperCode, g.examDate);
      } catch {
        /* mock refresh is best effort */
      }
    }
    void adminId;
  }

  /** Rebuild the date-wise + tier-wise paper a question belongs to (deferred into the bulk context when there is one). */
  private async refreshKeyed(q: Partial<KeyedRow>, ctx?: BulkCtx) {
    if (!q.examId || !q.examTier || !q.examDate) return;
    const row: KeyedRow = { examId: q.examId, examTier: q.examTier, tierPaper: q.tierPaper ?? null, examDate: q.examDate, shift: q.shift ?? null };
    if (ctx) ctx.keyed.push(row);
    else await this.upload.rebuildKeyedPapersForRows([row]); // never throws
  }

  private clearBankCaches() {
    cacheClearPrefix('bank:subjects');
    cacheClearPrefix('bank:chapters');
    cacheClearPrefix('bank:meta');
    cacheClearPrefix('bank:years');
    cacheClearPrefix('bank:shifts');
    cacheClearPrefix('bank:tiers');
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

  private async apply(review: any, action: DuplicateAction, adminId: string, opts: ResolveOpts = {}) {
    const uploadMode = !!review.candidateJson && !review.candidateQuestionId;
    const out: { createdQuestionId?: string; hiddenQuestionId?: string; published?: boolean } = {};
    const ctx = opts.ctx;

    if (uploadMode) {
      if (action === 'KEEP_EXISTING') return out; // the new row is simply dropped
      const { _undo: _ignored, ...candidate } = (review.candidateJson as any) ?? {};
      void _ignored;
      const created = await this.upload.createFromReviewCandidate(candidate as any, adminId, review.uploadBatchId, {
        deferRefresh: !!ctx,
        forcePublish: !!opts.publish,
      });
      out.createdQuestionId = created.id;
      out.published = created.published;
      if (ctx) {
        ctx.audits.push({
          userId: adminId,
          action: 'QUESTION_CREATED_FROM_DUPLICATE_REVIEW',
          targetEntity: 'Question',
          entityId: created.id,
          metadataJson: { via: 'duplicate-review-bulk' } as any,
        });
        if (created.paper) ctx.papers.set(`${created.paper.examId}|${created.paper.year}|${created.paper.shift}|${created.paper.paperCode ?? ''}`, created.paper);
        if (created.keyedRow) ctx.keyed.push(created.keyedRow);
      }
      if (action === 'KEEP_NEW' && review.existingQuestionId) {
        await this.hide(review.existingQuestionId, adminId, 'DUPLICATE_REVIEW_KEEP_NEW', ctx);
        out.hiddenQuestionId = review.existingQuestionId;
      }
      return out;
    }

    // scan mode: both questions already live
    if (action === 'KEEP_BOTH') return out;
    const loser = action === 'KEEP_EXISTING' ? review.candidateQuestionId : review.existingQuestionId;
    const winner = action === 'KEEP_EXISTING' ? review.existingQuestionId : review.candidateQuestionId;
    if (loser) {
      await this.hide(loser, adminId, action === 'KEEP_EXISTING' ? 'DUPLICATE_REVIEW_KEEP_A' : 'DUPLICATE_REVIEW_KEEP_B', ctx);
      out.hiddenQuestionId = loser;
    }
    if (opts.publish && winner) {
      await this.prisma.question
        .update({ where: { id: winner }, data: { isApproved: true, isActive: true, autoSuspended: false, reviewStatus: 'APPROVED' } })
        .catch(() => undefined);
      out.published = true;
    }
    return out;
  }

  /** Soft-remove: students stop seeing it, attempts/bookmarks stay intact, admin can restore it. */
  private async hide(questionId: string, adminId: string, reason: string, ctx?: BulkCtx) {
    const q = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { id: true, isActive: true, examId: true, year: true, shift: true, paperCode: true, examDate: true, examTier: true, tierPaper: true },
    });
    if (!q || !q.isActive) return;
    await this.prisma.question.update({ where: { id: questionId }, data: { isActive: false } });
    await this.refreshKeyed(q, ctx);
    const audit = {
      userId: adminId,
      action: reason,
      targetEntity: 'Question',
      entityId: questionId,
      metadataJson: { via: 'duplicate-review' } as any,
    };
    const paper = q.examId && q.year && q.shift ? { examId: q.examId, year: q.year, shift: q.shift, paperCode: q.paperCode ?? null, examDate: q.examDate ?? null } : null;
    if (ctx) {
      // bulk run: audit + cache clear + mock rebuild happen once, in flushBulk()
      ctx.audits.push(audit);
      if (paper) ctx.papers.set(`${paper.examId}|${paper.year}|${paper.shift}|${paper.paperCode ?? ''}`, paper);
      return;
    }
    try {
      await this.prisma.auditLog.create({ data: audit });
    } catch {
      /* audit is best effort */
    }
    this.clearBankCaches();
    if (paper) {
      try {
        await this.upload.upsertPyqMockForPaper(paper.examId, paper.year, paper.shift, paper.paperCode, paper.examDate);
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
      examTier: true,
      tierPaper: true,
      paperQuestionNo: true,
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
      examTier: q.examTier ?? null,
      tierPaper: q.tierPaper ?? null,
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
      examTier: c.examTier ?? null,
      tierPaper: c.tierPaper ?? null,
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
