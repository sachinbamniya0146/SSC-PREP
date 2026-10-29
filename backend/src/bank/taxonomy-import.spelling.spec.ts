import * as XLSX from 'xlsx';
import { TaxonomyImportService } from './taxonomy-import.service';

// S41: the syllabus import must attach chapters to the subject that already holds them (either spelling), reuse a chapter of
// the same name, follow the database spelling for new rows, and skip info sheets. Fake Prisma, real workbook.
function workbook(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
const HEADER = ['S.No.', 'Chapter No.', 'Chapter', 'Topic', 'Sub-Topic'];

function fakePrisma() {
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  const subjects = [
    { id: 's-plain', slug: 'reasoning', name: 'Reasoning', nameHindi: null as string | null },
    { id: 's-sub', slug: 'sub-reasoning', name: 'Reasoning', nameHindi: null as string | null },
  ];
  const chapters = [{ id: 'c-br', subjectId: 's-sub', slug: 'chap-blood_relations-reasoning', name: 'Blood Relations', nameHindi: null as string | null }];
  const topics: { id: string; chapterId: string; slug: string; name: string; nameHindi: string | null }[] = [];
  const subTopics: { id: string; topicId: string; slug: string; name: string; nameHindi: string | null }[] = [];
  const upsert = <T extends { id: string; slug: string }>(list: T[], match: (x: T) => boolean, create: Omit<T, 'id'>, update: Partial<T>, p: string): T => {
    const hit = list.find(match);
    if (hit) return Object.assign(hit, Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined)));
    const row = { id: id(p), ...create } as T;
    list.push(row);
    return row;
  };
  const prisma: any = {
    subject: {
      findMany: async () => subjects.map((s) => ({ ...s, _count: { chapters: chapters.filter((c) => c.subjectId === s.id).length } })),
      upsert: async ({ where, create, update }: any) => upsert(subjects, (s) => s.slug === where.slug, create, update, 's'),
    },
    chapter: {
      count: async ({ where }: any) => chapters.filter((c) => c.slug.startsWith(where.slug.startsWith)).length,
      findMany: async ({ where }: any) => chapters.filter((c) => c.subjectId === where.subjectId),
      upsert: async ({ where, create, update }: any) =>
        upsert(chapters, (c) => c.subjectId === where.subjectId_slug.subjectId && c.slug === where.subjectId_slug.slug, create, update, 'c'),
    },
    topic: {
      findMany: async ({ where }: any) => topics.filter((t) => t.chapterId === where.chapterId),
      upsert: async ({ where, create, update }: any) => upsert(topics, (t) => t.chapterId === where.chapterId_slug.chapterId && t.slug === where.chapterId_slug.slug, create, update, 't'),
    },
    subTopic: {
      findMany: async ({ where }: any) => subTopics.filter((t) => t.topicId === where.topicId),
      upsert: async ({ where, create, update }: any) => upsert(subTopics, (t) => t.topicId === where.topicId_slug.topicId && t.slug === where.topicId_slug.slug, create, update, 'st'),
    },
  };
  return { prisma, subjects, chapters, topics, subTopics };
}

describe('syllabus import: spelling-proof subjects and chapters (S41)', () => {
  it('uses the subject that holds the chapters, reuses a same-name chapter, new rows follow the database spelling', async () => {
    const db = fakePrisma();
    const svc = new TaxonomyImportService(db.prisma);
    const buf = workbook({
      Reasoning: [
        ['General Intelligence & Reasoning'],
        ['सामान्य बुद्धि एवं तर्कशक्ति'],
        [],
        HEADER,
        [1, 1, 'Blood Relations\nरक्त संबंध', 'Family Tree\nवंश वृक्ष', 'Coded Relations\nकूट संबंध'],
        [2, 2, 'Puzzles\nपहेलियाँ', 'Floor Puzzle\nमंज़िल पहेली', ''],
      ],
      'General Science': [['General Science'], ['सामान्य विज्ञान'], [], HEADER, [1, 1, 'Physics\nभौतिकी', 'Motion\nगति', 'Speed and Velocity\nचाल और वेग']],
      'Exam Syllabus Map': [['Exam', 'Stage', 'Subject'], ['RRB NTPC', 'CBT 1', 'General Science'], [], ['x', 'y'], ['RRB', 'CBT', 'GS']],
    });
    const out = await svc.importFromExcel(buf);

    expect(out.subjects).toBe(2); // the info sheet was skipped
    expect(db.chapters.filter((c) => c.subjectId === 's-plain')).toHaveLength(0); // nothing on the empty duplicate
    const reasoning = db.chapters.filter((c) => c.subjectId === 's-sub');
    expect(reasoning.map((c) => c.slug).sort()).toEqual(['chap-blood_relations-reasoning', 'chap-puzzles-reasoning']);
    expect(reasoning.find((c) => c.slug === 'chap-blood_relations-reasoning')).toMatchObject({ name: 'Blood Relations', nameHindi: 'रक्त संबंध' });
    expect(db.subjects.find((s) => s.id === 's-sub')!.name).toBe('Reasoning'); // existing English name kept

    const gs = db.subjects.find((s) => s.slug === 'sub-general_science');
    expect(gs).toMatchObject({ name: 'General Science', nameHindi: 'सामान्य विज्ञान' });
    expect(db.chapters.find((c) => c.subjectId === gs!.id)!.slug).toBe('chap-physics-general_science');
    expect(db.subTopics.map((s) => s.name).sort()).toEqual(['Coded Relations', 'Speed and Velocity']);
  });

  it('re-importing the same workbook adds nothing', async () => {
    const db = fakePrisma();
    const svc = new TaxonomyImportService(db.prisma);
    const buf = workbook({ Reasoning: [['Reasoning'], [''], [], HEADER, [1, 1, 'Puzzles\nपहेलियाँ', 'Floor Puzzle', 'Two floors']] });
    await svc.importFromExcel(buf);
    const sizes = () => [db.subjects.length, db.chapters.length, db.topics.length, db.subTopics.length].join(',');
    const first = sizes();
    await svc.importFromExcel(buf);
    expect(sizes()).toBe(first);
  });
});
