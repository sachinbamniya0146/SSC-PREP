import * as fs from 'fs';
import * as path from 'path';
import { TaxonomyImportService } from './taxonomy-import.service';

// S43: the shipped "all exams" syllabus workbook must parse cleanly: every sheet a subject, every new name bilingual,
// no topic twice in a chapter, info sheets skipped.
const FILE = path.join(__dirname, '..', '..', '..', 'docs', 'syllabus', 'SSC_PrepHub_Syllabus_All_Exams_v1.xlsx');
const DEVANAGARI = /[ऀ-ॿ]/;

describe('docs/syllabus/SSC_PrepHub_Syllabus_All_Exams_v1.xlsx', () => {
  const svc = new TaxonomyImportService({} as never);
  const subjects = svc.parseWorkbook(fs.readFileSync(FILE));

  it('has exactly the 8 subject sheets (README, map, reference and overview sheets are skipped)', () => {
    expect(subjects.map((s) => s.sheetName)).toEqual(['General Science', 'Mathematics', 'Computer Knowledge', 'Reasoning', 'Quant Aptitude', 'English', 'General Awareness', 'Hindi']);
  });

  it('new subjects carry a Hindi name; General Science = Physics, Chemistry, Biology, Environment', () => {
    const gs = subjects.find((s) => s.sheetName === 'General Science')!;
    expect(gs.nameHindi).toBe('सामान्य विज्ञान');
    expect(gs.chapters.map((c) => c.name)).toEqual(['Physics', 'Chemistry', 'Biology', 'Environment and Ecology']);
    expect(subjects.find((s) => s.sheetName === 'Mathematics')!.chapters).toHaveLength(9);
  });

  it('every topic and sub-topic has an English and a Devanagari Hindi name, and no topic repeats inside a chapter', () => {
    for (const s of subjects)
      for (const c of s.chapters) {
        const names = c.topics.map((t) => t.name.toLowerCase());
        expect(new Set(names).size).toBe(names.length);
        for (const t of c.topics) {
          expect(`${s.sheetName}/${c.name}/${t.name}:${DEVANAGARI.test(t.nameHindi ?? '')}`).toBe(`${s.sheetName}/${c.name}/${t.name}:true`);
          for (const st of t.subTopics) expect(`${t.name}/${st.name}:${DEVANAGARI.test(st.nameHindi ?? '')}`).toBe(`${t.name}/${st.name}:true`);
        }
      }
  });

  it('existing chapters are named exactly as on the platform (so they are reused, not duplicated)', () => {
    const hindi = subjects.find((s) => s.sheetName === 'Hindi')!;
    expect(hindi.chapters[0]).toMatchObject({ name: 'Vyakaran', nameHindi: null });
  });
});
