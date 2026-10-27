/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException } from '@nestjs/common';
import { TestsService } from './tests.service';

// Regression tests for the 27 Oct 2026 student-flow audit:
//  - paper() + startAttempt() used to spend a free-trial use EACH (one click burned both free mocks) and a refresh
//    in the middle of a free attempt was locked out ("This mock is premium");
//  - attemptDetail() leaked the answer key of an attempt that was still running;
//  - a submit that lost the race wrote its answers over the winner's.

function makeFake(opts: { freeAllowed?: number; mocksUsed?: number | null } = {}) {
  const template = { id: 'tpl-premium', title: 'Premium mock', durationMinutes: 60, isPremium: true, examPattern: null };
  let access: any =
    opts.mocksUsed == null ? null : { userId: 'u1', testTemplateId: template.id, mocksUsed: opts.mocksUsed, freeMocksAllowed: opts.freeAllowed ?? 2, paidPacksPurchased: 0 };
  const attempts: any[] = [];
  const answerUpserts: any[] = [];
  const prisma: any = {
    testTemplate: { findUnique: async () => template },
    user: { findUnique: async () => ({ role: 'STUDENT', subscriptions: [] }) },
    mockAccess: {
      findUnique: async () => (access ? { ...access } : null),
      create: async ({ data }: any) => {
        access = { freeMocksAllowed: opts.freeAllowed ?? 2, paidPacksPurchased: 0, ...data };
        return access;
      },
      updateMany: async ({ where, data }: any) => {
        if (!access || !(access.mocksUsed < where.mocksUsed.lt)) return { count: 0 };
        access.mocksUsed += data.mocksUsed.increment;
        return { count: 1 };
      },
    },
    testAttempt: {
      findFirst: async ({ where }: any) =>
        attempts.find(
          (a) =>
            (!where.id || a.id === where.id) &&
            (!where.userId || a.userId === where.userId) &&
            (!where.testTemplateId || a.testTemplateId === where.testTemplateId) &&
            (!where.status || a.status === where.status) &&
            (!where.expiresAt?.gt || a.expiresAt > where.expiresAt.gt),
        ) ?? null,
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
      findMany: async () => [],
      upsert: async (arg: any) => {
        answerUpserts.push(arg);
        return arg;
      },
    },
    question: { findMany: async ({ where }: any) => (where?.id?.in ?? []).map((id: string) => ({ id, correctAnswer: 'A', marks: 2, negativeMarks: 0.5, subject: { slug: 'reasoning' } })) },
  };
  const svc: any = new (TestsService as any)(
    prisma,
    { awardTestXp: async () => undefined },
    { getTelegramUserByUserId: async () => null },
    {},
    { recordAnswers: async () => undefined },
  );
  return { svc: svc as TestsService, prisma, attempts, answerUpserts, getAccess: () => access };
}

describe('premium-mock free-trial entitlement', () => {
  it('a read-only check (paper) never spends a free use, start spends exactly one', async () => {
    const { svc, getAccess, attempts } = makeFake({ mocksUsed: 0 });
    await (svc as any).assertMockEntitled('u1', { id: 'tpl-premium', isPremium: true }, { consume: false });
    expect(getAccess().mocksUsed).toBe(0);

    await svc.startAttempt('u1', 'tpl-premium');
    expect(getAccess().mocksUsed).toBe(1);
    expect(attempts).toHaveLength(1);
  });

  it('first ever access (no row yet) via the read-only check creates no row', async () => {
    const { svc, getAccess } = makeFake({ mocksUsed: null });
    await (svc as any).assertMockEntitled('u1', { id: 'tpl-premium', isPremium: true }, { consume: false });
    expect(getAccess()).toBeNull();
  });

  it('resuming a running attempt does not spend another free use and works after the free uses are gone', async () => {
    const { svc, getAccess, attempts } = makeFake({ mocksUsed: 1, freeAllowed: 2 });
    const first: any = await svc.startAttempt('u1', 'tpl-premium'); // spends the 2nd (last) free use
    expect(getAccess().mocksUsed).toBe(2);

    const again: any = await svc.startAttempt('u1', 'tpl-premium'); // refresh mid-test
    expect(again.resumed).toBe(true);
    expect(again.id).toBe(first.id);
    expect(getAccess().mocksUsed).toBe(2);
    expect(attempts).toHaveLength(1);

    // the exam page also re-loads the paper on refresh: allowed because an attempt is running
    await expect((svc as any).assertMockEntitled('u1', { id: 'tpl-premium', isPremium: true }, { consume: false })).resolves.toBeUndefined();
  });

  it('a student with no free use left and no running attempt is still refused (read-only and start)', async () => {
    const { svc } = makeFake({ mocksUsed: 2, freeAllowed: 2 });
    await expect((svc as any).assertMockEntitled('u1', { id: 'tpl-premium', isPremium: true }, { consume: false })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.startAttempt('u1', 'tpl-premium')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('attemptDetail answer-key guard', () => {
  it('refuses an attempt that is still IN_PROGRESS', async () => {
    const { svc, prisma } = makeFake();
    prisma.testAttempt.findFirst = async () => ({ id: 'a1', userId: 'u1', status: 'IN_PROGRESS', answers: [], testTemplateId: 't' });
    await expect(svc.attemptDetail('u1', 'a1')).rejects.toThrow(/still in progress/i);
  });
});

describe('submit race', () => {
  it('only the request that wins the IN_PROGRESS claim writes the per-question answers', async () => {
    const { svc, attempts, answerUpserts, prisma } = makeFake();
    const started: any = await svc.startAttempt('u1', 'tpl-premium').catch(() => null);
    // free-trial row absent => first start is allowed
    expect(started).toBeTruthy();
    const body = { answers: [{ questionId: 'q1', selectedOption: 'A' }, { questionId: 'q2', selectedOption: 'B' }] };

    // lose the race: someone else flips the row to SUBMITTED between our read and our claim
    const realUpdateMany = prisma.testAttempt.updateMany;
    prisma.testAttempt.updateMany = async (arg: any) => {
      attempts[0].status = 'SUBMITTED';
      return realUpdateMany({ ...arg, where: { ...arg.where, status: 'IN_PROGRESS' } });
    };
    const res: any = await svc.submitAttempt('u1', started.id, body);
    expect(res).toBeTruthy();
    expect(answerUpserts).toHaveLength(0);
  });

  it('the winner writes every answer', async () => {
    const { svc, answerUpserts } = makeFake();
    const started: any = await svc.startAttempt('u1', 'tpl-premium');
    await svc.submitAttempt('u1', started.id, { answers: [{ questionId: 'q1', selectedOption: 'A' }, { questionId: 'q2', selectedOption: 'B' }] });
    expect(answerUpserts.map((u) => u.where.testAttemptId_questionId.questionId).sort()).toEqual(['q1', 'q2']);
  });
});
