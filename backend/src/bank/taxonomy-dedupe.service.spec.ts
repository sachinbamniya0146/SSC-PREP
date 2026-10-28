/* eslint-disable @typescript-eslint/no-explicit-any */
import { TaxonomyDedupeService } from './taxonomy-dedupe.service';

// ---- tiny in-memory Prisma fake: only what TaxonomyDedupeService calls -------------------------------------------
type Row = Record<string, any>;
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as any[]).includes(row[k]);
      if ('gt' in cond) return row[k] > cond.gt;
      return true;
    }
    return (row[k] ?? null) === (cond ?? null);
  });
}
function table(name: string, rows: Row[], db: Record<string, Row[]>) {
  return {
    findMany: async (a: any = {}) =>
      rows.filter((r) => matches(r, a.where)).map((r) => {
        const out: Row = { ...r };
        if (a.select?._count || a.include?._count) {
          out._count = {
            questions: db.question.filter((q) => (name === 'topic' ? q.topicId === r.id : name === 'subTopic' ? q.subTopicId === r.id : q.chapterId === r.id)).length,
          };
        }
        if (name === 'subTopic' && (a.select?.topic || a.include?.topic)) out.topic = { chapterId: db.topic.find((t) => t.id === r.topicId)?.chapterId };
        return out;
      }),
    findUnique: async (a: any) => {
      const r = rows.find((x) => matches(x, a.where));
      if (!r) return null;
      const out: Row = { ...r };
      if (name === 'subTopic' && a.include?.topic) out.topic = { chapterId: db.topic.find((t) => t.id === r.topicId)?.chapterId };
      return out;
    },
    count: async (a: any = {}) => rows.filter((r) => matches(r, a.where)).length,
    create: async (a: any) => {
      const r = { id: a.data.id ?? `${name}-${rows.length + 1}-${Math.random().toString(36).slice(2, 6)}`, ...(name === 'taxonomyMergeLog' ? { createdAt: new Date() } : {}), ...a.data };
      if (name === 'userWeakTopic' && rows.some((x) => x.userId === r.userId && x.scopeKey === r.scopeKey)) throw new Error('unique violation userId_scopeKey');
      rows.push(r);
      return { ...r };
    },
    update: async (a: any) => {
      const r = rows.find((x) => matches(x, a.where));
      if (!r) throw new Error(`${name}.update: not found`);
      const next = { ...r, ...a.data };
      if (name === 'userWeakTopic' && rows.some((x) => x !== r && x.userId === next.userId && x.scopeKey === next.scopeKey)) throw new Error('unique violation userId_scopeKey');
      if (name === 'subTopic' && rows.some((x) => x !== r && x.topicId === next.topicId && x.slug === next.slug)) throw new Error('unique violation topicId_slug');
      Object.assign(r, a.data);
      return { ...r };
    },
    updateMany: async (a: any) => {
      const hit = rows.filter((r) => matches(r, a.where));
      hit.forEach((r) => Object.assign(r, a.data));
      return { count: hit.length };
    },
    delete: async (a: any) => {
      const i = rows.findIndex((x) => matches(x, a.where));
      if (i < 0) throw new Error(`${name}.delete: not found`);
      rows.splice(i, 1);
      return {};
    },
  };
}
function fakePrisma(db: Record<string, Row[]>) {
  const p: any = {};
  for (const name of Object.keys(db)) p[name] = table(name, db[name], db);
  p.$transaction = async (fn: any) => fn(p);
  return p;
}

const now = new Date('2026-03-01');
const weak = (id: string, userId: string, topicId: string | null, subTopicId: string | null, n = 1): Row => ({
  id, userId, subjectId: 's1', chapterId: 'ch1', topicId, subTopicId, scopeKey: `ch1|${topicId ?? ''}|${subTopicId ?? ''}`,
  status: 'WEAK', wrongCount: n, attemptedCount: n * 2, practiceSetsDone: 0, practiceCorrect: 0, practiceTotal: 0,
  lastPracticeScore: null, lastSourceAttemptId: null, firstDetectedAt: now, lastDetectedAt: now, strengthenedAt: null,
});

function seed() {
  const db: Record<string, Row[]> = {
    chapter: [{ id: 'ch1', subjectId: 's1', name: 'Percentage', nameHindi: null, slug: 'percentage' }],
    topic: [
      { id: 'tA', chapterId: 'ch1', name: 'Basics', nameHindi: null, slug: 'basics' },
      { id: 'tB', chapterId: 'ch1', name: 'Basic', nameHindi: 'मूल बातें', slug: 'basic' },
      { id: 'tC', chapterId: 'ch1', name: 'Applications', nameHindi: null, slug: 'applications' },
    ],
    subTopic: [
      { id: 'sA1', topicId: 'tA', name: 'Fractions', nameHindi: null, slug: 'fractions' },
      { id: 'sB1', topicId: 'tB', name: 'Fraction', nameHindi: 'भिन्न', slug: 'fraction' },
      { id: 'sB2', topicId: 'tB', name: 'Decimals', nameHindi: null, slug: 'decimals' },
      { id: 'sC1', topicId: 'tC', name: 'Fractions', nameHindi: null, slug: 'fractions' },
    ],
    question: [
      { id: 'q1', topicId: 'tA', subTopicId: 'sA1', chapterId: 'ch1' },
      { id: 'q2', topicId: 'tB', subTopicId: 'sB1', chapterId: 'ch1' },
      { id: 'q3', topicId: 'tB', subTopicId: 'sB2', chapterId: 'ch1' },
      { id: 'q4', topicId: 'tB', subTopicId: null, chapterId: 'ch1' },
      { id: 'q5', topicId: 'tC', subTopicId: 'sC1', chapterId: 'ch1' },
    ],
    questionBankSet: [
      { id: 'b1', topicId: 'tB', subTopicId: 'sB1' },
      { id: 'b2', topicId: 'tC', subTopicId: 'sC1' },
    ],
    weakTopicReport: [{ id: 'r1', userId: 'u1', chapterId: 'ch1', topicId: 'tB' }],
    userWeakTopic: [
      weak('w1', 'u1', 'tA', null, 2), // survivor-side row of user 1
      weak('w2', 'u1', 'tB', null, 3), // loser-side row of the same user → must fold
      weak('w3', 'u2', 'tB', 'sB1', 1), // other user, only loser-side → re-key
    ],
    taxonomyMergeLog: [],
  };
  return db;
}

describe('TaxonomyDedupeService (fake prisma)', () => {
  it('audit finds topic dup (Basics/Basic) and sub-topic dup across sibling topics (Fractions in tA & tC, Fraction in tB)', async () => {
    const db = seed();
    const svc = new TaxonomyDedupeService(fakePrisma(db) as any);
    const a = await svc.audit();
    expect(a.topics).toHaveLength(1);
    expect(a.topics[0].loserIds.length).toBe(1);
    expect(a.subTopics).toHaveLength(1);
    expect(a.subTopics[0].rows).toHaveLength(3);
  });

  it('mergeTopics moves questions, sub-topics, bank sets, weak rows; deletes loser; undo restores everything', async () => {
    const db = seed();
    const before = JSON.parse(JSON.stringify(db));
    const svc = new TaxonomyDedupeService(fakePrisma(db) as any);

    const res = await svc.mergeTopics('tA', 'tB', 'admin1');
    expect(res.questionsMoved).toBeGreaterThan(0);
    expect(db.topic.find((t) => t.id === 'tB')).toBeUndefined();
    expect(db.topic.find((t) => t.id === 'tA')?.nameHindi).toBe('मूल बातें');
    // sB1 ("Fraction") is a twin of sA1 ("Fractions") → merged away; sB2 moved under tA
    expect(db.subTopic.find((s) => s.id === 'sB1')).toBeUndefined();
    expect(db.subTopic.find((s) => s.id === 'sB2')?.topicId).toBe('tA');
    expect(db.subTopic.find((s) => s.id === 'sA1')?.nameHindi).toBe('भिन्न');
    expect(db.question.map((q) => [q.id, q.topicId, q.subTopicId])).toEqual([
      ['q1', 'tA', 'sA1'], ['q2', 'tA', 'sA1'], ['q3', 'tA', 'sB2'], ['q4', 'tA', null], ['q5', 'tC', 'sC1'],
    ]);
    expect(db.questionBankSet[0]).toMatchObject({ topicId: 'tA', subTopicId: 'sA1' });
    expect(db.weakTopicReport[0].topicId).toBe('tA');
    // user1: tA row + tB row folded (2+3 wrong), user2 row re-keyed to tA|sA1
    const u1 = db.userWeakTopic.filter((w) => w.userId === 'u1');
    expect(u1).toHaveLength(1);
    expect(u1[0].wrongCount).toBe(5);
    const u2 = db.userWeakTopic.find((w) => w.userId === 'u2')!;
    expect(u2.scopeKey).toBe('ch1|tA|sA1');
    expect(db.taxonomyMergeLog).toHaveLength(1);

    await svc.undo(res.logId);
    const strip = (rows: Row[]) => rows.map((r) => ({ ...r })).sort((x, y) => (x.id < y.id ? -1 : 1));
    expect(strip(db.topic)).toEqual(strip(before.topic));
    expect(strip(db.subTopic)).toEqual(strip(before.subTopic));
    expect(strip(db.question)).toEqual(strip(before.question));
    expect(strip(db.questionBankSet)).toEqual(strip(before.questionBankSet));
    expect(strip(db.weakTopicReport)).toEqual(strip(before.weakTopicReport));
    expect(strip(db.userWeakTopic).map((w) => JSON.parse(JSON.stringify(w)))).toEqual(strip(before.userWeakTopic).map((w) => JSON.parse(JSON.stringify(w))));
    expect(db.taxonomyMergeLog[0].undoneAt).toBeTruthy();
  });

  it('mergeSubTopics across sibling topics rewrites Question.topicId too, and undo puts it back', async () => {
    const db = seed();
    const before = JSON.parse(JSON.stringify(db));
    const svc = new TaxonomyDedupeService(fakePrisma(db) as any);
    const res = await svc.mergeSubTopics('sA1', 'sC1');
    expect(db.subTopic.find((s) => s.id === 'sC1')).toBeUndefined();
    expect(db.question.find((q) => q.id === 'q5')).toMatchObject({ topicId: 'tA', subTopicId: 'sA1' });
    expect(db.questionBankSet.find((b) => b.id === 'b2')).toMatchObject({ topicId: 'tA', subTopicId: 'sA1' });
    await svc.undo(res.logId);
    expect(db.question.find((q) => q.id === 'q5')).toMatchObject({ topicId: 'tC', subTopicId: 'sC1' });
    expect(db.questionBankSet.find((b) => b.id === 'b2')).toMatchObject({ topicId: 'tC', subTopicId: 'sC1' });
    expect(db.subTopic.map((s) => s.id).sort()).toEqual(before.subTopic.map((s: Row) => s.id).sort());
  });

  it('refuses to merge across chapters and refuses a double undo', async () => {
    const db = seed();
    db.topic.push({ id: 'tX', chapterId: 'ch2', name: 'Basics', nameHindi: null, slug: 'basics' });
    const svc = new TaxonomyDedupeService(fakePrisma(db) as any);
    await expect(svc.mergeTopics('tA', 'tX')).rejects.toThrow('ek hi chapter');
    const r = await svc.mergeTopics('tA', 'tB');
    await svc.undo(r.logId);
    await expect(svc.undo(r.logId)).rejects.toThrow('undo ho chuka');
  });

  it('mergeAllExact dry-run changes nothing; real run leaves no exact duplicates', async () => {
    const db = seed();
    const svc = new TaxonomyDedupeService(fakePrisma(db) as any);
    const dry = await svc.mergeAllExact('a', true);
    expect(dry.groups).toBeGreaterThan(0);
    expect(db.topic).toHaveLength(3);
    await svc.mergeAllExact('a', false);
    const after = await svc.audit();
    expect(after.summary.exactGroups).toBe(0);
  });
});
