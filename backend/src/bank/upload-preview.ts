/**
 * Mixed-file preview for the "Check only" run (S37, 29 Oct 2026).
 *
 * One Excel can hold PYQ rows AND practice rows. Before anything is saved the admin sees:
 *   - how many rows are PYQ and how many are practice,
 *   - for every practice group: chapter > topic > sub-topic, how many practice questions the file adds, how many
 *     the site already has there, and how far that is from the target of 100 per sub-topic,
 *   - which rows have no Hindi question (the student would not see them; English subject is exempt).
 * The paper list (exam . tier . date . shift) is built by common/pyq-paper-preview.ts; dates are for the admin only.
 *
 * Pure functions (no Nest / Prisma): the job service loads the lists from the database and calls these.
 */
import { normalizeTaxonomyKey } from '../common/taxonomy-key';
import { isHindiExemptSubjectSlug } from '../common/question-visibility';
import { rowKind, RowKind } from '../common/row-kind';

/** Practice questions wanted per sub-topic (Sachin: "har topic/subtopic ke 100 question"). */
export const PRACTICE_TARGET = 100;
export const MAX_PLAN_ROWS = 400;

export interface PreviewRow {
  row: number;
  /** raw cell texts exactly as written in the file */
  subject: string;
  chapter: string;
  topic: string;
  subTopic: string;
  yearRaw: string;
  /** already normalised YYYY-MM-DD, or undefined */
  examDate?: string;
  hasHindi: boolean;
}

export interface NamedRef {
  id: string;
  slug: string;
  name: string;
}
export interface TaxonomyLists {
  subjects: NamedRef[];
  chapters: Array<NamedRef & { subjectId: string }>;
  topics: Array<NamedRef & { chapterId: string }>;
  subTopics: Array<NamedRef & { topicId: string }>;
}

/** "English\nहिंदी" -> "English". */
function firstLine(raw: string): string {
  return String(raw ?? '').split(/\r?\n/)[0].trim();
}

function matchRef<T extends NamedRef>(raw: string, list: readonly T[]): T | undefined {
  const v = firstLine(raw);
  if (!v) return undefined;
  const byId = list.find((x) => x.id === v);
  if (byId) return byId;
  const bySlug = list.find((x) => x.slug === v);
  if (bySlug) return bySlug;
  const key = normalizeTaxonomyKey(v);
  return key ? list.find((x) => normalizeTaxonomyKey(x.name) === key || normalizeTaxonomyKey(x.slug) === key) : undefined;
}

export function previewKind(r: Pick<PreviewRow, 'yearRaw' | 'examDate'>, practiceOnly: boolean): RowKind {
  if (practiceOnly) return 'PRACTICE';
  const y = r.yearRaw.trim();
  return rowKind({ year: y ? parseInt(y, 10) : undefined, examDate: r.examDate });
}

export interface KindCounts {
  pyq: number;
  practice: number;
}
export function countKinds(rows: readonly PreviewRow[], practiceOnly: boolean): KindCounts {
  const c: KindCounts = { pyq: 0, practice: 0 };
  for (const r of rows) {
    if (previewKind(r, practiceOnly) === 'PYQ') c.pyq++;
    else c.practice++;
  }
  return c;
}

/** Rows whose Hindi question is empty although the subject needs one: saved, but students will not see them. */
export function rowsWithoutHindi(rows: readonly PreviewRow[], subjects: readonly NamedRef[]): number[] {
  const out: number[] = [];
  for (const r of rows) {
    if (r.hasHindi) continue;
    const s = matchRef(r.subject, subjects);
    if (s && isHindiExemptSubjectSlug(s.slug)) continue;
    out.push(r.row);
  }
  return out;
}

export interface PracticePlanRow {
  chapter: string;
  chapterId?: string;
  /** ids for the "see what is already there" link (only when the name matched an existing record) */
  subjectId?: string;
  topicId?: string;
  subTopicId?: string;
  topic: string;
  topicNew: boolean;
  subTopic: string;
  subTopicNew: boolean;
  /** practice questions this file adds here */
  count: number;
  /** practice questions the site already has at the deepest level named */
  existing: number;
  /** existing + count */
  after: number;
  target: number;
  /** still missing to reach the target after this upload (0 = enough) */
  missing: number;
}

/**
 * existing: counts of LIVE practice questions in the database, keyed `c:<chapterId>`, `t:<topicId>`, `s:<subTopicId>`
 * (the job service groups them from the database).
 */
export function buildPracticePlan(rows: readonly PreviewRow[], lists: TaxonomyLists, existing: ReadonlyMap<string, number>): { plan: PracticePlanRow[]; truncated: boolean } {
  const groups = new Map<string, PracticePlanRow>();
  for (const r of rows) {
    const subject = matchRef(r.subject, lists.subjects);
    const chapters = subject ? lists.chapters.filter((c) => c.subjectId === subject.id) : lists.chapters;
    const chapter = matchRef(r.chapter, chapters) ?? matchRef(r.chapter, lists.chapters);
    const topicName = firstLine(r.topic);
    const subName = firstLine(r.subTopic);
    const topic = chapter && topicName ? matchRef(r.topic, lists.topics.filter((t) => t.chapterId === chapter.id)) : undefined;
    const sub = topic && subName ? matchRef(r.subTopic, lists.subTopics.filter((s) => s.topicId === topic.id)) : undefined;

    const chapterLabel = chapter?.name ?? (firstLine(r.chapter) || '(no chapter)');
    const topicLabel = topic?.name ?? topicName;
    const subLabel = sub?.name ?? subName;
    const key = [chapter?.id ?? `?${normalizeTaxonomyKey(chapterLabel)}`, topic?.id ?? `?${normalizeTaxonomyKey(topicLabel)}`, sub?.id ?? `?${normalizeTaxonomyKey(subLabel)}`].join('|');

    let g = groups.get(key);
    if (!g) {
      const topicNew = !!topicName && !topic && !!chapter;
      const subTopicNew = !!subName && !sub;
      // existing questions at the DEEPEST level the row names; a brand-new topic / sub-topic starts at 0
      let ex = 0;
      if (sub) ex = existing.get(`s:${sub.id}`) ?? 0;
      else if (!subName && topic) ex = existing.get(`t:${topic.id}`) ?? 0;
      else if (!topicName && chapter) ex = existing.get(`c:${chapter.id}`) ?? 0;
      g = {
        chapter: chapterLabel,
        chapterId: chapter?.id,
        subjectId: chapter?.subjectId,
        topicId: topic?.id,
        subTopicId: sub?.id,
        topic: topicLabel,
        topicNew,
        subTopic: subLabel,
        subTopicNew,
        count: 0,
        existing: ex,
        after: 0,
        target: PRACTICE_TARGET,
        missing: 0,
      };
      groups.set(key, g);
    }
    g.count++;
  }
  const all = [...groups.values()];
  for (const g of all) {
    g.after = g.existing + g.count;
    g.missing = Math.max(PRACTICE_TARGET - g.after, 0);
  }
  all.sort((a, b) => a.chapter.localeCompare(b.chapter) || a.topic.localeCompare(b.topic) || a.subTopic.localeCompare(b.subTopic));
  return { plan: all.slice(0, MAX_PLAN_ROWS), truncated: all.length > MAX_PLAN_ROWS };
}
