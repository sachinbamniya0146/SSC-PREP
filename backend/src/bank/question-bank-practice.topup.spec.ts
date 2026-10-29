import { QuestionBankPracticeService } from './question-bank-practice.service';

// S44: a practice set for an exam with few questions of its own is filled from the same topic's practice of other exams,
// the exam's own questions always first; with enough own questions nothing changes.
type Row = { id: string; examId: string; difficulty: string };

function service(rows: Row[]) {
  const matches = (r: Row, where: any) => {
    const e = where.examId;
    if (typeof e === 'string') return r.examId === e;
    if (e && Array.isArray(e.notIn)) return !e.notIn.includes(r.examId);
    return true;
  };
  const prisma: any = {
    question: {
      findMany: async ({ where, select }: any) => {
        if (where.id?.in) return rows.filter((r) => where.id.in.includes(r.id));
        const hit = rows.filter((r) => matches(r, where));
        return select ? hit.map((r) => ({ id: r.id, difficulty: r.difficulty })) : hit;
      },
    },
    questionBankSet: { findMany: async () => [] },
  };
  return new QuestionBankPracticeService(prisma, {} as never);
}
const fetch = (svc: QuestionBankPracticeService, examId: string, size = 10): Promise<{ id: string; examId: string }[]> =>
  (svc as unknown as { fetchQuestionsForSet: (u: string, s: object, n: number) => Promise<{ id: string; examId: string }[]> }).fetchQuestionsForSet('u1', { topicId: 't1', examId }, size);

describe('practice set top-up from the same topic of other exams (S44)', () => {
  const rows: Row[] = [
    ...Array.from({ length: 3 }, (_, i) => ({ id: `rrb${i}`, examId: 'rrb', difficulty: 'HARD' })),
    ...Array.from({ length: 30 }, (_, i) => ({ id: `cgl${i}`, examId: 'cgl', difficulty: ['EASY', 'MEDIUM', 'HARD'][i % 3] })),
  ];

  it('3 own questions + 7 from other exams, all 3 own ones are in the set', async () => {
    const set = await fetch(service(rows), 'rrb');
    expect(set).toHaveLength(10);
    expect(set.filter((q) => q.examId === 'rrb')).toHaveLength(3);
  });

  it('an exam with a full pool of its own never borrows', async () => {
    const set = await fetch(service(rows), 'cgl');
    expect(set).toHaveLength(10);
    expect(set.every((q) => q.examId === 'cgl')).toBe(true);
  });

  it('no other exam in the topic -> the small own set as before', async () => {
    const set = await fetch(service(rows.filter((r) => r.examId === 'rrb')), 'rrb');
    expect(set.map((q) => q.id).sort()).toEqual(['rrb0', 'rrb1', 'rrb2']);
  });
});
