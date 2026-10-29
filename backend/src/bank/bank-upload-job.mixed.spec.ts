/* eslint-disable @typescript-eslint/no-explicit-any */
jest.mock('../search/search.service', () => ({ SearchService: class {} }));
import * as XLSX from 'xlsx';
import { BankUploadJobService } from './bank-upload-job.service';

// Percentage-sheet-like file: 34 columns, blank questionNo, Shift 4, MTS Afternoon, Selection Post, practice rows.
const HEAD = ['examId*', 'subjectId*', 'chapterId*', 'topicId', 'subTopicId', 'questionText*', 'questionTextHindi', 'questionDiagramType', 'questionDiagramLabels', 'optionA*', 'optionA_Hindi', 'optionB*', 'optionB_Hindi', 'optionC*', 'optionC_Hindi', 'optionD*', 'optionD_Hindi', 'optionDiagramTypes', 'optionDiagramLabels', 'questionImageUrl', 'optionImageUrls', 'correctAnswer*', 'explanation*', 'explanationHindi', 'year', 'shift', 'paperCode', 'marks', 'negativeMarks', 'difficulty', 'examDate', 'examTier', 'tierPaper', 'questionNo'];
function line(o: Record<string, any>): any[] {
  const base: Record<string, any> = { 'examId*': 'exam-cgl', 'subjectId*': 'sub-quantitative_aptitude', 'chapterId*': 'chap-percentage-quantitative_aptitude', 'questionText*': 'Q', questionTextHindi: 'प्र', 'optionA*': '1', 'optionB*': '2', 'optionC*': '3', 'optionD*': '4', 'correctAnswer*': 'A', 'explanation*': 'sol' };
  const m = { ...base, ...o };
  return HEAD.map((h) => m[h] ?? '');
}
function sheet(rows: any[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEAD, ...rows]), 'Questions');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
async function done(svc: BankUploadJobService, job: any) {
  for (let i = 0; i < 300 && svc.get(job.id)!.status === 'RUNNING'; i++) await new Promise((r) => setTimeout(r, 10));
  return svc.get(job.id)!;
}
function mk() {
  const prisma: any = {
    question: { findMany: async () => [], groupBy: async () => [] },
    exam: { findMany: async () => [{ id: 'x1', slug: 'exam-cgl', name: 'SSC CGL', code: 'CGL' }, { id: 'x2', slug: 'exam-mts', name: 'SSC MTS', code: 'MTS' }] },
    subject: { findMany: async () => [{ id: 's1', slug: 'sub-quantitative_aptitude', name: 'Quantitative Aptitude' }] },
    chapter: { findMany: async () => [{ id: 'c1', slug: 'chap-percentage-quantitative_aptitude', name: 'Percentage', subjectId: 's1' }] },
    topic: { findMany: async () => [] },
    subTopic: { findMany: async () => [] },
  };
  const upload: any = { beginBatch: async () => 'b1', updateBatchProgress: async () => undefined, endBatch: async () => undefined, processRowsChunk: async (_h: any, rows: any[][]) => ({ created: rows.length, failed: 0, errors: [], warnings: [] }), warnJunk: async () => undefined, warnYearlessInPyqUpload: async () => undefined };
  return new BankUploadJobService(prisma, upload, {} as any);
}
const run = (svc: BankUploadJobService, rows: any[][], over: any = {}) =>
  done(svc, svc.start({ buffer: sheet(rows), filename: 'p.xlsx', adminId: 'a', isPracticeOnly: false, requireSolution: true, dryRun: true, mixed: true, ...over }));

describe('mixed PYQ + practice dry-run', () => {
  it('counts both kinds, one questionNo warning, practice plan, no job-level crash', async () => {
    const rows = [
      line({ year: 2024, shift: 'Shift 4', examDate: '20/06/2024', examTier: 'TIER_1', 'questionText*': 'pyq 1' }),
      line({ year: 2024, shift: 'Shift 4', examDate: '20/06/2024', examTier: 'TIER_1', 'questionText*': 'pyq 2' }),
      line({ 'questionText*': 'practice 1', topicId: 'Weighted Percentage' }),
      line({ 'questionText*': 'practice 2', topicId: 'Weighted Percentage' }),
      line({ 'questionText*': 'practice 3' }),
    ];
    const j = await run(mk(), rows);
    expect(j.status).toBe('DONE');
    expect(j.failed).toBe(0);
    expect([j.pyqRows, j.practiceRows, j.pyqWithoutQuestionNo]).toEqual([2, 3, 2]);
    expect(j.warnings.filter((w: any) => /no questionNo/.test(w.message))).toHaveLength(1);
    expect(j.practicePlan.length).toBeGreaterThan(0);
    expect(j.practicePlan.every((p: any) => p.target === 100)).toBe(true);
  });

  it('an exam that does not exist is rejected once per value with a fix hint (Selection Post not created yet)', async () => {
    const rows = [line({ 'examId*': 'exam-selection-post', year: 2024, 'questionText*': 'a' }), line({ 'examId*': 'exam-selection-post', year: 2024, 'questionText*': 'b' }), line({ 'questionText*': 'ok' })];
    const j = await run(mk(), rows);
    expect(j.failed).toBe(2);
    expect(j.errors.every((e: any) => e.category === 'INVALID_REFERENCE' && /\/admin\/exams/.test(e.error))).toBe(true);
    expect(j.unknownExams.map((u: any) => [u.value, u.count])).toEqual([['exam-selection-post', 2]]);
  });

  it('rows without Hindi get one aggregated warning', async () => {
    const j = await run(mk(), [line({ questionTextHindi: '', 'questionText*': 'a' }), line({ questionTextHindi: '', 'questionText*': 'b' })]);
    expect(j.hindiMissingRows).toHaveLength(2);
    expect(j.warnings.filter((w: any) => /Hindi/.test(w.message))).toHaveLength(1);
  });

  it('students-side safety: practice rows with a stray shift are still counted as practice', async () => {
    const j = await run(mk(), [line({ shift: 'Shift 2', 'questionText*': 'stray' })]);
    expect([j.pyqRows, j.practiceRows]).toEqual([0, 1]);
  });
});
