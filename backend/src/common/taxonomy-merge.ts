/**
 * Pure planning helpers for "each topic / sub-topic exists ONCE per chapter".
 * No DB, no Nest — the service feeds rows in and applies the plan inside a transaction.
 */
import { keySimilarity, SIMILAR_THRESHOLD, sameTaxonomy, taxonomyKeys } from './taxonomy-key';

export interface TaxRow {
  id: string;
  /** chapterId for topics, topicId for sub-topics, subjectId for chapters */
  parentId: string;
  name: string;
  nameHindi?: string | null;
  slug: string;
  questionCount: number;
}

export type DupKind = 'CHAPTER' | 'TOPIC' | 'SUBTOPIC';
export type DupReason = 'same-name' | 'same-hindi' | 'similar';

export interface DupGroup {
  kind: DupKind;
  /** the chapter (topic/sub-topic groups) or subject (chapter groups) the rows live under */
  scopeId: string;
  reason: DupReason;
  rows: TaxRow[];
  survivorId: string;
  loserIds: string[];
  /** Hindi name the survivor should end up with (its own, else the first loser's) */
  mergedNameHindi: string | null;
  totalQuestions: number;
}

/** "Best" row: most questions → has Hindi → properly cased name → shorter slug → smallest id (deterministic). */
export function pickSurvivor(rows: readonly TaxRow[]): TaxRow {
  const caseScore = (n: string) => (n === n.toUpperCase() || n === n.toLowerCase() ? 0 : 1);
  return [...rows].sort((a, b) => {
    if (b.questionCount !== a.questionCount) return b.questionCount - a.questionCount;
    const ha = a.nameHindi ? 1 : 0;
    const hb = b.nameHindi ? 1 : 0;
    if (hb !== ha) return hb - ha;
    const ca = caseScore(a.name.trim());
    const cb = caseScore(b.name.trim());
    if (cb !== ca) return cb - ca;
    if (a.slug.length !== b.slug.length) return a.slug.length - b.slug.length;
    return a.id < b.id ? -1 : 1;
  })[0];
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

function buildGroup(kind: DupKind, scopeId: string, reason: DupReason, rows: TaxRow[]): DupGroup {
  const survivor = pickSurvivor(rows);
  const losers = rows.filter((r) => r.id !== survivor.id);
  const mergedNameHindi = survivor.nameHindi || losers.find((l) => l.nameHindi)?.nameHindi || null;
  return {
    kind,
    scopeId,
    reason,
    rows: [survivor, ...losers],
    survivorId: survivor.id,
    loserIds: losers.map((l) => l.id),
    mergedNameHindi: mergedNameHindi ?? null,
    totalQuestions: rows.reduce((n, r) => n + r.questionCount, 0),
  };
}

/**
 * Groups rows that live in the SAME scope (one chapter for topics/sub-topics, one subject for chapters).
 * - exact groups (same English key, or same Hindi key) are the ones the admin can merge in one click;
 * - `similar` groups (fuzzy, different keys) are listed separately for a human decision.
 */
export function planDuplicateGroups(kind: DupKind, rowsByScope: Map<string, TaxRow[]>): DupGroup[] {
  const out: DupGroup[] = [];
  for (const [scopeId, rows] of rowsByScope) {
    if (rows.length < 2) continue;
    const keys = rows.map((r) => taxonomyKeys(r.name, r.nameHindi));
    const uf = new UnionFind(rows.length);
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const enSame = keys[i].en && keys[j].en && keys[i].en === keys[j].en;
        const hiSame = keys[i].hi && keys[j].hi && keys[i].hi === keys[j].hi;
        if (enSame || hiSame) uf.union(i, j);
      }
    }
    const buckets = new Map<number, number[]>();
    rows.forEach((_, i) => {
      const r = uf.find(i);
      buckets.set(r, [...(buckets.get(r) ?? []), i]);
    });
    const exactReps: number[] = [];
    for (const idxs of buckets.values()) {
      exactReps.push(idxs[0]);
      if (idxs.length < 2) continue;
      const ens = idxs.map((i) => keys[i].en);
      const allSameEnglish = !!ens[0] && ens.every((e) => e === ens[0]);
      out.push(buildGroup(kind, scopeId, allSameEnglish ? 'same-name' : 'same-hindi', idxs.map((i) => rows[i])));
    }
    // fuzzy pairs between different exact buckets → report-only "similar" groups (pairs)
    for (let a = 0; a < exactReps.length; a++) {
      for (let b = a + 1; b < exactReps.length; b++) {
        const ka = keys[exactReps[a]].en;
        const kb = keys[exactReps[b]].en;
        if (ka.length < 5 || kb.length < 5) continue;
        if (keySimilarity(ka, kb) >= SIMILAR_THRESHOLD) {
          const ga = (buckets.get(uf.find(exactReps[a])) ?? []).map((i) => rows[i]);
          const gb = (buckets.get(uf.find(exactReps[b])) ?? []).map((i) => rows[i]);
          out.push(buildGroup(kind, scopeId, 'similar', [...ga, ...gb]));
        }
      }
    }
  }
  return out.sort((x, y) => y.totalQuestions - x.totalQuestions);
}

// ---------------------------------------------------------------------------
// UserWeakTopic scope key (must stay identical to weak-topic.service.ts keyOf)
// ---------------------------------------------------------------------------
export const weakScopeKey = (s: { chapterId?: string | null; topicId?: string | null; subTopicId?: string | null }): string =>
  `${s.chapterId ?? ''}|${s.topicId ?? ''}|${s.subTopicId ?? ''}`;

export interface WeakRowLite {
  id: string;
  userId: string;
  chapterId: string | null;
  topicId: string | null;
  subTopicId: string | null;
  scopeKey: string;
  status: string;
  wrongCount: number;
  attemptedCount: number;
  practiceSetsDone: number;
  practiceCorrect: number;
  practiceTotal: number;
  firstDetectedAt: Date;
  lastDetectedAt: Date;
}

export interface WeakMergePlan {
  /** rows whose scope simply moves (no clash): new ids + new scopeKey */
  rekey: { id: string; topicId: string | null; subTopicId: string | null; scopeKey: string }[];
  /** clash: add `from` into `into`, then delete `from` */
  fold: { fromId: string; intoId: string; data: Pick<WeakRowLite, 'status' | 'wrongCount' | 'attemptedCount' | 'practiceSetsDone' | 'practiceCorrect' | 'practiceTotal' | 'firstDetectedAt' | 'lastDetectedAt'> }[];
}

/**
 * `moving` = UserWeakTopic rows that point at the loser topic/sub-topic; `existing` = every other row of the same users
 * (looked up by scopeKey). `remap` says what each old topicId / subTopicId becomes.
 */
export function planWeakTopicMerge(
  moving: readonly WeakRowLite[],
  existing: readonly WeakRowLite[],
  remap: { topic: ReadonlyMap<string, string>; subTopic: ReadonlyMap<string, string> },
): WeakMergePlan {
  const byKey = new Map<string, WeakRowLite>();
  const byId = new Map<string, WeakRowLite>();
  for (const r of existing) {
    byKey.set(`${r.userId}::${r.scopeKey}`, r);
    byId.set(r.id, r);
  }
  for (const r of moving) byId.set(r.id, r);
  const plan: WeakMergePlan = { rekey: [], fold: [] };
  const taken = new Map<string, string>(); // userId::newKey → id that will own it
  const acc = new Map<string, WeakRowLite>(); // running totals of rows that receive several folds
  for (const r of moving) {
    const topicId = r.topicId ? remap.topic.get(r.topicId) ?? r.topicId : null;
    const subTopicId = r.subTopicId ? remap.subTopic.get(r.subTopicId) ?? r.subTopicId : null;
    const scopeKey = weakScopeKey({ chapterId: r.chapterId, topicId, subTopicId });
    if (scopeKey === r.scopeKey) continue;
    const k = `${r.userId}::${scopeKey}`;
    const ownerId = taken.get(k) ?? byKey.get(k)?.id;
    const base = ownerId ? acc.get(ownerId) ?? byId.get(ownerId) : undefined;
    if (ownerId && base && ownerId !== r.id) {
      const data = {
        status: r.status === 'WEAK' || base.status === 'WEAK' ? 'WEAK' : base.status,
        wrongCount: base.wrongCount + r.wrongCount,
        attemptedCount: base.attemptedCount + r.attemptedCount,
        practiceSetsDone: base.practiceSetsDone + r.practiceSetsDone,
        practiceCorrect: base.practiceCorrect + r.practiceCorrect,
        practiceTotal: base.practiceTotal + r.practiceTotal,
        firstDetectedAt: r.firstDetectedAt < base.firstDetectedAt ? r.firstDetectedAt : base.firstDetectedAt,
        lastDetectedAt: r.lastDetectedAt > base.lastDetectedAt ? r.lastDetectedAt : base.lastDetectedAt,
      };
      plan.fold.push({ fromId: r.id, intoId: ownerId, data });
      acc.set(ownerId, { ...base, ...data });
    } else {
      plan.rekey.push({ id: r.id, topicId, subTopicId, scopeKey });
      taken.set(k, r.id);
    }
  }
  return plan;
}

/** Slug that does not clash with `taken` (adds -2, -3 …). */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export { sameTaxonomy };
