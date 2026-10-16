/* eslint-disable @typescript-eslint/no-explicit-any */
jest.mock('../search/search.service', () => ({ SearchService: class {} }));
import * as XLSX from 'xlsx';
import { ConflictException } from '@nestjs/common';
import { BankUploadJobService } from './bank-upload-job.service';

const ID1 = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ID2 = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const ID3 = '3f2504e0-4f89-41d3-9a0c-0305e82c3303';
const stored = (id: string, over: any = {}) => ({ id, questionText: 'Old Q', questionTextHindi: '', explanation: 'sol', explanationHindi: '', correctAnswer: 'B', difficulty: 'MEDIUM', marks: 1, negativeMarks: 0.25, year: null, shift: null, paperCode: null, examDate: null, optionsJson: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }, { key: 'C', text: '3' }, { key: 'D', text: '4' }], ...over });

function sheet(rows: any[][]): Buffer {
  const head = ['id', 'examId*', 'subjectId*', 'chapterId*', 'questionText*', 'optionA*', 'optionB*', 'optionC*', 'optionD*', 'correctAnswer*', 'explanation', 'difficulty'];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows]), 'Questions');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
async function done(svc: BankUploadJobService, job: any) {
  for (let i = 0; i < 200 && svc.get(job.id)!.status === 'RUNNING'; i++) await new Promise((r) => setTimeout(r, 10));
  return svc.get(job.id)!;
}
function mk(editImpl?: (id: string, body: any) => Promise<any>) {
  const calls: any[] = [];
  const prisma: any = { question: { findMany: async (a: any) => (a.where?.id ? [stored(ID1), stored(ID2)].filter((q) => a.where.id.in.map((x: string) => x.toLowerCase()).includes(q.id)) : []) } };
  const upload: any = { beginBatch: async () => 'b1', updateBatchProgress: async () => undefined, endBatch: async () => undefined, processRowsChunk: async (_h: any, rows: any[][]) => ({ created: rows.length, failed: 0, errors: [], warnings: [] }), warnJunk: async () => undefined, warnYearlessInPyqUpload: async () => undefined };
  const edit: any = { update: async (id: string, body: any) => { calls.push({ id, body }); if (editImpl) return editImpl(id, body); return { ok: true }; } };
  return { svc: new BankUploadJobService(prisma, upload, edit), calls };
}
const base = (over: any[]) => ['', 'e', 's', 'c', 'New question text', 'a', 'b', 'c', 'd', 'A', 'solution', 'EASY'].map((v, i) => (over[i] !== undefined ? over[i] : v));

describe('upload by ID (Task B)', () => {
  const rows = [
    [ID1, '', '', '', 'Edited text', '', '', '', '', '', '', ''], // changes text only (blank cells keep)
    [ID2, '', '', '', '', '', '', '', '', '', '', ''],            // nothing to change -> SAME
    base([ID3]),                                             // unknown id
    base(['not-a-uuid']),                                    // bad id
    base(['']),                                              // new question
  ];
  it('check-only: classifies rows, writes nothing', async () => {
    const { svc, calls } = mk();
    const j = await done(svc, svc.start({ buffer: sheet(rows), filename: 'x.xlsx', adminId: 'a', isPracticeOnly: true, requireSolution: true, dryRun: true }));
    expect(j.status).toBe('DONE');
    expect(calls).toHaveLength(0);
    expect([j.updated, j.unchanged, j.created, j.failed]).toEqual([1, 1, 1, 2]);
    expect(j.preview.find((p) => p.action === 'UPDATE')?.changes).toEqual(['questionText']);
    expect(j.errors.map((e) => e.category).sort()).toEqual(['FORMAT', 'INVALID_REFERENCE']);
  });
  it('real run: updates ONLY non-blank cells through QuestionEditService, creates the new row', async () => {
    const { svc, calls } = mk();
    const j = await done(svc, svc.start({ buffer: sheet(rows), filename: 'x.xlsx', adminId: 'adm', isPracticeOnly: true, requireSolution: true, dryRun: false }));
    expect(calls).toHaveLength(1);
    expect(calls[0].id).toBe(ID1);
    expect(calls[0].body).toEqual({ questionText: 'Edited text', reason: 'Excel re-upload (by ID)' });
    expect([j.updated, j.created]).toEqual([1, 1]);
  });
  it('an update that becomes a duplicate is rejected, others continue', async () => {
    const { svc } = mk(async () => { throw new ConflictException('Aisa hi question pehle se hai'); });
    const j = await done(svc, svc.start({ buffer: sheet([rows[0]]), filename: 'x.xlsx', adminId: 'adm', isPracticeOnly: true, requireSolution: true, dryRun: false }));
    expect(j.updated).toBe(0);
    expect(j.errors[0].category).toBe('DUPLICATE');
  });
  it('same id twice in the file: second row rejected', async () => {
    const { svc } = mk();
    const j = await done(svc, svc.start({ buffer: sheet([rows[0], rows[0]]), filename: 'x.xlsx', adminId: 'a', isPracticeOnly: true, requireSolution: true, dryRun: true }));
    expect([j.updated, j.failed]).toEqual([1, 1]);
  });
});
