import { checkCouponInput, checkPlanInput, couponAmounts, couponProblem, couponStatus, planPricing, type CouponRules } from './pricing.util';

const NOW = new Date('2026-10-28T06:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const coupon = (o: Partial<CouponRules> = {}): CouponRules => ({
  code: 'SAVE20',
  isActive: true,
  discountPct: 20,
  discountInr: null,
  maxDiscountInr: null,
  minOrderInr: null,
  maxUses: 10,
  usesCount: 0,
  perUserLimit: 1,
  startsAt: null,
  expiresAt: null,
  planIds: [],
  stackWithOffer: true,
  ...o,
});

describe('planPricing', () => {
  const plan = { priceInr: 600, durationMonths: 6 };

  it('charges the regular price when there is no offer', () => {
    const p = planPricing(plan, NOW);
    expect(p.salePriceInr).toBe(600);
    expect(p.offerActive).toBe(false);
    expect(p.strikeInr).toBeNull();
    expect(p.perMonthInr).toBe(100);
  });

  it('applies a running offer and shows the regular price struck through', () => {
    const p = planPricing({ ...plan, offerPct: 25, offerEndsAt: day(2), offerLabel: ' Diwali ' }, NOW);
    expect(p.offerActive).toBe(true);
    expect(p.salePriceInr).toBe(450);
    expect(p.strikeInr).toBe(600);
    expect(p.offerDiscountInr).toBe(150);
    expect(p.savingsPct).toBe(25);
    expect(p.offerLabel).toBe('Diwali');
  });

  it('ignores an offer that has not started or has ended', () => {
    expect(planPricing({ ...plan, offerPct: 25, offerStartsAt: day(1) }, NOW).salePriceInr).toBe(600);
    expect(planPricing({ ...plan, offerPct: 25, offerEndsAt: day(-1) }, NOW).salePriceInr).toBe(600);
  });

  it('shows MRP as the struck price without changing what is charged', () => {
    const p = planPricing({ ...plan, mrpInr: 999 }, NOW);
    expect(p.salePriceInr).toBe(600);
    expect(p.strikeInr).toBe(999);
    expect(p.savingsInr).toBe(399);
    expect(p.offerActive).toBe(false);
  });

  it('never goes below Rs 1', () => {
    expect(planPricing({ priceInr: 1, durationMonths: 1, offerPct: 90 }, NOW).salePriceInr).toBe(1);
  });
});

describe('couponAmounts', () => {
  it('percentage with cap', () => {
    expect(couponAmounts({ discountPct: 50, discountInr: null, maxDiscountInr: 100 }, 600)).toEqual({ discount: 100, finalAmountInr: 500 });
  });
  it('flat discount cannot exceed the amount', () => {
    expect(couponAmounts({ discountPct: null, discountInr: 1000, maxDiscountInr: null }, 600)).toEqual({ discount: 600, finalAmountInr: 0 });
  });
  it('100 percent makes it free', () => {
    expect(couponAmounts({ discountPct: 100, discountInr: null, maxDiscountInr: null }, 299).finalAmountInr).toBe(0);
  });
  it('never leaves less than Rs 1 to charge', () => {
    const r = couponAmounts({ discountPct: null, discountInr: 299.5, maxDiscountInr: null }, 300);
    expect(r.finalAmountInr).toBe(1);
    expect(r.discount).toBe(299);
  });
});

describe('couponProblem', () => {
  const ctx = { now: NOW, amountInr: 500, planId: 'p1', offerActive: false, usedByUser: 0 };
  it('accepts a normal coupon', () => {
    expect(couponProblem(coupon(), ctx)).toBeNull();
  });
  it('rejects inactive / not started / expired / exhausted', () => {
    expect(couponProblem(coupon({ isActive: false }), ctx)).toContain('not active');
    expect(couponProblem(coupon({ startsAt: day(1) }), ctx)).toContain('starts on');
    expect(couponProblem(coupon({ expiresAt: day(-1) }), ctx)).toContain('expired');
    expect(couponProblem(coupon({ maxUses: 5, usesCount: 5 }), ctx)).toContain('usage limit');
  });
  it('maxUses 0 means unlimited', () => {
    expect(couponProblem(coupon({ maxUses: 0, usesCount: 999 }), ctx)).toBeNull();
  });
  it('plan restriction', () => {
    expect(couponProblem(coupon({ planIds: ['p2'] }), ctx)).toContain('not valid on the selected plan');
    expect(couponProblem(coupon({ planIds: ['p1'] }), ctx)).toBeNull();
    expect(couponProblem(coupon({ planIds: ['p1'] }), { ...ctx, planId: null })).toContain('choose a plan');
  });
  it('minimum order', () => {
    expect(couponProblem(coupon({ minOrderInr: 600 }), ctx)).toContain('at least');
  });
  it('offer stacking', () => {
    expect(couponProblem(coupon({ stackWithOffer: false }), { ...ctx, offerActive: true })).toContain('running offer');
    expect(couponProblem(coupon({ stackWithOffer: false }), ctx)).toBeNull();
  });
  it('per student limit', () => {
    expect(couponProblem(coupon(), { ...ctx, usedByUser: 1 })).toContain('already used');
    expect(couponProblem(coupon({ perUserLimit: 3 }), { ...ctx, usedByUser: 2 })).toBeNull();
    expect(couponProblem(coupon({ perUserLimit: 0 }), { ...ctx, usedByUser: 50 })).toBeNull();
  });
});

describe('couponStatus', () => {
  it('derives a single status', () => {
    expect(couponStatus(coupon(), NOW)).toBe('ACTIVE');
    expect(couponStatus(coupon({ isActive: false }), NOW)).toBe('INACTIVE');
    expect(couponStatus(coupon({ startsAt: day(1) }), NOW)).toBe('SCHEDULED');
    expect(couponStatus(coupon({ expiresAt: day(-1) }), NOW)).toBe('EXPIRED');
    expect(couponStatus(coupon({ maxUses: 1, usesCount: 1 }), NOW)).toBe('EXHAUSTED');
  });
});

describe('checkPlanInput', () => {
  it('accepts a full plan', () => {
    const r = checkPlanInput({ name: ' Pro ', durationMonths: 6, priceInr: 499, offerPct: 20, offerEndsAt: '2099-01-01' }, false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.name).toBe('Pro');
  });
  it('rejects bad values', () => {
    expect(checkPlanInput({ name: 'x', durationMonths: 0, priceInr: 5 }, false).ok).toBe(false);
    expect(checkPlanInput({ name: 'x', durationMonths: 1, priceInr: 0 }, false).ok).toBe(false);
    expect(checkPlanInput({ name: 'x', durationMonths: 1, priceInr: 10, offerPct: 95 }, false).ok).toBe(false);
    expect(checkPlanInput({ name: 'x', durationMonths: 1, priceInr: 10, mrpInr: 5 }, false).ok).toBe(false);
    expect(checkPlanInput({ name: 'x', durationMonths: 1, priceInr: 10, offerStartsAt: '2099-02-01', offerEndsAt: '2099-01-01' }, false).ok).toBe(false);
  });
  it('PATCH checks MRP against the stored price and drops unknown fields', () => {
    expect(checkPlanInput({ mrpInr: 100 }, true, { priceInr: 200 }).ok).toBe(false);
    const r = checkPlanInput({ isActive: false, id: 'hack', createdAt: 'x' }, true, { priceInr: 200 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ isActive: false });
  });
  it('empty offer % switches the offer off', () => {
    const r = checkPlanInput({ offerPct: null }, true, { priceInr: 200 });
    expect(r.ok && r.data.offerPct === null).toBe(true);
  });
});

describe('checkCouponInput', () => {
  it('creates an upper-cased code', () => {
    const r = checkCouponInput({ code: ' diwali-50 ', discountPct: 50, maxUses: 100 }, false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.code).toBe('DIWALI-50');
  });
  it('rejects bad codes, both discount kinds, none, and bad ranges', () => {
    expect(checkCouponInput({ code: 'a b', discountPct: 10 }, false).ok).toBe(false);
    expect(checkCouponInput({ code: 'ABC', discountPct: 10, discountInr: 5 }, false).ok).toBe(false);
    expect(checkCouponInput({ code: 'ABC' }, false).ok).toBe(false);
    expect(checkCouponInput({ code: 'ABC', discountPct: 101 }, false).ok).toBe(false);
    expect(checkCouponInput({ code: 'ABC', discountPct: 10, startsAt: '2099-02-01', expiresAt: '2099-01-01' }, false).ok).toBe(false);
  });
  it('PATCH never changes the code and can switch discount kind', () => {
    const r = checkCouponInput({ code: 'NEW', discountInr: 50 }, true, { discountPct: 20, discountInr: null });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.code).toBeUndefined();
      expect(r.data.discountPct).toBeNull();
      expect(r.data.discountInr).toBe(50);
    }
  });
  it('plan list is de-duplicated', () => {
    const r = checkCouponInput({ code: 'ABC', discountPct: 10, planIds: ['a', 'a', ' b '] }, false);
    expect(r.ok && r.data.planIds?.join(',') === 'a,b').toBe(true);
  });
});
