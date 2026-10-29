import { PRACTICE_TARGET, PreviewRow, TaxonomyLists, buildPracticePlan, countKinds, previewKind, rowsWithoutHindi } from './upload-preview';

const LISTS: TaxonomyLists = {
  subjects: [
    { id: 's-q', slug: 'sub-quantitative_aptitude', name: 'Quantitative Aptitude' },
    { id: 's-e', slug: 'sub-english', name: 'English' },
  ],
  chapters: [
    { id: 'c-pct', slug: 'chap-percentage-quantitative_aptitude', name: 'Percentage', subjectId: 's-q' },
    { id: 'c-syn', slug: 'chap-synonyms-english', name: 'Synonyms', subjectId: 's-e' },
  ],
  topics: [{ id: 't-elec', slug: 'election-problems', name: 'Election Problems', chapterId: 'c-pct' }],
  subTopics: [{ id: 'st-turn', slug: 'turnout', name: 'Turnout', topicId: 't-elec' }],
};

const row = (n: number, over: Partial<PreviewRow> = {}): PreviewRow => ({
  row: n, subject: 'sub-quantitative_aptitude', chapter: 'chap-percentage-quantitative_aptitude', topic: '', subTopic: '', yearRaw: '', examDate: undefined, hasHindi: true, ...over,
});

describe('upload preview (mixed PYQ + practice file)', () => {
  it('year or exam date = PYQ, neither = practice; "practice only" forces practice', () => {
    expect(previewKind({ yearRaw: '2024', examDate: undefined }, false)).toBe('PYQ');
    expect(previewKind({ yearRaw: '', examDate: '2024-06-20' }, false)).toBe('PYQ');
    expect(previewKind({ yearRaw: '', examDate: undefined }, false)).toBe('PRACTICE');
    expect(previewKind({ yearRaw: '2024', examDate: '2024-06-20' }, true)).toBe('PRACTICE');
    expect(previewKind({ yearRaw: 'abc', examDate: undefined }, false)).toBe('PYQ'); // fails loudly later
  });

  it('counts the two kinds', () => {
    const rows = [row(2, { yearRaw: '2024' }), row(3, { examDate: '2024-01-01' }), row(4), row(5), row(6)];
    expect(countKinds(rows, false)).toEqual({ pyq: 2, practice: 3 });
    expect(countKinds(rows, true)).toEqual({ pyq: 0, practice: 5 });
  });

  it('lists the rows that would be saved without Hindi, but not English-subject rows', () => {
    const rows = [row(2, { hasHindi: false }), row(3, { hasHindi: true }), row(4, { hasHindi: false, subject: 'sub-english', chapter: 'chap-synonyms-english' }), row(5, { hasHindi: false, subject: 'Quantitative Aptitude' })];
    expect(rowsWithoutHindi(rows, LISTS.subjects)).toEqual([2, 5]);
  });

  it('practice plan groups by chapter / topic / sub-topic and counts what is already there', () => {
    const rows = [
      row(2, { topic: 'Election Problems', subTopic: 'Turnout' }),
      row(3, { topic: 'Election Problems', subTopic: 'Turnout' }),
      row(4, { topic: 'Election Problems', subTopic: 'Winning margin' }), // new sub-topic
      row(5, { topic: 'Weighted Percentage' }), // new topic
      row(6, { subject: 'sub-english', chapter: 'Synonyms' }), // chapter only, found by name
    ];
    const existing = new Map<string, number>([['s:st-turn', 95], ['t:t-elec', 120], ['c:c-syn', 7]]);
    const { plan, truncated } = buildPracticePlan(rows, LISTS, existing);
    expect(truncated).toBe(false);
    const find = (topic: string, sub: string) => plan.find((p) => p.topic === topic && p.subTopic === sub)!;

    const turnout = find('Election Problems', 'Turnout');
    expect(turnout).toMatchObject({ subjectId: 's-q', chapterId: 'c-pct', topicId: 't-elec', subTopicId: 'st-turn' });
    expect(turnout).toMatchObject({ count: 2, existing: 95, after: 97, missing: 3, subTopicNew: false, topicNew: false, target: PRACTICE_TARGET });

    const margin = find('Election Problems', 'Winning margin');
    expect(margin).toMatchObject({ count: 1, existing: 0, after: 1, missing: 99, subTopicNew: true });

    const weighted = find('Weighted Percentage', '');
    expect(weighted).toMatchObject({ count: 1, existing: 0, topicNew: true });

    const syn = plan.find((p) => p.chapter === 'Synonyms')!;
    expect(syn).toMatchObject({ count: 1, existing: 7, chapterId: 'c-syn' });
  });

  it('a file that overshoots the target never reports a negative "missing"', () => {
    const rows = Array.from({ length: 120 }, (_, i) => row(i + 2, { topic: 'Election Problems', subTopic: 'Turnout' }));
    const { plan } = buildPracticePlan(rows, LISTS, new Map());
    expect(plan[0].count).toBe(120);
    expect(plan[0].missing).toBe(0);
  });
});
