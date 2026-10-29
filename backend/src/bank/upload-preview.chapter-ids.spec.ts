import { TaxonomyLists, buildPracticePlan } from './upload-preview';

// S45: the production database stores chapter slugs like "percentage" / "static_gk", while the Master Package template writes
// "chap-percentage-quantitative_aptitude". Both, and the chapter name, must find the same chapter.
const LISTS: TaxonomyLists = {
  subjects: [{ id: 's-q', slug: 'quantitative_aptitude', name: 'Quantitative Aptitude' }, { id: 's-g', slug: 'general_awareness', name: 'General Awareness' }],
  chapters: [
    { id: 'c-pct', slug: 'percentage', name: 'Percentage', subjectId: 's-q' },
    { id: 'c-gk', slug: 'static_gk', name: 'Static GK', subjectId: 's-g' },
  ],
  topics: [],
  subTopics: [],
};
const row = (n: number, subject: string, chapter: string) => ({ row: n, subject, chapter, topic: '', subTopic: '', yearRaw: '', examDate: undefined, hasHindi: true });

describe('Master Package chapter ids find the database chapter (S45)', () => {
  it('chap-<name>-<subject>, the slug and the name all land on the same chapter', () => {
    const { plan } = buildPracticePlan(
      [
        row(2, 'sub-quantitative_aptitude', 'chap-percentage-quantitative_aptitude'),
        row(3, 'quantitative_aptitude', 'percentage'),
        row(4, 'Quantitative Aptitude', 'Percentage'),
        row(5, 'sub-general_awareness', 'chap-static_gk-general_awareness'),
      ],
      LISTS,
      new Map(),
    );
    const pct = plan.filter((p) => p.chapterId === 'c-pct');
    expect(pct.reduce((a, p) => a + p.count, 0)).toBe(3);
    expect(plan.find((p) => p.chapterId === 'c-gk')!.count).toBe(1);
  });
});
