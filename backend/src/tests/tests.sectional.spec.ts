/* eslint-disable @typescript-eslint/no-explicit-any */
import { TestsService } from './tests.service';

// In-memory fake of exactly the Prisma calls the sectional-timer paths make.
function makeFake() {
  const pattern = {
    id: 'pat1',
    examId: 'ex1',
    name: 'T1',
    negativeMarks: 0.5,
    lockPreviousSections: true,
    scribeExtraMinutes: 5,
    sections: [
      { name: 'Reasoning', subjectSlug: 'reasoning', questions: 2, marks: 4, durationMinutes: 15 },
      { name: 'GA', subjectSlug: 'general_awareness', questions: 2, marks: 4, durationMinutes: 15 },
    ],
  };
  const questions = [
    { id: 'r1', correctAnswer: 'A', marks: 1, negativeMarks: 0.25, subject: { slug: 'reasoning' } },
    { id: 'r2', correctAnswer: 'B', marks: 1, negativeMarks: 0.25, subject: { slug: 'reasoning' } },
    { id: 'g1', correctAnswer: 'C', marks: 1, negativeMarks: 0.25, subject: { slug: 'general_awareness' } },
    { id: 'g2', correctAnswer: 'D', marks: 1, negativeMarks: 0.25, subject: { slug: 'general_awareness' } },
  ];
  const attempts: any[] = [];
  const answers = new Map<string, any>();
  const prisma: any = {
    testTemplate: { findUnique: async () => ({ id: 'tpl', durationMinutes: 60, isPremium: false, examPattern: pattern }) },
    testAttempt: {
      findFirst: async ({ where }: any) => {
        const a = attempts.find((x) => (where.id ? x.id === where.id : true) && (where.userId ? x.userId === where.userId : true) && (where.status ? x.status === where.status : true));
        return a ?? null;
      },
      create: async ({ data }: any) => {
        const row = { id: 'att' + (attempts.length + 1), ...data };
        attempts.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const a = attempts.find((x) => x.id === where.id && (where.status === undefined || x.status === where.status));
        if (!a) return { count: 0 };
        Object.assign(a, data);
        return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }: any) => ({ ...attempts.find((x) => x.id === where.id), testTemplate: {}, answers: [] }),
    },
    attemptAnswer: {
      findMany: async () => [...answers.values()],
      upsert: async ({ where, create, update }: any) => {
        const k = where.testAttemptId_questionId.questionId;
        answers.set(k, answers.has(k) ? { ...answers.get(k), ...update } : { ...create });
        return answers.get(k);
      },
    },
    question: {
      findMany: async ({ where }: any) => questions.filter((q) => where.id.in.includes(q.id)),
    },
  };
  const svc: any = new (TestsService as any)(
    prisma,
    { awardTestXp: async () => undefined },
    { getTelegramUserByUserId: async () => null },
    {},
    { recordAnswers: async () => undefined },
  );
  svc.assertMockEntitled = async () => undefined;
  return { svc: svc as TestsService, attempts, answers };
}

const MIN = 60_000;

describe('strict sectional attempt (service level)', () => {
  const T0 = new Date('2026-12-01T10:00:00Z').getTime();
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
  });
  afterEach(() => jest.useRealTimers());

  it('start freezes the plan and sets expiresAt to the end of the last section', async () => {
    const { svc, attempts } = makeFake();
    const r: any = await svc.startAttempt('u1', 'tpl');
    expect(r.plan.totalMs).toBe(30 * MIN);
    expect(new Date(r.expiresAt).getTime()).toBe(T0 + 30 * MIN);
    expect(attempts[0].sectionPlan.sections).toHaveLength(2);
    // scribe is a separate attempt choice
    const s: any = await makeFake().svc.startAttempt('u2', 'tpl', { scribe: true });
    expect(s.plan.totalMs).toBe(40 * MIN);
  });

  it('autosave: only the open section is writable; a closed section keeps its value', async () => {
    const { svc, answers } = makeFake();
    const r: any = await svc.startAttempt('u1', 'tpl');
    const a = (questionId: string, selectedOption: string) => ({ questionId, selectedOption });

    jest.setSystemTime(T0 + 2 * MIN);
    let res: any = await svc.saveAnswers('u1', r.id, { answers: [a('r1', 'A'), a('g1', 'C')] });
    expect(res).toEqual({ saved: 1, rejected: 1 }); // g1 belongs to a section that has not opened
    expect(answers.get('r1').selectedOption).toBe('A');
    expect(answers.has('g1')).toBe(false);

    jest.setSystemTime(T0 + 16 * MIN);
    res = await svc.saveAnswers('u1', r.id, { answers: [a('r1', 'D'), a('g1', 'C')] });
    expect(res).toEqual({ saved: 1, rejected: 1 }); // r1 is closed now
    expect(answers.get('r1').selectedOption).toBe('A'); // unchanged
    expect(answers.get('g1').selectedOption).toBe('C');
  });

  it('autosave: a few seconds of grace right after a section closes keeps the last click', async () => {
    const { svc, answers } = makeFake();
    const r: any = await svc.startAttempt('u1', 'tpl');
    jest.setSystemTime(T0 + 15 * MIN + 3000);
    const res: any = await svc.saveAnswers('u1', r.id, { answers: [{ questionId: 'r2', selectedOption: 'B' }] });
    expect(res.saved).toBe(1);
    expect(answers.get('r2').selectedOption).toBe('B');
  });

  it('submit: closed-section overwrites in the payload are ignored; scoring uses the pattern (+2 / -0.5)', async () => {
    const { svc, answers } = makeFake();
    const r: any = await svc.startAttempt('u1', 'tpl');
    jest.setSystemTime(T0 + 5 * MIN);
    await svc.saveAnswers('u1', r.id, { answers: [{ questionId: 'r1', selectedOption: 'A' }, { questionId: 'r2', selectedOption: 'A' }] }); // r1 right, r2 wrong
    jest.setSystemTime(T0 + 20 * MIN);
    const out: any = await svc.submitAttempt('u1', r.id, {
      answers: [
        { questionId: 'r1', selectedOption: 'D' }, // tampered: tries to flip a closed section
        { questionId: 'r2', selectedOption: 'B' }, // tampered: tries to fix the wrong one
        { questionId: 'g1', selectedOption: 'C' }, // legit, open section
        { questionId: 'g2', selectedOption: 'A' }, // wrong
      ],
    });
    expect(answers.get('r1').selectedOption).toBe('A');
    expect(answers.get('r2').selectedOption).toBe('A');
    // r1 +2, r2 -0.5, g1 +2, g2 -0.5
    expect(out.score).toBe(3);
    expect(out.totalCorrect).toBe(2);
    expect(out.totalWrong).toBe(2);
  });

  it('offline replay after the deadline honours only answers stamped inside their own section window', async () => {
    const { svc, answers } = makeFake();
    const r: any = await svc.startAttempt('u1', 'tpl');
    jest.setSystemTime(T0 + 45 * MIN); // replay arrives 15 min after the end
    const out: any = await svc.submitAttempt('u1', r.id, {
      clientSubmittedAt: T0 + 29 * MIN,
      answers: [
        { questionId: 'r1', selectedOption: 'A' },
        { questionId: 'g1', selectedOption: 'C' },
        { questionId: 'g2', selectedOption: 'D' },
      ],
      answeredAt: {
        r1: T0 + 3 * MIN, // inside section 1
        g1: T0 + 20 * MIN, // inside section 2
        g2: T0 + 3 * MIN, // claims to have answered a GA question during section 1 -> rejected
      },
    });
    expect(answers.get('r1').selectedOption).toBe('A');
    expect(answers.get('g1').selectedOption).toBe('C');
    expect(answers.has('g2')).toBe(false);
    expect(out.score).toBe(4);
  });

  it('a replay with no answeredAt stamps keeps only what autosave stored', async () => {
    const { svc, answers } = makeFake();
    const r: any = await svc.startAttempt('u1', 'tpl');
    jest.setSystemTime(T0 + 45 * MIN);
    await svc.submitAttempt('u1', r.id, { clientSubmittedAt: T0 + 29 * MIN, answers: [{ questionId: 'r1', selectedOption: 'A' }] });
    expect(answers.has('r1')).toBe(false);
  });

  it('a client that stayed connected cannot use stamped late writes to edit a closed section', async () => {
    const { svc, answers } = makeFake();
    const r: any = await svc.startAttempt('u1', 'tpl');
    jest.setSystemTime(T0 + 3 * MIN);
    await svc.saveAnswers('u1', r.id, { answers: [{ questionId: 'r1', selectedOption: 'A' }] });
    jest.setSystemTime(T0 + 20 * MIN);
    await svc.attemptRemaining('u1', r.id); // heartbeat after section 1 closed
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const res: any = await svc.saveAnswers('u1', r.id, {
      answers: [{ questionId: 'r1', selectedOption: 'D' }],
      answeredAt: { r1: T0 + 4 * MIN }, // faked stamp inside section 1
    });
    expect(res.rejected).toBe(1);
    expect(answers.get('r1').selectedOption).toBe('A');
  });

  it('a student who went silent mid-section can deliver that section late with stamps', async () => {
    const { svc, answers } = makeFake();
    const r: any = await svc.startAttempt('u1', 'tpl');
    jest.setSystemTime(T0 + 3 * MIN);
    await svc.saveAnswers('u1', r.id, { answers: [{ questionId: 'r1', selectedOption: 'A' }] }); // last sync at 3 min
    for (let i = 0; i < 5; i++) await Promise.resolve();
    jest.setSystemTime(T0 + 20 * MIN); // back online after section 1 closed
    const res: any = await svc.saveAnswers('u1', r.id, {
      answers: [{ questionId: 'r2', selectedOption: 'B' }],
      answeredAt: { r2: T0 + 10 * MIN },
    });
    expect(res.saved).toBe(1);
    expect(answers.get('r2').selectedOption).toBe('B');
  });
});
