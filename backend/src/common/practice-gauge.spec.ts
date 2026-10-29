import { GAUGE_TARGET, GaugeCounts, buildPracticeGauge } from './practice-gauge';

const tax = {
  subjects: [{ id: 's1', name: 'Quant' }],
  chapters: [
    { id: 'c1', name: 'Percentage', subjectId: 's1' },
    { id: 'c2', name: 'Average', subjectId: 's1' },
    { id: 'c3', name: 'Ratio', subjectId: 's1' },
  ],
  topics: [
    { id: 't1', name: 'Election', chapterId: 'c1' },
    { id: 't2', name: 'Weighted', chapterId: 'c1' },
    { id: 't3', name: 'Mean', chapterId: 'c3' },
  ],
  subTopics: [
    { id: 'st1', name: 'Turnout', topicId: 't1' },
    { id: 'st2', name: 'Margin', topicId: 't1' },
  ],
};
const m = (o: Record<string, [number, number]>) => new Map(Object.entries(o).map(([k, v]) => [k, { practice: v[0], pyq: v[1] }]));
const counts: GaugeCounts = {
  chapter: m({ c2: [40, 3] }),
  topic: m({ t2: [100, 5], t3: [10, 0], t1: [190, 9] }),
  subTopic: m({ st1: [95, 2], st2: [0, 0] }),
  topicDirect: m({ t1: [12, 1] }),
};

describe('practice gauge', () => {
  const rows = buildPracticeGauge(tax, counts);
  const find = (p: (r: (typeof rows)[number]) => boolean) => rows.find(p)!;

  it('lists only leaf nodes: sub-topics, topics without sub-topics, chapters without topics', () => {
    expect(rows.map((r) => r.level + ':' + (r.subTopic ?? r.topic ?? r.chapter)).sort()).toEqual(
      ['chapter:Average', 'subTopic:Margin', 'subTopic:Turnout', 'topic:(no sub-topic)', 'topic:Mean', 'topic:Weighted'].sort(),
    );
  });

  it('counts, target, missing and percent', () => {
    expect(find((r) => r.subTopic === 'Turnout')).toMatchObject({ practice: 95, pyq: 2, target: GAUGE_TARGET, missing: 5, pct: 95 });
    expect(find((r) => r.topic === 'Weighted')).toMatchObject({ practice: 100, missing: 0, pct: 100 });
    expect(find((r) => r.subTopic === 'Margin')).toMatchObject({ practice: 0, missing: 100, pct: 0 });
  });

  it('a topic with sub-topics shows its own un-aligned questions as one extra row', () => {
    expect(find((r) => r.subTopic === '(no sub-topic)')).toMatchObject({ topic: 'Election', practice: 12, pyq: 1 });
  });

  it('lowest coverage first, finished nodes last; over 100 never goes above 100 %', () => {
    expect(rows[0].missing).toBe(100);
    expect(rows[rows.length - 1].missing).toBe(0);
    const over = buildPracticeGauge(tax, { ...counts, topic: m({ t2: [250, 0] }) });
    expect(over.find((r) => r.topic === 'Weighted')).toMatchObject({ pct: 100, missing: 0 });
  });
});
