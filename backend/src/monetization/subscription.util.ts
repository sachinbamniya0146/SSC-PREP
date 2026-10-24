/* eslint-disable @typescript-eslint/no-explicit-any */
// Single source of truth for "give this user N months of premium".
//
// Before this helper existed, FOUR places (payment fulfilment, admin single
// grant, admin bulk grant, referral rewards) each cancelled the user's current
// ACTIVE subscription and started a brand-new one from today. Result: a
// student with 5 months left who bought another plan silently LOST those 5
// months, and an admin "gift" or a referral reward could shorten a paid plan.
//
// Rules implemented here:
//   * Time is never destroyed. If an ACTIVE, unexpired subscription exists the
//     new period is appended after it (new endsAt = old endsAt + duration).
//   * At most ONE row stays ACTIVE per user — the old row is closed
//     (EXPIRED, since it was not cancelled, just superseded) and the new row
//     carries the combined end date. Every existing "status = ACTIVE and
//     endsAt > now" check in the app therefore keeps working untouched.
//   * Month maths clamps to the last day of the month (Jan 31 + 1 month =
//     Feb 28/29, NOT Mar 3 like Date#setMonth does).
//   * Works on either the normal Prisma client or a transaction client, so the
//     caller decides whether the grant is part of a larger atomic unit.

export type Db = {
  subscription: {
    findFirst: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
  };
};

/** Date + n calendar months, clamped to the end of the target month. */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export interface GrantInput {
  userId: string;
  planId: string;
  /** Provide exactly one of months/days. */
  months?: number;
  days?: number;
  /** Optional: payment that bought this period (links Payment.subscriptionId). */
  now?: Date;
}

export interface GrantResult {
  subscription: any;
  /** true when time was appended to a still-running subscription */
  extended: boolean;
  previousEndsAt: Date | null;
}

export async function grantOrExtendSubscription(db: Db, input: GrantInput): Promise<GrantResult> {
  const now = input.now ?? new Date();
  const current = await db.subscription.findFirst({
    where: { userId: input.userId, status: 'ACTIVE', endsAt: { gt: now } },
    orderBy: { endsAt: 'desc' },
  });

  const base: Date = current ? current.endsAt : now;
  const endsAt =
    input.months && input.months > 0
      ? addMonths(base, input.months)
      : addDays(base, Math.max(1, input.days ?? 0));

  // Close every ACTIVE row (including already-lapsed ones that the expiry job
  // has not touched yet) so exactly one ACTIVE row remains after this call.
  await db.subscription.updateMany({
    where: { userId: input.userId, status: 'ACTIVE' },
    data: { status: 'EXPIRED' },
  });

  const subscription = await db.subscription.create({
    data: {
      userId: input.userId,
      planId: input.planId,
      status: 'ACTIVE',
      startsAt: current ? current.startsAt : now,
      endsAt,
    },
  });

  return { subscription, extended: !!current, previousEndsAt: current ? current.endsAt : null };
}
