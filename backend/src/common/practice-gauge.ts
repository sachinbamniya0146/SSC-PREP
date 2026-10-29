/**
 * Practice coverage gauge (S39, 29 Oct 2026): for every sub-topic / topic / chapter that has nothing finer below it,
 * how many LIVE practice questions exist (target 100) and how many live PYQ. Lowest coverage first, so the admin
 * knows what to upload next. Pure function: the service loads the taxonomy and the group-by counts.
 *
 * A node is a "leaf" when nothing finer exists under it:
 *   sub-topic                       -> always a leaf
 *   topic WITHOUT sub-topics        -> a leaf (counts = every question of the topic)
 *   chapter WITHOUT topics          -> a leaf (counts = every question of the chapter)
 * A topic that has sub-topics is not listed itself; its own questions that sit in no sub-topic are listed as one extra row
 * "(no sub-topic)" when there are any, so nothing is hidden.
 */
export const GAUGE_TARGET = 100;

export interface GaugeSubject { id: string; name: string }
export interface GaugeChapter { id: string; name: string; subjectId: string }
export interface GaugeTopic { id: string; name: string; chapterId: string }
export interface GaugeSubTopic { id: string; name: string; topicId: string }

export interface GaugeCounts {
  /** live practice / live PYQ, keyed by id */
  chapter: Map<string, { practice: number; pyq: number }>;
  topic: Map<string, { practice: number; pyq: number }>;
  subTopic: Map<string, { practice: number; pyq: number }>;
  /** questions of a topic that have a topic but no sub-topic */
  topicDirect: Map<string, { practice: number; pyq: number }>;
}

export interface GaugeRow {
  level: 'chapter' | 'topic' | 'subTopic';
  subjectId: string;
  subject: string;
  chapterId: string;
  chapter: string;
  topicId?: string;
  topic?: string;
  subTopicId?: string;
  subTopic?: string;
  practice: number;
  pyq: number;
  target: number;
  missing: number;
  pct: number;
}

const zero = { practice: 0, pyq: 0 };

export function buildPracticeGauge(
  tax: { subjects: GaugeSubject[]; chapters: GaugeChapter[]; topics: GaugeTopic[]; subTopics: GaugeSubTopic[] },
  counts: GaugeCounts,
  target = GAUGE_TARGET,
): GaugeRow[] {
  const subjectOf = new Map(tax.subjects.map((s) => [s.id, s]));
  const rows: GaugeRow[] = [];
  const mk = (level: GaugeRow['level'], ch: GaugeChapter, c: { practice: number; pyq: number }, extra: Partial<GaugeRow>): GaugeRow => ({
    level,
    subjectId: ch.subjectId,
    subject: subjectOf.get(ch.subjectId)?.name ?? '',
    chapterId: ch.id,
    chapter: ch.name,
    practice: c.practice,
    pyq: c.pyq,
    target,
    missing: Math.max(target - c.practice, 0),
    pct: Math.min(Math.round((c.practice / target) * 100), 100),
    ...extra,
  });
  const topicsOf = new Map<string, GaugeTopic[]>();
  for (const t of tax.topics) topicsOf.set(t.chapterId, [...(topicsOf.get(t.chapterId) ?? []), t]);
  const subsOf = new Map<string, GaugeSubTopic[]>();
  for (const s of tax.subTopics) subsOf.set(s.topicId, [...(subsOf.get(s.topicId) ?? []), s]);

  for (const ch of tax.chapters) {
    const topics = topicsOf.get(ch.id) ?? [];
    if (topics.length === 0) {
      rows.push(mk('chapter', ch, counts.chapter.get(ch.id) ?? zero, {}));
      continue;
    }
    for (const t of topics) {
      const subs = subsOf.get(t.id) ?? [];
      if (subs.length === 0) {
        rows.push(mk('topic', ch, counts.topic.get(t.id) ?? zero, { topicId: t.id, topic: t.name }));
        continue;
      }
      for (const s of subs) rows.push(mk('subTopic', ch, counts.subTopic.get(s.id) ?? zero, { topicId: t.id, topic: t.name, subTopicId: s.id, subTopic: s.name }));
      const direct = counts.topicDirect.get(t.id);
      if (direct && (direct.practice > 0 || direct.pyq > 0)) {
        rows.push(mk('topic', ch, direct, { topicId: t.id, topic: t.name, subTopic: '(no sub-topic)' }));
      }
    }
  }
  return rows.sort((a, b) => b.missing - a.missing || a.subject.localeCompare(b.subject) || a.chapter.localeCompare(b.chapter) || (a.topic ?? '').localeCompare(b.topic ?? '') || (a.subTopic ?? '').localeCompare(b.subTopic ?? ''));
}
