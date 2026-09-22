/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { cacheClearPrefix } from '../common/cache';
import { QuestionKind, kindWhere, parseQuestionKind } from '../common/question-visibility';

// =============================================================================
// BankAdminService  (NEW — Sep 21 2026)
//
// Everything an admin needs to *manage* questions and the syllabus tree after
// upload, in one place, without touching the (already very large)
// bank.service.ts / bank-upload.service.ts:
//
//   1. Question manager  — list/search questions by exam/subject/chapter/topic/
//      sub-topic/kind(PYQ|Practice)/upload-batch/status, then MOVE (re-align)
//      selected questions or a whole filtered set into a chapter/topic/sub-topic
//      chosen from a DROPDOWN (no typing, so no typos), publish/unpublish, or
//      delete them.
//   2. Taxonomy edit     — rename chapter/topic/sub-topic (English + Hindi),
//      delete an empty chapter/subject, delete a topic (questions are detached,
//      never deleted), and MERGE duplicate chapters/topics (the "Spotting
//      Errors" vs "Spotting Errors / त्रुटि पहचानना" duplicate that syllabus
//      import + old seed data can create).
//
// Every destructive path here is deliberately conservative:
//   * Question rows that students have already attempted (AttemptAnswer has a
//     RESTRICT foreign key to Question) are SOFT-deleted (hidden), never hard
//     deleted, so a student's result history can never break.
//   * A filter-based bulk action refuses to run with an empty filter, so
//     "delete everything" can never happen by one mis-click.
// =============================================================================

export interface AdminQuestionFilter {
  examId?: string;
  subjectId?: string;
  chapterId?: string;
  /** a topic id, or the literal string "none" = questions that have NO topic yet */
  topicId?: string;
  /** a sub-topic id, or the literal string "none" = questions that have NO sub-topic yet */
  subTopicId?: string;
  kind?: QuestionKind;
  batchId?: string;
  /** live = visible to students, pending = waiting for approval, hidden = deactivated/suspended */
  status?: 'live' | 'pending' | 'hidden';
  year?: number;
  /** free-text search inside question text (English or Hindi) */
  q?: string;
}

export interface MoveTarget {
  chapterId?: string;
  topicId?: string | null;
  subTopicId?: string | null;
}

const MAX_BULK = 5000;

@Injectable()
export class BankAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  private clearCaches(): void {
    cacheClearPrefix('bank:subjects');
    cacheClearPrefix('bank:chapters');
    cacheClearPrefix('bank:meta');
    cacheClearPrefix('bank:years');
    cacheClearPrefix('bank:shifts');
  }

  /** Normalises whatever the query string / JSON body sent into a typed filter. */
  parseFilter(raw: any): AdminQuestionFilter {
    const f: AdminQuestionFilter = {};
    const str = (v: any): string | undefined => {
      if (v === undefined || v === null) return undefined;
      const s = String(v).trim();
      return s ? s : undefined;
    };
    f.examId = str(raw?.examId);
    f.subjectId = str(raw?.subjectId);
    f.chapterId = str(raw?.chapterId);
    f.topicId = str(raw?.topicId);
    f.subTopicId = str(raw?.subTopicId);
    f.batchId = str(raw?.batchId);
    f.q = str(raw?.q);
    f.kind = parseQuestionKind(str(raw?.kind));
    const st = str(raw?.status);
    if (st === 'live' || st === 'pending' || st === 'hidden') f.status = st;
    const yr = str(raw?.year);
    if (yr && /^\d{4}$/.test(yr)) f.year = parseInt(yr, 10);
    return f;
  }

  private isEmptyFilter(f: AdminQuestionFilter): boolean {
    return !(f.examId || f.subjectId || f.chapterId || f.topicId || f.subTopicId || f.kind || f.batchId || f.status || f.year || f.q);
  }

  buildWhere(f: AdminQuestionFilter): Prisma.QuestionWhereInput {
    const where: Prisma.QuestionWhereInput = {};
    const and: Prisma.QuestionWhereInput[] = [];
    if (f.examId) where.examId = f.examId;
    if (f.subjectId) where.subjectId = f.subjectId;
    if (f.chapterId) where.chapterId = f.chapterId;
    if (f.topicId) where.topicId = f.topicId === 'none' ? null : f.topicId;
    if (f.subTopicId) where.subTopicId = f.subTopicId === 'none' ? null : f.subTopicId;
    if (f.batchId) where.uploadBatchId = f.batchId;
    if (f.year) where.year = f.year;
    const kw = kindWhere(f.kind);
    if (kw.year !== undefined && !f.year) where.year = kw.year as any;
    if (f.status === 'live') {
      where.isApproved = true;
      where.isActive = true;
      where.autoSuspended = false;
    } else if (f.status === 'pending') {
      where.isApproved = false;
      where.isActive = true;
    } else if (f.status === 'hidden') {
      and.push({ OR: [{ isActive: false }, { autoSuspended: true }] });
    }
    if (f.q) {
      and.push({
        OR: [
          { questionText: { contains: f.q, mode: 'insensitive' } },
          { questionTextHindi: { contains: f.q, mode: 'insensitive' } },
        ],
      });
    }
    if (and.length) where.AND = and;
    return where;
  }

  /** Resolves "these ids" or "everything matching this filter" into a concrete id list. */
  private async resolveTargetIds(ids?: string[], filter?: AdminQuestionFilter): Promise<string[]> {
    if (Array.isArray(ids) && ids.length > 0) {
      const clean = [...new Set(ids.map((i) => String(i)).filter(Boolean))];
      if (clean.length > MAX_BULK) {
        throw new BadRequestException(`Ek baar me maximum ${MAX_BULK} questions select kar sakte hain (aapne ${clean.length} diye).`);
      }
      return clean;
    }
    if (filter) {
      if (this.isEmptyFilter(filter)) {
        throw new BadRequestException(
          'Koi filter select nahi hai — poore question bank par ek saath action allowed nahi hai (galti se sab delete/move na ho jaye). Pehle exam/subject/chapter/upload-batch me se koi filter lagayein.',
        );
      }
      const rows = await this.prisma.question.findMany({
        where: this.buildWhere(filter),
        select: { id: true },
        take: MAX_BULK + 1,
      });
      if (rows.length > MAX_BULK) {
        throw new BadRequestException(`Filter se ${MAX_BULK}+ questions match ho rahe hain — filter aur narrow karein (ek baar me max ${MAX_BULK}).`);
      }
      return rows.map((r) => r.id);
    }
    throw new BadRequestException('Provide either ids[] or a filter');
  }

  // ---------------------------------------------------------------------------
  // 1. question manager
  // ---------------------------------------------------------------------------

  async listQuestions(f: AdminQuestionFilter, skip = 0, take = 30) {
    const where = this.buildWhere(f);
    const limit = Math.min(Math.max(take, 1), 100);
    const [total, rows] = await Promise.all([
      this.prisma.question.count({ where }),
      this.prisma.question.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: Math.max(skip, 0),
        take: limit,
        select: {
          id: true,
          questionText: true,
          questionTextHindi: true,
          correctAnswer: true,
          year: true,
          shift: true,
          paperCode: true,
          isApproved: true,
          isActive: true,
          autoSuspended: true,
          reviewStatus: true,
          uploadBatchId: true,
          createdAt: true,
          exam: { select: { id: true, name: true } },
          subject: { select: { id: true, name: true } },
          chapter: { select: { id: true, name: true } },
          topic: { select: { id: true, name: true } },
          subTopic: { select: { id: true, name: true } },
        },
      }),
    ]);
    return {
      total,
      data: rows.map((r) => ({
        id: r.id,
        questionText: r.questionText.length > 400 ? r.questionText.slice(0, 400) + '…' : r.questionText,
        hasHindi: !!(r.questionTextHindi && r.questionTextHindi.trim()),
        correctAnswer: r.correctAnswer,
        year: r.year,
        shift: r.shift,
        paperCode: r.paperCode,
        kind: r.year != null ? 'pyq' : 'practice',
        isApproved: r.isApproved,
        isActive: r.isActive,
        autoSuspended: r.autoSuspended,
        reviewStatus: r.reviewStatus,
        status: r.isApproved && r.isActive && !r.autoSuspended ? 'live' : !r.isApproved && r.isActive ? 'pending' : 'hidden',
        uploadBatchId: r.uploadBatchId,
        createdAt: r.createdAt,
        exam: r.exam,
        subject: r.subject,
        chapter: r.chapter,
        topic: r.topic,
        subTopic: r.subTopic,
      })),
    };
  }

  /** Headline numbers for the manager page header + the "unaligned PYQ" nudge. */
  async stats(examId?: string) {
    const base: Prisma.QuestionWhereInput = examId ? { examId } : {};
    const [total, pyq, practice, live, pending, pyqNoTopic, practiceNoTopic] = await Promise.all([
      this.prisma.question.count({ where: base }),
      this.prisma.question.count({ where: { ...base, year: { not: null } } }),
      this.prisma.question.count({ where: { ...base, year: null } }),
      this.prisma.question.count({ where: { ...base, isApproved: true, isActive: true, autoSuspended: false } }),
      this.prisma.question.count({ where: { ...base, isApproved: false, isActive: true } }),
      this.prisma.question.count({ where: { ...base, year: { not: null }, topicId: null } }),
      this.prisma.question.count({ where: { ...base, year: null, topicId: null } }),
    ]);
    return { total, pyq, practice, live, pending, pyqWithoutTopic: pyqNoTopic, practiceWithoutTopic: practiceNoTopic };
  }

  /**
   * Re-align questions to a chapter / topic / sub-topic. Only the deepest level
   * given is needed — its parents are derived from the database, so the
   * hierarchy can never end up inconsistent (a sub-topic under the wrong topic,
   * a topic under the wrong chapter…).
   */
  async moveQuestions(input: { ids?: string[]; filter?: AdminQuestionFilter; target: MoveTarget }, adminId?: string) {
    const target = input?.target ?? {};
    let data: { subjectId?: string; chapterId?: string; topicId?: string | null; subTopicId?: string | null };

    if (target.subTopicId) {
      const sub = await this.prisma.subTopic.findUnique({
        where: { id: target.subTopicId },
        select: { id: true, topicId: true, topic: { select: { id: true, chapterId: true, chapter: { select: { id: true, subjectId: true } } } } },
      });
      if (!sub) throw new BadRequestException('Sub-topic not found');
      data = {
        subjectId: sub.topic.chapter.subjectId,
        chapterId: sub.topic.chapterId,
        topicId: sub.topicId,
        subTopicId: sub.id,
      };
    } else if (target.topicId) {
      const topic = await this.prisma.topic.findUnique({
        where: { id: target.topicId },
        select: { id: true, chapterId: true, chapter: { select: { subjectId: true } } },
      });
      if (!topic) throw new BadRequestException('Topic not found');
      data = { subjectId: topic.chapter.subjectId, chapterId: topic.chapterId, topicId: topic.id, subTopicId: null };
    } else if (target.chapterId) {
      const chapter = await this.prisma.chapter.findUnique({ where: { id: target.chapterId }, select: { id: true, subjectId: true } });
      if (!chapter) throw new BadRequestException('Chapter not found');
      data = { subjectId: chapter.subjectId, chapterId: chapter.id, topicId: null, subTopicId: null };
    } else {
      throw new BadRequestException('Target chapter / topic / sub-topic select karein');
    }

    const ids = await this.resolveTargetIds(input.ids, input.filter);
    if (ids.length === 0) return { moved: 0 };
    const res = await this.prisma.question.updateMany({ where: { id: { in: ids } }, data });
    this.clearCaches();
    await this.audit(adminId, 'QUESTION_BULK_MOVED', { count: res.count, target: data });
    return { moved: res.count, target: data };
  }

  /** Publish (approve) or hide (deactivate) many questions at once. */
  async setVisibility(input: { ids?: string[]; filter?: AdminQuestionFilter; action: 'publish' | 'unpublish' }, adminId?: string) {
    const ids = await this.resolveTargetIds(input.ids, input.filter);
    if (ids.length === 0) return { updated: 0 };
    let res: { count: number };
    if (input.action === 'publish') {
      res = await this.prisma.question.updateMany({
        where: { id: { in: ids } },
        data: { isApproved: true, isActive: true, autoSuspended: false, reviewStatus: 'APPROVED' },
      });
    } else if (input.action === 'unpublish') {
      res = await this.prisma.question.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
    } else {
      throw new BadRequestException('action must be "publish" or "unpublish"');
    }
    this.clearCaches();
    await this.audit(adminId, input.action === 'publish' ? 'QUESTION_BULK_PUBLISHED' : 'QUESTION_BULK_UNPUBLISHED', { count: res.count });
    return { updated: res.count };
  }

  /**
   * Delete questions. Rows a student has already answered can't be hard-deleted
   * (AttemptAnswer.question is a RESTRICT FK — deleting would either fail or
   * wipe someone's result history), so those are hidden instead and reported
   * separately as `hidden`.
   */
  async deleteQuestions(input: { ids?: string[]; filter?: AdminQuestionFilter }, adminId?: string) {
    const ids = await this.resolveTargetIds(input.ids, input.filter);
    return this.deleteQuestionIds(ids, adminId);
  }

  /** Shared by the batch-scoped delete in BankUploadService. */
  async deleteQuestionIds(ids: string[], adminId?: string): Promise<{ deleted: number; hidden: number }> {
    if (ids.length === 0) return { deleted: 0, hidden: 0 };
    const attempted = await this.prisma.attemptAnswer.findMany({
      where: { questionId: { in: ids } },
      select: { questionId: true },
      distinct: ['questionId'],
    });
    const attemptedIds = new Set(attempted.map((a) => a.questionId));
    const deletable = ids.filter((id) => !attemptedIds.has(id));
    const toHide = ids.filter((id) => attemptedIds.has(id));

    let deleted = 0;
    // chunked so a 5000-id IN (...) never becomes one giant statement
    for (let i = 0; i < deletable.length; i += 500) {
      const chunk = deletable.slice(i, i + 500);
      const r = await this.prisma.question.deleteMany({ where: { id: { in: chunk } } });
      deleted += r.count;
    }
    let hidden = 0;
    if (toHide.length > 0) {
      const r = await this.prisma.question.updateMany({
        where: { id: { in: toHide } },
        data: { isActive: false, isApproved: false },
      });
      hidden = r.count;
    }
    this.clearCaches();
    await this.audit(adminId, 'QUESTION_BULK_DELETED', { deleted, hidden });
    return { deleted, hidden };
  }

  private async audit(adminId: string | undefined, action: string, meta: Record<string, unknown>): Promise<void> {
    if (!adminId) return;
    try {
      await this.prisma.auditLog.create({
        data: { userId: adminId, action, targetEntity: 'Question', entityId: 'bulk', metadataJson: meta as any },
      });
    } catch {
      // audit trail is best-effort — never fail the admin action itself
    }
  }

  // ---------------------------------------------------------------------------
  // 2. taxonomy edit / delete / merge
  // ---------------------------------------------------------------------------

  private cleanName(name: unknown, label: string): string {
    const n = String(name ?? '').trim();
    if (!n) throw new BadRequestException(`${label} name is required`);
    return n;
  }

  private optionalHindi(v: unknown): string | null {
    const s = String(v ?? '').trim();
    return s ? s : null;
  }

  async updateChapter(id: string, body: { name?: string; nameHindi?: string | null }) {
    const existing = await this.prisma.chapter.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Chapter not found');
    const data: { name?: string; nameHindi?: string | null } = {};
    if (body.name !== undefined) data.name = this.cleanName(body.name, 'Chapter');
    if (body.nameHindi !== undefined) data.nameHindi = this.optionalHindi(body.nameHindi);
    const out = await this.prisma.chapter.update({ where: { id }, data });
    this.clearCaches();
    return out;
  }

  async updateTopic(id: string, body: { name?: string; nameHindi?: string | null }) {
    const existing = await this.prisma.topic.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Topic not found');
    const data: { name?: string; nameHindi?: string | null } = {};
    if (body.name !== undefined) data.name = this.cleanName(body.name, 'Topic');
    if (body.nameHindi !== undefined) data.nameHindi = this.optionalHindi(body.nameHindi);
    const out = await this.prisma.topic.update({ where: { id }, data });
    this.clearCaches();
    return out;
  }

  async updateSubTopic(id: string, body: { name?: string; nameHindi?: string | null }) {
    const existing = await this.prisma.subTopic.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sub-topic not found');
    const data: { name?: string; nameHindi?: string | null } = {};
    if (body.name !== undefined) data.name = this.cleanName(body.name, 'Sub-topic');
    if (body.nameHindi !== undefined) data.nameHindi = this.optionalHindi(body.nameHindi);
    const out = await this.prisma.subTopic.update({ where: { id }, data });
    this.clearCaches();
    return out;
  }

  /** Deleting a topic never deletes questions — they just lose their topic/sub-topic. */
  async deleteTopic(id: string) {
    const existing = await this.prisma.topic.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!existing) throw new NotFoundException('Topic not found');
    const detached = await this.prisma.question.updateMany({ where: { topicId: id }, data: { topicId: null, subTopicId: null } });
    await this.prisma.topic.delete({ where: { id } }); // sub-topics cascade with the topic
    this.clearCaches();
    return { deleted: true, questionsDetached: detached.count };
  }

  /** Only an EMPTY chapter can be deleted — otherwise the admin must merge it into another chapter. */
  async deleteChapter(id: string) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!chapter) throw new NotFoundException('Chapter not found');
    const qCount = await this.prisma.question.count({ where: { chapterId: id } });
    if (qCount > 0) {
      throw new BadRequestException(
        `"${chapter.name}" me ${qCount} question(s) hain — pehle unhe kisi dusre chapter me Move karein ya is chapter ko dusre chapter me Merge karein, phir delete karein.`,
      );
    }
    const purchases = await this.prisma.chapterPurchase.count({ where: { chapterId: id } });
    if (purchases > 0) {
      throw new BadRequestException('Is chapter ke paid purchases maujood hain — delete karne se students ka purchase record chala jayega. Iski jagah Merge use karein.');
    }
    await this.prisma.chapter.delete({ where: { id } }); // topics/sub-topics cascade
    this.clearCaches();
    return { deleted: true };
  }

  /** Only a subject with ZERO questions can be deleted (e.g. the empty duplicate a syllabus import can leave behind). */
  async deleteSubject(id: string) {
    const subject = await this.prisma.subject.findUnique({ where: { id }, select: { id: true, name: true, slug: true } });
    if (!subject) throw new NotFoundException('Subject not found');
    const qCount = await this.prisma.question.count({ where: { subjectId: id } });
    if (qCount > 0) {
      throw new BadRequestException(`"${subject.name}" me ${qCount} question(s) hain — subject delete nahi ho sakta.`);
    }
    try {
      await this.prisma.subject.delete({ where: { id } }); // chapters/topics/sub-topics cascade
    } catch {
      throw new BadRequestException(`"${subject.name}" ko delete nahi kar sakte — koi study-plan/PDF/aur record is subject se jude hue hain.`);
    }
    this.clearCaches();
    return { deleted: true };
  }

  /** Moves every question + sub-topic of `src` into `dst` (a topic in the same chapter or another), then removes `src`. */
  private async mergeTopicInTx(tx: Prisma.TransactionClient, srcTopicId: string, dstTopicId: string): Promise<void> {
    const [srcSubs, dstSubs] = await Promise.all([
      tx.subTopic.findMany({ where: { topicId: srcTopicId } }),
      tx.subTopic.findMany({ where: { topicId: dstTopicId } }),
    ]);
    const dstBySlug = new Map(dstSubs.map((s) => [s.slug, s]));
    for (const s of srcSubs) {
      const twin = dstBySlug.get(s.slug);
      if (twin) {
        await tx.question.updateMany({ where: { subTopicId: s.id }, data: { subTopicId: twin.id } });
        if (!twin.nameHindi && s.nameHindi) await tx.subTopic.update({ where: { id: twin.id }, data: { nameHindi: s.nameHindi } });
        await tx.subTopic.delete({ where: { id: s.id } });
      } else {
        await tx.subTopic.update({ where: { id: s.id }, data: { topicId: dstTopicId } });
      }
    }
    await tx.question.updateMany({ where: { topicId: srcTopicId }, data: { topicId: dstTopicId } });
    const [src, dst] = await Promise.all([
      tx.topic.findUnique({ where: { id: srcTopicId } }),
      tx.topic.findUnique({ where: { id: dstTopicId } }),
    ]);
    if (src && dst && !dst.nameHindi && src.nameHindi) {
      await tx.topic.update({ where: { id: dst.id }, data: { nameHindi: src.nameHindi } });
    }
    await tx.topic.delete({ where: { id: srcTopicId } });
  }

  /** Merge one topic into another topic of the SAME chapter. */
  async mergeTopic(sourceId: string, targetId: string) {
    if (sourceId === targetId) throw new BadRequestException('Source aur target topic same hain');
    const [src, dst] = await Promise.all([
      this.prisma.topic.findUnique({ where: { id: sourceId } }),
      this.prisma.topic.findUnique({ where: { id: targetId } }),
    ]);
    if (!src || !dst) throw new NotFoundException('Topic not found');
    if (src.chapterId !== dst.chapterId) throw new BadRequestException('Sirf ek hi chapter ke andar ke topics merge ho sakte hain');
    await this.prisma.$transaction(async (tx) => this.mergeTopicInTx(tx, sourceId, targetId), { timeout: 60000 });
    this.clearCaches();
    return { merged: true };
  }

  /**
   * Merge a duplicate chapter into the chapter you want to keep (same subject
   * only). All questions, topics, sub-topics and paid chapter purchases move
   * over; topics with the same slug are merged instead of duplicated; then the
   * now-empty duplicate chapter is deleted.
   */
  async mergeChapter(sourceId: string, targetId: string) {
    if (sourceId === targetId) throw new BadRequestException('Source aur target chapter same hain');
    const [src, dst] = await Promise.all([
      this.prisma.chapter.findUnique({ where: { id: sourceId } }),
      this.prisma.chapter.findUnique({ where: { id: targetId } }),
    ]);
    if (!src || !dst) throw new NotFoundException('Chapter not found');
    if (src.subjectId !== dst.subjectId) throw new BadRequestException('Sirf ek hi subject ke chapters merge ho sakte hain');

    const summary = await this.prisma.$transaction(
      async (tx) => {
        const [srcTopics, dstTopics] = await Promise.all([
          tx.topic.findMany({ where: { chapterId: sourceId } }),
          tx.topic.findMany({ where: { chapterId: targetId } }),
        ]);
        const dstBySlug = new Map(dstTopics.map((t) => [t.slug, t]));
        let topicsMerged = 0;
        let topicsMoved = 0;
        for (const t of srcTopics) {
          const twin = dstBySlug.get(t.slug);
          if (twin) {
            await this.mergeTopicInTx(tx, t.id, twin.id);
            topicsMerged++;
          } else {
            await tx.topic.update({ where: { id: t.id }, data: { chapterId: targetId } });
            topicsMoved++;
          }
        }
        const moved = await tx.question.updateMany({ where: { chapterId: sourceId }, data: { chapterId: targetId } });

        // paid chapter purchases: keep one per user
        const purchases = await tx.chapterPurchase.findMany({ where: { chapterId: sourceId } });
        for (const p of purchases) {
          const already = await tx.chapterPurchase.findUnique({ where: { userId_chapterId: { userId: p.userId, chapterId: targetId } } });
          if (already) await tx.chapterPurchase.delete({ where: { id: p.id } });
          else await tx.chapterPurchase.update({ where: { id: p.id }, data: { chapterId: targetId } });
        }

        if (!dst.nameHindi && src.nameHindi) {
          await tx.chapter.update({ where: { id: targetId }, data: { nameHindi: src.nameHindi } });
        }
        await tx.chapter.delete({ where: { id: sourceId } });
        return { questionsMoved: moved.count, topicsMerged, topicsMoved };
      },
      { timeout: 120000 },
    );
    this.clearCaches();
    return { merged: true, ...summary };
  }
}
