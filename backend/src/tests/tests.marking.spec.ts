/* eslint-disable @typescript-eslint/no-explicit-any */
import { cacheClearPrefix } from '../common/cache';
import { EXAM_PRESETS } from '../common/exam-presets';
import { MARKING_CACHE_PREFIX } from './marking-scheme';
import { TestsService } from './tests.service';

// Scoring of NON-locked attempts (28 Oct 2026): the exam's preset decides marks and negative marking, not the
// per-question columns that default to 2 / 0.5 for every row.

type Q = { id: string; correctAnswer: string; subject: { slug: string }; examId: string | null; examTier?: string | null; tierPaper?: string | null };

function makeFake(opts: { examId: string; presetKeys: string[]; questions: Q[]; template?: Record<string, any> }) {
  const patterns = opts.presetKeys.map((k) => {
    const p = EXAM_PRESETS.find((x) => x.key === k)!;
    return { id: `pat-${k}`, name: p.name, negativeMarks: p.negativeMarks, sections: p.sections };
  });
  // every question carries the column defaults — exactly what the database holds for old rows
  const questions = opts.questions.map((q) => ({ ...q, marks: 2, negativeMarks: 0.5 }));
  const template = { id: 'tpl', durationMinutes: 120, totalQuestions: 200, totalMarks: 400, isPremium: false, examId: opts.examId, examPatternId: null, examPattern: null, examTier: null, tierPaper: null, ...(opts.template ?? {}) };
  const attempts: any[] = [];
  const saved: any[] = [];
  const prisma: any = {
    testTemplate: { findUnique: async () => template },
    examPattern: {
      findMany: async ({ where }: any) => (where.examId === opts.examId ? patterns : []),
      findUnique: async () => null,
    },
    testAttempt: {
      findFirst: async ({ where }: any) => attempts.find((x) => (where.id ? x.id === where.id : true) && (where.status ? x.status === where.status : true)) ?? null,
      create: async ({ data }: any) => {
        const row = { id: 'att' + (attempts.length + 1), startedAt: new Date(), ...data };
        attempts.push(row);
        saved.push(row);
        return { ...row, testTemplate: { id: 'tpl', title: 'T', totalQuestions: template.totalQuestions, totalMarks: template.totalMarks }, answers: [] };
      },
      updateMany: async ({ where, data }: any) => {
        const a = attempts.find((x) => x.id === where.id && (where.status === undefined || x.status === where.status));
        if (!a) return { count: 0 };
        Object.assign(a, data);
        return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }: any) => ({ ...attempts.find((x) => x.id === where.id), testTemplate: {}, answers: [] }),
    },
    attemptAnswer: { findMany: async () => [], upsert: async () => ({}) },
    question: { findMany: async ({ where }: any) => questions.filter((q) => where.id.in.includes(q.id)) },
  };
  const svc: any = new (TestsService as any)(
    prisma,
    { awardTestXp: async () => undefined },
    { getTelegramUserByUserId: async () => null },
    {},
    { recordAnswers: async () => undefined },
  );
  svc.assertMockEntitled = async () => undefined;
  return { svc: svc as TestsService, attempts, saved, questions, template };
}

const cpoQuestions: Q[] = [
  { id: 'r1', correctAnswer: 'A', subject: { slug: 'reasoning' }, examId: 'cpo' },
  { id: 'r2', correctAnswer: 'B', subject: { slug: 'reasoning' }, examId: 'cpo' },
  { id: 'q1', correctAnswer: 'C', subject: { slug: 'quantitative_aptitude' }, examId: 'cpo' },
  { id: 'e1', correctAnswer: 'D', subject: { slug: 'english' }, examId: 'cpo' },
];

const mtsQuestions: Q[] = [
  { id: 'm1', correctAnswer: 'A', subject: { slug: 'quantitative_aptitude' }, examId: 'mts' },
  { id: 'm2', correctAnswer: 'B', subject: { slug: 'reasoning' }, examId: 'mts' },
  { id: 'g1', correctAnswer: 'C', subject: { slug: 'general_awareness' }, examId: 'mts' },
  { id: 'g2', correctAnswer: 'D', subject: { slug: 'english' }, examId: 'mts' },
];

describe('marking presets: scoring without a section plan', () => {
  beforeEach(() => cacheClearPrefix(MARKING_CACHE_PREFIX));

  it('CPO: +1 / -0.25 (a question-column scorer would have given +2 / -0.5)', async () => {
    const { svc } = makeFake({ examId: 'cpo', presetKeys: ['cpo-p1', 'cpo-p2'], questions: cpoQuestions });
    const r: any = await svc.startAttempt('u1', 'tpl');
    expect(r.plan).toBeNull(); // not a strict-section attempt
    const out: any = await svc.submitAttempt('u1', r.id, {
      answers: [
        { questionId: 'r1', selectedOption: 'A' }, // right
        { questionId: 'r2', selectedOption: 'A' }, // wrong
        { questionId: 'q1', selectedOption: 'C' }, // right
        { questionId: 'e1', selectedOption: null }, // skipped
      ],
    });
    expect(out.score).toBe(1.75); // 1 + 1 - 0.25
    expect(out.totalCorrect).toBe(2);
    expect(out.totalWrong).toBe(1);
    expect(out.totalSkipped).toBe(1);
  });

  it('MTS: a wrong answer in Session I (maths, reasoning) is free, in Session II it costs 1; every right answer is 3', async () => {
    const { svc } = makeFake({ examId: 'mts', presetKeys: ['mts'], questions: mtsQuestions });
    const r: any = await svc.startAttempt('u1', 'tpl');
    const out: any = await svc.submitAttempt('u1', r.id, {
      answers: [
        { questionId: 'm1', selectedOption: 'D' }, // wrong, Session I  -> 0
        { questionId: 'm2', selectedOption: 'B' }, // right             -> +3
        { questionId: 'g1', selectedOption: 'A' }, // wrong, Session II -> -1
        { questionId: 'g2', selectedOption: 'D' }, // right             -> +3
      ],
    });
    expect(out.score).toBe(5);
  });

  it('an exam without any preset keeps scoring with the question columns (nothing changes for it)', async () => {
    const { svc } = makeFake({ examId: 'cpo', presetKeys: [], questions: cpoQuestions });
    const r: any = await svc.startAttempt('u1', 'tpl');
    const out: any = await svc.submitAttempt('u1', r.id, { answers: [{ questionId: 'r1', selectedOption: 'A' }, { questionId: 'r2', selectedOption: 'A' }] });
    expect(out.score).toBe(1.5); // +2 - 0.5
  });

  it('questions of two exams in one attempt are not forced into one exam’s preset', async () => {
    const mixed: Q[] = [
      { id: 'r1', correctAnswer: 'A', subject: { slug: 'reasoning' }, examId: 'cpo' },
      { id: 'r2', correctAnswer: 'B', subject: { slug: 'reasoning' }, examId: 'other' },
    ];
    const { svc } = makeFake({ examId: 'cpo', presetKeys: ['cpo-p1'], questions: mixed, template: { examId: null } });
    const r: any = await svc.startAttempt('u1', 'tpl');
    const out: any = await svc.submitAttempt('u1', r.id, { answers: [{ questionId: 'r1', selectedOption: 'A' }, { questionId: 'r2', selectedOption: 'A' }] });
    expect(out.score).toBe(1.5); // question columns
  });

  it('saveAttempt (client-built set submitted in one go) uses the same preset', async () => {
    const { svc } = makeFake({ examId: 'cpo', presetKeys: ['cpo-p1'], questions: cpoQuestions });
    const out: any = await svc.saveAttempt('u1', {
      testTemplateId: 'tpl',
      score: 9999, // ignored: recomputed on the server
      answers: [
        { questionId: 'r1', selectedOption: 'A' },
        { questionId: 'r2', selectedOption: 'A' },
        { questionId: 'q1', selectedOption: 'C' },
      ],
    });
    expect(out.score).toBe(1.75);
  });

  it('the review (attemptDetail) shows the preset’s marks, the penalty per section, and the right "out of" total', async () => {
    const fake = makeFake({ examId: 'mts', presetKeys: ['mts'], questions: mtsQuestions, template: { totalQuestions: 90, totalMarks: 180 } });
    const qRow = (q: any) => ({
      id: q.id, questionText: 'q', questionTextHindi: null, optionsJson: [], correctAnswer: q.correctAnswer, explanation: null, explanationHindi: null,
      explanationSource: null, exam: { name: 'MTS' }, chapter: null, subject: { name: q.subject.slug, slug: q.subject.slug }, topic: null, subTopic: null,
      year: 2024, shift: null, marks: 2, negativeMarks: 0.5, difficulty: null, examId: q.examId, examTier: null, tierPaper: null,
    });
    const answers = fake.questions.map((q: any) => ({ selectedOption: 'A', isCorrect: false, isMarkedForReview: false, timeSpentSeconds: 1, question: qRow(q) }));
    const prisma: any = (fake.svc as any).prisma;
    prisma.testAttempt.findFirst = async () => ({
      id: 'a1', userId: 'u1', status: 'SUBMITTED', testTemplateId: 'tpl', score: 0, rank: 1, percentile: 100, sectionPlan: null,
      testTemplate: { ...fake.template }, answers,
    });
    prisma.testAttempt.aggregate = async () => ({ _max: { score: 0, accuracyPercent: 0 } });
    const out: any = await fake.svc.attemptDetail('u1', 'a1');
    const bySubject = (slug: string) => out.questions.find((x: any) => x.subject === slug);
    expect([bySubject('quantitative_aptitude').marks, bySubject('quantitative_aptitude').negativeMarks]).toEqual([3, 0]);
    expect([bySubject('reasoning').marks, bySubject('reasoning').negativeMarks]).toEqual([3, 0]);
    expect([bySubject('general_awareness').marks, bySubject('general_awareness').negativeMarks]).toEqual([3, 1]);
    expect([bySubject('english').marks, bySubject('english').negativeMarks]).toEqual([3, 1]);
    // the template row says 180 (built from question columns); the paper is worth 270 x 90/90 under the preset
    expect(out.testTemplate.totalMarks).toBe(270);
  });

  it('a date-wise (keyed) PYQ paper shows and totals the preset marking: CGL Tier 2 is +3 / -1, not the column default +2 / -0.5', async () => {
    const id = 'pyq-k-cgl-t2-20250118-na';
    const fake = makeFake({
      examId: 'cgl',
      presetKeys: ['cgl-t1', 'cgl-t2-p1'],
      questions: [],
      template: { id, type: 'SHIFT_WISE', title: 'CGL Tier 2', description: null, examTier: 'TIER_2', tierPaper: 'PAPER_1', examDate: '2025-01-18', shift: null, totalQuestions: 3, totalMarks: 6 },
    });
    const row = (qid: string, slug: string, n: number) => ({
      id: qid, questionText: `question ${qid}`, createdAt: new Date(2025, 0, n), paperQuestionNo: n, questionTextHindi: 'h', questionDiagramType: null, questionDiagramLabels: null,
      questionImageUrl: null, optionsJson: [{ key: 'A', text: 'a' }], year: 2025, shift: null, marks: 2, negativeMarks: 0.5, examId: 'cgl', examTier: 'TIER_2', tierPaper: 'PAPER_1',
      exam: { name: 'CGL' }, subject: { name: slug, slug }, chapter: null,
    });
    const rows = [row('a', 'quantitative_aptitude', 1), row('b', 'english', 2), row('c', 'computer', 3)];
    (fake.svc as any).prisma.question.findMany = async () => rows;
    const out: any = await fake.svc.paper('u1', id);
    const all = out.sections.flatMap((x: any) => x.questions);
    expect(all.map((q: any) => [q.marks, q.negativeMarks])).toEqual([[3, 1], [3, 1], [3, 1]]);
    expect(out.totalMarks).toBe(9);
  });
});
