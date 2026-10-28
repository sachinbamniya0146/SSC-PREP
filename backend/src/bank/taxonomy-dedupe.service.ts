/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SearchService } from '../search/search.service';
import { cacheClearPrefix } from '../common/cache';
import { findTaxonomyTwin } from '../common/taxonomy-key';
import {
  DupGroup,
  TaxRow,
  WeakRowLite,
  planDuplicateGroups,
  planWeakTopicMerge,
  uniqueSlug,
  weakScopeKey,
} from '../common/taxonomy-merge';

// ---------------------------------------------------------------------------
// What a merge writes to taxonomy_merge_logs.payload — enough to undo it.
// ---------------------------------------------------------------------------
type MoveModel = 'question' | 'questionBankSet' | 'weakTopicReport' | 'subTopic';
interface MoveLog {
  model: MoveModel;
  field: 'topicId' | 'subTopicId';
  from: string | null;
  to: string | null;
  ids: string[];
}
interface TopicRowLog { id: string; chapterId: string; name: string; nameHindi: string | null; slug: string }
interface SubTopicRowLog { id: string; topicId: string; name: string; nameHindi: string | null; slug: string }
interface WeakRowJson extends Omit<WeakRowLite, 'firstDetectedAt' | 'lastDetectedAt'> {
  subjectId: string | null;
  lastPracticeScore: number | null;
  lastSourceAttemptId: string | null;
  strengthenedAt: string | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
}
interface MergeLogPayload {
  version: 1;
  deletedTopic: TopicRowLog | null;
  deletedSubTopics: SubTopicRowLog[];
  subTopicSlugBefore: { id: string; slug: string }[];
  hindiBefore: { model: 'topic' | 'subTopic'; id: string; nameHindi: string | null }[];
  moves: MoveLog[];
  weakRekeyBefore: { id: string; topicId: string | null; subTopicId: string | null; scopeKey: string }[];
  weakFoldBefore: { ownerBefore: WeakRowJson; deleted: WeakRowJson }[];
}

const emptyPayload = (): MergeLogPayload => ({
  version: 1,
  deletedTopic: null,
  deletedSubTopics: [],
  subTopicSlugBefore: [],
  hindiBefore: [],
  moves: [],
  weakRekeyBefore: [],
  weakFoldBefore: [],
});

const CHUNK = 5000;
function chunks<T>(arr: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const toJson = (r: any): WeakRowJson => ({
  id: r.id,
  userId: r.userId,
  subjectId: r.subjectId ?? null,
  chapterId: r.chapterId ?? null,
  topicId: r.topicId ?? null,
  subTopicId: r.subTopicId ?? null,
  scopeKey: r.scopeKey,
  status: r.status,
  wrongCount: r.wrongCount,
  attemptedCount: r.attemptedCount,
  practiceSetsDone: r.practiceSetsDone,
  practiceCorrect: r.practiceCorrect,
  practiceTotal: r.practiceTotal,
  lastPracticeScore: r.lastPracticeScore ?? null,
  lastSourceAttemptId: r.lastSourceAttemptId ?? null,
  firstDetectedAt: new Date(r.firstDetectedAt).toISOString(),
  lastDetectedAt: new Date(r.lastDetectedAt).toISOString(),
  strengthenedAt: r.strengthenedAt ? new Date(r.strengthenedAt).toISOString() : null,
});

const toLite = (r: any): WeakRowLite => ({
  id: r.id,
  userId: r.userId,
  chapterId: r.chapterId ?? null,
  topicId: r.topicId ?? null,
  subTopicId: r.subTopicId ?? null,
  scopeKey: r.scopeKey,
  status: r.status,
  wrongCount: r.wrongCount,
  attemptedCount: r.attemptedCount,
  practiceSetsDone: r.practiceSetsDone,
  practiceCorrect: r.practiceCorrect,
  practiceTotal: r.practiceTotal,
  firstDetectedAt: r.firstDetectedAt,
  lastDetectedAt: r.lastDetectedAt,
});

export interface TaxonomyAudit {
  generatedAt: string;
  summary: { topicGroups: number; subTopicGroups: number; chapterGroups: number; exactGroups: number; similarGroups: number; rowsToRemove: number };
  topics: DupGroup[];
  subTopics: DupGroup[];
  chapters: DupGroup[];
}

export interface MergeResult {
  logId: string;
  kind: 'TOPIC' | 'SUBTOPIC';
  survivorId: string;
  loserId: string;
  questionsMoved: number;
  subTopicsMoved: number;
  subTopicsMerged: number;
  weakRowsMoved: number;
}

@Injectable()
export class TaxonomyDedupeService {
  private readonly logger = new Logger(TaxonomyDedupeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly search?: SearchService,
  ) {}

  private clearCaches(): void {
    for (const p of ['bank:subjects', 'bank:chapters', 'bank:meta', 'bank:years', 'bank:shifts', 'bank:tiers', 'bank:topics', 'bank:subtopics']) cacheClearPrefix(p);
  }

  // =========================================================================
  // AUDIT
  // =========================================================================
  async audit(): Promise<TaxonomyAudit> {
    const [topics, subTopics, chapters] = await Promise.all([
      this.prisma.topic.findMany({
        select: { id: true, chapterId: true, name: true, nameHindi: true, slug: true, _count: { select: { questions: true } } },
      }),
      this.prisma.subTopic.findMany({
        select: { id: true, topicId: true, name: true, nameHindi: true, slug: true, topic: { select: { chapterId: true } }, _count: { select: { questions: true } } },
      }),
      this.prisma.chapter.findMany({
        select: { id: true, subjectId: true, name: true, nameHindi: true, slug: true, _count: { select: { questions: true } } },
      }),
    ]);

    const byChapter = new Map<string, TaxRow[]>();
    for (const t of topics) {
      const list = byChapter.get(t.chapterId) ?? [];
      list.push({ id: t.id, parentId: t.chapterId, name: t.name, nameHindi: t.nameHindi, slug: t.slug, questionCount: t._count.questions });
      byChapter.set(t.chapterId, list);
    }
    // sub-topics are compared across ALL topics of the same chapter
    const subByChapter = new Map<string, TaxRow[]>();
    for (const s of subTopics) {
      const ch = s.topic.chapterId;
      const list = subByChapter.get(ch) ?? [];
      list.push({ id: s.id, parentId: s.topicId, name: s.name, nameHindi: s.nameHindi, slug: s.slug, questionCount: s._count.questions });
      subByChapter.set(ch, list);
    }
    const bySubject = new Map<string, TaxRow[]>();
    for (const c of chapters) {
      const list = bySubject.get(c.subjectId) ?? [];
      list.push({ id: c.id, parentId: c.subjectId, name: c.name, nameHindi: c.nameHindi, slug: c.slug, questionCount: c._count.questions });
      bySubject.set(c.subjectId, list);
    }

    const topicGroups = planDuplicateGroups('TOPIC', byChapter);
    const subGroups = planDuplicateGroups('SUBTOPIC', subByChapter);
    const chapterGroups = planDuplicateGroups('CHAPTER', bySubject);
    const all = [...topicGroups, ...subGroups, ...chapterGroups];
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        topicGroups: topicGroups.length,
        subTopicGroups: subGroups.length,
        chapterGroups: chapterGroups.length,
        exactGroups: all.filter((g) => g.reason !== 'similar').length,
        similarGroups: all.filter((g) => g.reason === 'similar').length,
        rowsToRemove: all.filter((g) => g.reason !== 'similar').reduce((n, g) => n + g.loserIds.length, 0),
      },
      topics: topicGroups,
      subTopics: subGroups,
      chapters: chapterGroups,
    };
  }

  // =========================================================================
  // MERGE (one loser into one survivor; groups call this loser by loser)
  // =========================================================================
  async mergeTopics(survivorId: string, loserId: string, actorId?: string): Promise<MergeResult> {
    if (survivorId === loserId) throw new BadRequestException('The survivor and the loser are the same');
    const [survivor, loser] = await Promise.all([
      this.prisma.topic.findUnique({ where: { id: survivorId } }),
      this.prisma.topic.findUnique({ where: { id: loserId } }),
    ]);
    if (!survivor || !loser) throw new NotFoundException('Topic not found');
    if (survivor.chapterId !== loser.chapterId) throw new BadRequestException('Only topics within the same chapter can be merged');

    const payload = emptyPayload();
    const touchedQuestionIds = new Set<string>();
    let subTopicsMoved = 0;
    let subTopicsMerged = 0;
    let weakRowsMoved = 0;
    let questionsMoved = 0;

    await this.prisma.$transaction(
      async (tx) => {
        payload.deletedTopic = { id: loser.id, chapterId: loser.chapterId, name: loser.name, nameHindi: loser.nameHindi, slug: loser.slug };

        const [loserSubs, survivorSubs] = await Promise.all([
          tx.subTopic.findMany({ where: { topicId: loserId } }),
          tx.subTopic.findMany({ where: { topicId: survivorId } }),
        ]);
        const takenSlugs = new Set(survivorSubs.map((s) => s.slug));
        const subRemap = new Map<string, string>();

        for (const s of loserSubs) {
          const twinHit = findTaxonomyTwin(survivorSubs, s.name, s.nameHindi);
          const twin = twinHit && twinHit.kind !== 'similar' ? twinHit.row : survivorSubs.find((x) => x.slug === s.slug);
          if (twin) {
            const moved = await this.repoint(tx, payload, 'question', 'subTopicId', s.id, twin.id, touchedQuestionIds);
            questionsMoved += moved;
            await this.repoint(tx, payload, 'questionBankSet', 'subTopicId', s.id, twin.id);
            subRemap.set(s.id, twin.id);
            if (!twin.nameHindi && s.nameHindi) {
              payload.hindiBefore.push({ model: 'subTopic', id: twin.id, nameHindi: twin.nameHindi });
              await tx.subTopic.update({ where: { id: twin.id }, data: { nameHindi: s.nameHindi } });
              twin.nameHindi = s.nameHindi;
            }
            payload.deletedSubTopics.push({ id: s.id, topicId: s.topicId, name: s.name, nameHindi: s.nameHindi, slug: s.slug });
            await tx.subTopic.delete({ where: { id: s.id } });
            subTopicsMerged++;
          } else {
            const slug = uniqueSlug(s.slug, takenSlugs);
            takenSlugs.add(slug);
            if (slug !== s.slug) payload.subTopicSlugBefore.push({ id: s.id, slug: s.slug });
            await tx.subTopic.update({ where: { id: s.id }, data: { topicId: survivorId, slug } });
            payload.moves.push({ model: 'subTopic', field: 'topicId', from: loserId, to: survivorId, ids: [s.id] });
            subTopicsMoved++;
          }
        }

        // weak-topic rows first (they read the OLD ids), then the id columns
        weakRowsMoved += await this.rekeyWeakRows(tx, payload, { topic: new Map([[loserId, survivorId]]), subTopic: subRemap }, loserId, [...subRemap.keys()]);

        questionsMoved += await this.repoint(tx, payload, 'question', 'topicId', loserId, survivorId, touchedQuestionIds);
        await this.repoint(tx, payload, 'questionBankSet', 'topicId', loserId, survivorId);
        await this.repoint(tx, payload, 'weakTopicReport', 'topicId', loserId, survivorId);

        if (!survivor.nameHindi && loser.nameHindi) {
          payload.hindiBefore.push({ model: 'topic', id: survivorId, nameHindi: survivor.nameHindi });
          await tx.topic.update({ where: { id: survivorId }, data: { nameHindi: loser.nameHindi } });
        }

        const left = await tx.subTopic.count({ where: { topicId: loserId } });
        if (left > 0) throw new Error(`merge aborted: ${left} sub-topic(s) still under the loser topic`);
        await tx.topic.delete({ where: { id: loserId } });
      },
      { timeout: 120000, maxWait: 15000 },
    );

    const log = await this.writeLog('TOPIC', survivor.chapterId, survivor, loser, questionsMoved, payload, actorId);
    this.afterMerge(touchedQuestionIds);
    return { logId: log.id, kind: 'TOPIC', survivorId, loserId, questionsMoved, subTopicsMoved, subTopicsMerged, weakRowsMoved };
  }

  /** Sub-topic duplicates: the loser may sit under a DIFFERENT topic of the same chapter. */
  async mergeSubTopics(survivorId: string, loserId: string, actorId?: string): Promise<MergeResult> {
    if (survivorId === loserId) throw new BadRequestException('The survivor and the loser are the same');
    const [survivor, loser] = await Promise.all([
      this.prisma.subTopic.findUnique({ where: { id: survivorId }, include: { topic: { select: { chapterId: true } } } }),
      this.prisma.subTopic.findUnique({ where: { id: loserId }, include: { topic: { select: { chapterId: true } } } }),
    ]);
    if (!survivor || !loser) throw new NotFoundException('Sub-topic not found');
    if (survivor.topic.chapterId !== loser.topic.chapterId) throw new BadRequestException('Only sub-topics within the same chapter can be merged');

    const payload = emptyPayload();
    const touchedQuestionIds = new Set<string>();
    let questionsMoved = 0;
    let weakRowsMoved = 0;

    await this.prisma.$transaction(
      async (tx) => {
        payload.deletedSubTopics.push({ id: loser.id, topicId: loser.topicId, name: loser.name, nameHindi: loser.nameHindi, slug: loser.slug });
        const crossTopic = loser.topicId !== survivor.topicId;

        weakRowsMoved += await this.rekeyWeakRows(
          tx,
          payload,
          { topic: crossTopic ? new Map([[loser.topicId, survivor.topicId]]) : new Map<string, string>(), subTopic: new Map([[loserId, survivorId]]) },
          null,
          [loserId],
        );

        // questions: sub-topic → survivor, topic → survivor's topic (so Question.topicId never disagrees with its sub-topic)
        const qs = await tx.question.findMany({ where: { subTopicId: loserId }, select: { id: true, topicId: true } });
        if (qs.length) {
          const byPrevTopic = new Map<string | null, string[]>();
          for (const q of qs) byPrevTopic.set(q.topicId, [...(byPrevTopic.get(q.topicId) ?? []), q.id]);
          for (const [prevTopic, ids] of byPrevTopic) {
            for (const part of chunks(ids)) {
              await tx.question.updateMany({ where: { id: { in: part } }, data: { subTopicId: survivorId, topicId: survivor.topicId } });
            }
            payload.moves.push({ model: 'question', field: 'subTopicId', from: loserId, to: survivorId, ids });
            if (prevTopic !== survivor.topicId) payload.moves.push({ model: 'question', field: 'topicId', from: prevTopic, to: survivor.topicId, ids });
            ids.forEach((id) => touchedQuestionIds.add(id));
          }
          questionsMoved = qs.length;
        }
        await this.repoint(tx, payload, 'questionBankSet', 'subTopicId', loserId, survivorId);
        if (crossTopic) await this.repoint(tx, payload, 'questionBankSet', 'topicId', loser.topicId, survivor.topicId, undefined, { subTopicId: survivorId });

        if (!survivor.nameHindi && loser.nameHindi) {
          payload.hindiBefore.push({ model: 'subTopic', id: survivorId, nameHindi: survivor.nameHindi });
          await tx.subTopic.update({ where: { id: survivorId }, data: { nameHindi: loser.nameHindi } });
        }
        await tx.subTopic.delete({ where: { id: loserId } });
      },
      { timeout: 120000, maxWait: 15000 },
    );

    const log = await this.writeLog('SUBTOPIC', survivor.topic.chapterId, survivor, loser, questionsMoved, payload, actorId);
    this.afterMerge(touchedQuestionIds);
    return { logId: log.id, kind: 'SUBTOPIC', survivorId, loserId, questionsMoved, subTopicsMoved: 0, subTopicsMerged: 0, weakRowsMoved };
  }

  /** Merges every loser of one audit group into its survivor. */
  async mergeGroup(kind: 'TOPIC' | 'SUBTOPIC', survivorId: string, loserIds: string[], actorId?: string): Promise<MergeResult[]> {
    const out: MergeResult[] = [];
    for (const id of [...new Set(loserIds)].filter((x) => x !== survivorId)) {
      out.push(kind === 'TOPIC' ? await this.mergeTopics(survivorId, id, actorId) : await this.mergeSubTopics(survivorId, id, actorId));
    }
    return out;
  }

  /** Same-name / same-Hindi groups only — fuzzy ("similar") groups always need a human. */
  async mergeAllExact(actorId?: string, dryRun = true): Promise<{ dryRun: boolean; groups: number; losersMerged: number; results: MergeResult[] }> {
    const audit = await this.audit();
    const groups = [...audit.topics, ...audit.subTopics].filter((g) => g.reason !== 'similar');
    if (dryRun) return { dryRun: true, groups: groups.length, losersMerged: groups.reduce((n, g) => n + g.loserIds.length, 0), results: [] };
    const results: MergeResult[] = [];
    // topics first: they pull their sub-topics into the survivor, which may create/resolve sub-topic duplicates
    for (const g of audit.topics.filter((x) => x.reason !== 'similar')) results.push(...(await this.mergeGroup('TOPIC', g.survivorId, g.loserIds, actorId)));
    // re-audit sub-topics because topic merges changed their parents / removed some rows
    const fresh = await this.audit();
    for (const g of fresh.subTopics.filter((x) => x.reason !== 'similar')) results.push(...(await this.mergeGroup('SUBTOPIC', g.survivorId, g.loserIds, actorId)));
    return { dryRun: false, groups: groups.length, losersMerged: results.length, results };
  }

  // =========================================================================
  // UNDO + LOG LIST
  // =========================================================================
  async listLog(take = 50) {
    return this.prisma.taxonomyMergeLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 200),
      select: { id: true, kind: true, chapterId: true, survivorId: true, loserId: true, survivorName: true, loserName: true, questionsMoved: true, actorId: true, createdAt: true, undoneAt: true },
    });
  }

  async undo(logId: string): Promise<{ undone: true; questionsRestored: number }> {
    const log = await this.prisma.taxonomyMergeLog.findUnique({ where: { id: logId } });
    if (!log) throw new NotFoundException('Merge log not found');
    if (log.undoneAt) throw new BadRequestException('This merge has already been undone');
    const p = log.payload as unknown as MergeLogPayload;
    if (!p || p.version !== 1) throw new BadRequestException('This log format is not supported for undo');

    // a LATER merge that used the survivor as a loser must be undone first
    const later = await this.prisma.taxonomyMergeLog.count({ where: { loserId: log.survivorId, undoneAt: null, createdAt: { gt: log.createdAt } } });
    if (later > 0) throw new BadRequestException('This survivor was later made the loser of another merge — undo that merge first');

    const touched = new Set<string>();
    const restoredIds = new Set<string>();
    await this.prisma.$transaction(
      async (tx) => {
        if (p.deletedTopic) {
          if (await tx.topic.findUnique({ where: { id: p.deletedTopic.id }, select: { id: true } })) throw new BadRequestException('The place to restore the topic is already occupied');
          await tx.topic.create({ data: p.deletedTopic });
        }
        for (const s of p.deletedSubTopics) {
          if (await tx.subTopic.findUnique({ where: { id: s.id }, select: { id: true } })) throw new BadRequestException('The place to restore the sub-topic is already occupied');
          await tx.subTopic.create({ data: s });
        }
        for (const m of [...p.moves].reverse()) {
          for (const part of chunks(m.ids)) {
            if (m.model === 'subTopic') await tx.subTopic.updateMany({ where: { id: { in: part } }, data: { topicId: m.from ?? undefined } });
            else if (m.model === 'question') {
              await tx.question.updateMany({ where: { id: { in: part } }, data: { [m.field]: m.from } as any });
              part.forEach((id) => {
                touched.add(id);
                restoredIds.add(id);
              });
            } else if (m.model === 'questionBankSet') await tx.questionBankSet.updateMany({ where: { id: { in: part } }, data: { [m.field]: m.from } as any });
            else await tx.weakTopicReport.updateMany({ where: { id: { in: part } }, data: { topicId: m.from } });
          }
        }
        for (const s of p.subTopicSlugBefore) await tx.subTopic.update({ where: { id: s.id }, data: { slug: s.slug } });
        for (const h of p.hindiBefore) {
          if (h.model === 'topic') await tx.topic.update({ where: { id: h.id }, data: { nameHindi: h.nameHindi } });
          else await tx.subTopic.update({ where: { id: h.id }, data: { nameHindi: h.nameHindi } });
        }
        // weak-topic rows
        for (const r of p.weakRekeyBefore) await tx.userWeakTopic.update({ where: { id: r.id }, data: { topicId: r.topicId, subTopicId: r.subTopicId, scopeKey: r.scopeKey } });
        for (const f of p.weakFoldBefore) {
          const o = f.ownerBefore;
          await tx.userWeakTopic.update({
            where: { id: o.id },
            data: {
              status: o.status, wrongCount: o.wrongCount, attemptedCount: o.attemptedCount, practiceSetsDone: o.practiceSetsDone,
              practiceCorrect: o.practiceCorrect, practiceTotal: o.practiceTotal, lastPracticeScore: o.lastPracticeScore,
              firstDetectedAt: new Date(o.firstDetectedAt), lastDetectedAt: new Date(o.lastDetectedAt),
              strengthenedAt: o.strengthenedAt ? new Date(o.strengthenedAt) : null,
            },
          });
          const d = f.deleted;
          await tx.userWeakTopic.create({
            data: {
              id: d.id, userId: d.userId, subjectId: d.subjectId, chapterId: d.chapterId, topicId: d.topicId, subTopicId: d.subTopicId,
              scopeKey: d.scopeKey, status: d.status, wrongCount: d.wrongCount, attemptedCount: d.attemptedCount,
              practiceSetsDone: d.practiceSetsDone, practiceCorrect: d.practiceCorrect, practiceTotal: d.practiceTotal,
              lastPracticeScore: d.lastPracticeScore, lastSourceAttemptId: d.lastSourceAttemptId,
              firstDetectedAt: new Date(d.firstDetectedAt), lastDetectedAt: new Date(d.lastDetectedAt),
              strengthenedAt: d.strengthenedAt ? new Date(d.strengthenedAt) : null,
            },
          });
        }
        await tx.taxonomyMergeLog.update({ where: { id: logId }, data: { undoneAt: new Date() } });
      },
      { timeout: 120000, maxWait: 15000 },
    );
    this.afterMerge(touched);
    return { undone: true, questionsRestored: restoredIds.size };
  }

  // =========================================================================
  // helpers
  // =========================================================================
  /** Moves `field` from → to on a model, logging the ids (so undo can put them back). Returns the row count. */
  private async repoint(
    tx: Prisma.TransactionClient,
    payload: MergeLogPayload,
    model: Exclude<MoveModel, 'subTopic'>,
    field: 'topicId' | 'subTopicId',
    from: string,
    to: string,
    touched?: Set<string>,
    extraWhere?: Record<string, string>,
  ): Promise<number> {
    const delegate = (tx as any)[model] as {
      findMany: (a: any) => Promise<{ id: string }[]>;
      updateMany: (a: any) => Promise<{ count: number }>;
    };
    const rows = await delegate.findMany({ where: { [field]: from, ...(extraWhere ?? {}) }, select: { id: true } });
    if (!rows.length) return 0;
    const ids = rows.map((r) => r.id);
    for (const part of chunks(ids)) await delegate.updateMany({ where: { id: { in: part } }, data: { [field]: to } });
    payload.moves.push({ model, field, from, to, ids });
    if (touched) ids.forEach((id) => touched.add(id));
    return ids.length;
  }

  /** UserWeakTopic rows pointing at the loser(s): re-key them, or fold into the row the user already has. */
  private async rekeyWeakRows(
    tx: Prisma.TransactionClient,
    payload: MergeLogPayload,
    remap: { topic: Map<string, string>; subTopic: Map<string, string> },
    loserTopicId: string | null,
    loserSubIds: string[],
  ): Promise<number> {
    const or: Prisma.UserWeakTopicWhereInput[] = [];
    if (loserTopicId) or.push({ topicId: loserTopicId });
    if (loserSubIds.length) or.push({ subTopicId: { in: loserSubIds } });
    if (!or.length) return 0;
    const movingRaw = await tx.userWeakTopic.findMany({ where: { OR: or } });
    if (!movingRaw.length) return 0;
    const moving = movingRaw.map(toLite);
    const newKeys = new Set<string>();
    for (const r of moving) {
      const topicId = r.topicId ? remap.topic.get(r.topicId) ?? r.topicId : null;
      const subTopicId = r.subTopicId ? remap.subTopic.get(r.subTopicId) ?? r.subTopicId : null;
      newKeys.add(weakScopeKey({ chapterId: r.chapterId, topicId, subTopicId }));
    }
    const existingRaw = await tx.userWeakTopic.findMany({
      where: { userId: { in: [...new Set(moving.map((m) => m.userId))] }, scopeKey: { in: [...newKeys] } },
    });
    const plan = planWeakTopicMerge(moving, existingRaw.map(toLite), remap);
    const rawById = new Map<string, any>([...movingRaw, ...existingRaw].map((r) => [r.id, r]));

    for (const r of plan.rekey) {
      const before = rawById.get(r.id);
      payload.weakRekeyBefore.push({ id: r.id, topicId: before.topicId ?? null, subTopicId: before.subTopicId ?? null, scopeKey: before.scopeKey });
      await tx.userWeakTopic.update({ where: { id: r.id }, data: { topicId: r.topicId, subTopicId: r.subTopicId, scopeKey: r.scopeKey } });
    }
    const ownerSeen = new Set<string>();
    for (const f of plan.fold) {
      const owner = rawById.get(f.intoId);
      if (!ownerSeen.has(f.intoId)) {
        payload.weakFoldBefore.push({ ownerBefore: toJson(owner), deleted: toJson(rawById.get(f.fromId)) });
        ownerSeen.add(f.intoId);
      } else {
        // owner already snapshotted by an earlier fold; this fold's loser row still needs a "deleted" copy for undo
        payload.weakFoldBefore.push({ ownerBefore: payload.weakFoldBefore.find((x) => x.ownerBefore.id === f.intoId)!.ownerBefore, deleted: toJson(rawById.get(f.fromId)) });
      }
      await tx.userWeakTopic.update({ where: { id: f.intoId }, data: f.data });
      await tx.userWeakTopic.delete({ where: { id: f.fromId } });
    }
    return movingRaw.length;
  }

  private async writeLog(
    kind: 'TOPIC' | 'SUBTOPIC',
    chapterId: string,
    survivor: { id: string; name: string },
    loser: { id: string; name: string },
    questionsMoved: number,
    payload: MergeLogPayload,
    actorId?: string,
  ) {
    return this.prisma.taxonomyMergeLog.create({
      data: {
        kind,
        chapterId,
        survivorId: survivor.id,
        loserId: loser.id,
        survivorName: survivor.name,
        loserName: loser.name,
        questionsMoved,
        payload: payload as unknown as Prisma.InputJsonValue,
        actorId: actorId ?? null,
      },
      select: { id: true },
    });
  }

  /** caches + Meilisearch (topic names are indexed on every question document). Never fails the merge. */
  private afterMerge(questionIds: Set<string>): void {
    this.clearCaches();
    const search = this.search;
    if (!search || questionIds.size === 0) return;
    const ids = [...questionIds];
    void (async () => {
      try {
        if (ids.length > 300) {
          await search.indexAllApproved();
        } else {
          for (const id of ids) await search.indexQuestion(id);
        }
      } catch (e) {
        this.logger.warn(`Meilisearch reindex after taxonomy merge failed: ${(e as Error)?.message}`);
      }
    })();
  }
}
