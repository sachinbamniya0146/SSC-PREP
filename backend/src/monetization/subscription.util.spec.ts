import { addMonths, grantOrExtendSubscription } from './subscription.util';

// Tiny in-memory stand-in for prisma.subscription
function fakeDb(rows: any[]) {
  return {
    rows,
    subscription: {
      findFirst: async ({ where }: any) =>
        rows
          .filter((r) => r.userId === where.userId && r.status === where.status && r.endsAt > where.endsAt.gt)
          .sort((a, b) => b.endsAt - a.endsAt)[0] ?? null,
      updateMany: async ({ where, data }: any) => {
        rows.filter((r) => r.userId === where.userId && r.status === where.status).forEach((r) => Object.assign(r, data));
        return { count: 1 };
      },
      create: async ({ data }: any) => {
        const row = { id: String(rows.length + 1), ...data };
        rows.push(row);
        return row;
      },
    },
  };
}

describe('addMonths', () => {
  it('clamps to the end of a shorter month instead of overflowing', () => {
    expect(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addMonths(new Date('2028-01-31T00:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2028-02-29');
  });
  it('handles year rollover and long plans', () => {
    expect(addMonths(new Date('2026-11-15T00:00:00Z'), 3).toISOString().slice(0, 10)).toBe('2027-02-15');
    expect(addMonths(new Date('2026-10-24T00:00:00Z'), 24).toISOString().slice(0, 10)).toBe('2028-10-24');
  });
});

describe('grantOrExtendSubscription', () => {
  const now = new Date('2026-10-24T00:00:00Z');

  it('starts from now when the user has no active plan', async () => {
    const db = fakeDb([]);
    const r = await grantOrExtendSubscription(db as any, { userId: 'u', planId: 'p', months: 1, now });
    expect(r.extended).toBe(false);
    expect(r.subscription.endsAt.toISOString().slice(0, 10)).toBe('2026-11-24');
  });

  it('appends to the remaining time instead of destroying it', async () => {
    const db = fakeDb([{ id: 'old', userId: 'u', planId: 'p', status: 'ACTIVE', startsAt: new Date('2026-09-01'), endsAt: new Date('2027-03-24T00:00:00Z') }]);
    const r = await grantOrExtendSubscription(db as any, { userId: 'u', planId: 'p', months: 6, now });
    expect(r.extended).toBe(true);
    expect(r.subscription.endsAt.toISOString().slice(0, 10)).toBe('2027-09-24');
    // exactly one ACTIVE row remains
    expect(db.rows.filter((x) => x.status === 'ACTIVE')).toHaveLength(1);
    expect(db.rows.find((x) => x.id === 'old')!.status).toBe('EXPIRED');
  });

  it('ignores an already-lapsed ACTIVE row and restarts from now', async () => {
    const db = fakeDb([{ id: 'old', userId: 'u', planId: 'p', status: 'ACTIVE', startsAt: new Date('2026-01-01'), endsAt: new Date('2026-02-01') }]);
    const r = await grantOrExtendSubscription(db as any, { userId: 'u', planId: 'p', days: 30, now });
    expect(r.extended).toBe(false);
    expect(r.subscription.endsAt.toISOString().slice(0, 10)).toBe('2026-11-23');
    expect(db.rows.filter((x) => x.status === 'ACTIVE')).toHaveLength(1);
  });
});
