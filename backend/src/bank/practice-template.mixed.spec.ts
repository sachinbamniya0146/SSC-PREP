/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { PracticeTemplateService } from './practice-template.service';
import { MIXED_COLUMNS, MIXED_PYQ_ONLY_KEYS, headerLabel } from './bank-template';

// The header of the Master Package v3 / Percentage sheet: the mixed template must keep exactly these 34 columns in this order.
const MASTER_HEADER = ['examId*', 'subjectId*', 'chapterId*', 'topicId', 'subTopicId', 'questionText*', 'questionTextHindi', 'questionDiagramType', 'questionDiagramLabels', 'optionA*', 'optionA_Hindi', 'optionB*', 'optionB_Hindi', 'optionC*', 'optionC_Hindi', 'optionD*', 'optionD_Hindi', 'optionDiagramTypes', 'optionDiagramLabels', 'questionImageUrl', 'optionImageUrls', 'correctAnswer*', 'explanation*', 'explanationHindi', 'year', 'shift', 'paperCode', 'marks', 'negativeMarks', 'difficulty', 'examDate', 'examTier', 'tierPaper', 'questionNo'];

const prisma: any = {
  exam: { findMany: async () => [{ slug: 'exam-cgl', name: 'SSC CGL', code: 'CGL' }, { slug: 'exam-selection-post', name: 'SSC Selection Post', code: 'SELPOST' }] },
  subject: { findMany: async () => [{ id: 's1', slug: 'sub-quantitative_aptitude', name: 'Quantitative Aptitude', nameHindi: 'मात्रात्मक अभियोग्यता' }] },
  chapter: { findMany: async () => [{ id: 'c1', slug: 'chap-percentage-quantitative_aptitude', name: 'Percentage', nameHindi: 'प्रतिशत', subjectId: 's1' }] },
  topic: { findMany: async () => [{ id: 't1', slug: 'election-problems', name: 'Election Problems', nameHindi: null, chapterId: 'c1' }] },
  subTopic: { findMany: async () => [{ slug: 'turnout', name: 'Turnout', nameHindi: null, topicId: 't1' }] },
};

describe('PracticeTemplateService.buildMixed (PYQ + Practice in one Excel)', () => {
  it('keeps the 34 columns of the Master Package sheet, in the same order', () => {
    expect(MIXED_COLUMNS.map(headerLabel)).toEqual(MASTER_HEADER);
  });

  it('builds a real xlsx with dropdowns, examples and a live Reference IDs sheet (exams, topics, sub-topics)', async () => {
    const buf = await new PracticeTemplateService(prisma).buildMixed();
    if (process.env.DUMP_TEMPLATE) fs.writeFileSync(process.env.DUMP_TEMPLATE, buf);
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Questions', 'Examples', 'Columns guide', 'Instructions', 'Reference IDs', 'Lists']);
    const q = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Questions'], { header: 1 });
    expect(q).toHaveLength(1);
    expect(q[0]).toEqual(MASTER_HEADER);

    const ref = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Reference IDs'], { header: 1 });
    const types = ref.map((r) => r[0]);
    expect(types).toContain('Exam');
    expect(types).toContain('Topic');
    expect(types).toContain('Sub-topic');
    expect(ref.some((r) => r[0] === 'Exam' && r[1] === 'exam-selection-post')).toBe(true); // a newly created exam shows up at once
    expect(ref.find((r) => r[0] === 'Sub-topic')![4]).toBe('election-problems'); // parent slug

    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(xml).toContain('<dataValidations count="9">');
    expect(xml).toContain('Lists!$F$2:$F$5'); // Shift 1..4
    expect(xml).toContain('Lists!$G$2:$G$3'); // TIER_1 / TIER_2
    expect(xml).toContain('state="frozen"');
  });

  it('the example practice row has no paper column filled, the PYQ example has', async () => {
    const buf = await new PracticeTemplateService(prisma).buildMixed();
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Examples'], { header: 1 });
    const col = (k: string) => MIXED_COLUMNS.findIndex((c) => c.key === k);
    const pyq = rows[1];
    const practice = rows[2];
    for (const k of MIXED_PYQ_ONLY_KEYS) {
      expect(String(practice[col(k)] ?? '')).toBe('');
    }
    expect(String(pyq[col('examDate')])).toBe('12/09/2025');
    expect(String(pyq[col('examTier')])).toBe('TIER_1');
    expect(String(pyq[col('shift')])).toBe('Shift 2');
    expect(String(practice[col('subjectId')])).toBe('sub-quantitative_aptitude');
  });
});
