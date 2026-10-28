// Pure pricing helpers (no DB, no Nest) — shared by the student checkout, the
// order creation and the admin pricing screen, so "what the student sees" and
// "what is charged" always come from ONE place.
//
// Money rules
//  - Plan.priceInr is the REGULAR selling price. A time-boxed offer (offerPct,
//    offerStartsAt/offerEndsAt) reduces it; Plan.mrpInr is display-only
//    ("was ₹X", never charged).
//  - A coupon is applied on top of the already-offer-reduced price.
//  - The charged amount is either 0 (free activation) or >= ₹1 — Cashfree
//    rejects orders below ₹1, so a coupon may never leave a few paise.

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const MIN_CHARGE_INR = 1;
export const MAX_OFFER_PCT = 90;

export type PlanPricingInput = {
  priceInr: number;
  durationMonths: number;
  mrpInr?: number | null;
  offerPct?: number | null;
  offerLabel?: string | null;
  offerStartsAt?: Date | null;
  offerEndsAt?: Date | null;
};

export type PlanPricing = {
  /** Regular price from the plan row. */
  regularInr: number;
  /** What the student pays for the plan before any coupon. */
  salePriceInr: number;
  /** Price to show struck-through (higher of MRP / regular) or null when there is nothing to strike. */
  strikeInr: number | null;
  offerActive: boolean;
  offerPct: number | null;
  offerLabel: string | null;
  offerEndsAt: string | null;
  /** regular - sale (the offer's share of the discount; 0 without an active offer). */
  offerDiscountInr: number;
  /** strike - sale, for the "You save" badge. */
  savingsInr: number;
  savingsPct: number;
  perMonthInr: number;
};

export function isOfferActive(p: PlanPricingInput, now: Date = new Date()): boolean {
  const pct = Number(p.offerPct ?? 0);
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return false;
  if (p.offerStartsAt && p.offerStartsAt.getTime() > now.getTime()) return false;
  if (p.offerEndsAt && p.offerEndsAt.getTime() <= now.getTime()) return false;
  return true;
}

export function planPricing(p: PlanPricingInput, now: Date = new Date()): PlanPricing {
  const regularInr = round2(Number(p.priceInr) || 0);
  const offerActive = isOfferActive(p, now);
  const pct = offerActive ? Number(p.offerPct) : 0;
  let salePriceInr = offerActive ? round2((regularInr * (100 - pct)) / 100) : regularInr;
  if (regularInr > 0 && salePriceInr < MIN_CHARGE_INR) salePriceInr = Math.min(regularInr, MIN_CHARGE_INR);
  const mrp = p.mrpInr && p.mrpInr > regularInr ? round2(p.mrpInr) : 0;
  const strikeCandidate = Math.max(regularInr, mrp);
  const strikeInr = strikeCandidate > salePriceInr ? strikeCandidate : null;
  const savingsInr = strikeInr ? round2(strikeInr - salePriceInr) : 0;
  const savingsPct = strikeInr ? Math.round((savingsInr / strikeInr) * 100) : 0;
  return {
    regularInr,
    salePriceInr,
    strikeInr,
    offerActive,
    offerPct: offerActive ? pct : null,
    offerLabel: offerActive ? (p.offerLabel?.trim() || null) : null,
    offerEndsAt: offerActive && p.offerEndsAt ? p.offerEndsAt.toISOString() : null,
    offerDiscountInr: round2(regularInr - salePriceInr),
    savingsInr,
    savingsPct,
    perMonthInr: round2(salePriceInr / Math.max(1, Number(p.durationMonths) || 1)),
  };
}

// ---------------------------------------------------------------- coupons

export type CouponRules = {
  code: string;
  isActive: boolean;
  discountPct?: number | null;
  discountInr?: number | null;
  maxDiscountInr?: number | null;
  minOrderInr?: number | null;
  maxUses: number; // 0 or less = unlimited
  usesCount: number;
  perUserLimit: number; // 0 or less = unlimited
  startsAt?: Date | null;
  expiresAt?: Date | null;
  planIds?: string[] | null; // empty / null = every plan
  stackWithOffer: boolean;
};

export type CouponContext = {
  now: Date;
  amountInr: number; // price the coupon would be applied on
  planId?: string | null;
  offerActive?: boolean;
  usedByUser?: number; // successful redemptions by this user so far
};

const istDay = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** Returns the reason a coupon cannot be used right now, or null when it can. */
export function couponProblem(c: CouponRules, ctx: CouponContext): string | null {
  if (!c.isActive) return 'This coupon is not active.';
  if (c.startsAt && c.startsAt.getTime() > ctx.now.getTime()) return `This coupon starts on ${istDay(c.startsAt)}.`;
  if (c.expiresAt && c.expiresAt.getTime() <= ctx.now.getTime()) return 'This coupon has expired.';
  if (c.maxUses > 0 && c.usesCount >= c.maxUses) return 'This coupon has reached its usage limit.';
  if (c.planIds && c.planIds.length > 0) {
    if (!ctx.planId) return 'This coupon is valid only on selected plans — choose a plan first.';
    if (!c.planIds.includes(ctx.planId)) return 'This coupon is not valid on the selected plan.';
  }
  if (c.minOrderInr && ctx.amountInr < c.minOrderInr) return `This coupon needs an order of at least ₹${c.minOrderInr}.`;
  if (!c.stackWithOffer && ctx.offerActive) return 'This coupon cannot be combined with the running offer on this plan.';
  if (c.perUserLimit > 0 && (ctx.usedByUser ?? 0) >= c.perUserLimit) {
    return c.perUserLimit === 1 ? 'You have already used this coupon.' : `You have already used this coupon ${c.perUserLimit} times.`;
  }
  if (!(Number(c.discountPct) > 0) && !(Number(c.discountInr) > 0)) return 'This coupon has no discount configured.';
  return null;
}

/** Discount and final amount for `amountInr`. Final is either 0 or >= ₹1. */
export function couponAmounts(c: Pick<CouponRules, 'discountPct' | 'discountInr' | 'maxDiscountInr'>, amountInr: number) {
  const amount = round2(Math.max(0, amountInr));
  let discount = 0;
  if (Number(c.discountPct) > 0) {
    discount = round2((amount * Math.min(Number(c.discountPct), 100)) / 100);
    if (c.maxDiscountInr && c.maxDiscountInr > 0) discount = Math.min(discount, c.maxDiscountInr);
  } else if (Number(c.discountInr) > 0) {
    discount = Number(c.discountInr);
  }
  discount = Math.min(round2(discount), amount);
  let final = round2(amount - discount);
  if (final > 0 && final < MIN_CHARGE_INR) {
    final = Math.min(amount, MIN_CHARGE_INR);
    discount = round2(amount - final);
  }
  return { discount, finalAmountInr: final };
}

// ---------------------------------------------------------------- admin input validation

export type Checked<T> = { ok: true; data: T } | { ok: false; error: string };

const num = (v: unknown): number | undefined | null => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const str = (v: unknown, max: number): string | undefined | null => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const date = (v: unknown): Date | undefined | null => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? (new Date(NaN) as Date) : d;
};

export type PlanWrite = {
  name?: string;
  durationMonths?: number;
  priceInr?: number;
  mrpInr?: number | null;
  offerPct?: number | null;
  offerLabel?: string | null;
  offerStartsAt?: Date | null;
  offerEndsAt?: Date | null;
  badge?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

/** Whitelists and validates plan fields. `partial` = PATCH (missing fields stay as they are). */
export function checkPlanInput(b: Record<string, unknown>, partial: boolean, current?: Partial<PlanWrite>): Checked<PlanWrite> {
  const out: PlanWrite = {};
  const name = str(b.name, 80);
  if (name !== undefined) {
    if (!name) return { ok: false, error: 'Plan name is required.' };
    out.name = name;
  } else if (!partial) return { ok: false, error: 'Plan name is required.' };

  const dur = num(b.durationMonths);
  if (dur !== undefined) {
    if (dur === null || Number.isNaN(dur) || !Number.isInteger(dur) || dur < 1 || dur > 60) return { ok: false, error: 'Duration must be a whole number of months between 1 and 60.' };
    out.durationMonths = dur;
  } else if (!partial) return { ok: false, error: 'Duration (months) is required.' };

  const price = num(b.priceInr);
  if (price !== undefined) {
    if (price === null || Number.isNaN(price) || price < MIN_CHARGE_INR || price > 100000) return { ok: false, error: 'Price must be between ₹1 and ₹1,00,000.' };
    out.priceInr = round2(price);
  } else if (!partial) return { ok: false, error: 'Price is required.' };

  const mrp = num(b.mrpInr);
  if (mrp !== undefined) {
    if (mrp !== null && (Number.isNaN(mrp) || mrp <= 0 || mrp > 1000000)) return { ok: false, error: 'MRP must be a positive amount (or empty).' };
    out.mrpInr = mrp === null ? null : round2(mrp);
  }

  const pct = num(b.offerPct);
  if (pct !== undefined) {
    if (pct !== null && (Number.isNaN(pct) || pct < 0 || pct > MAX_OFFER_PCT)) return { ok: false, error: `Offer % must be between 1 and ${MAX_OFFER_PCT} (or empty to switch the offer off).` };
    out.offerPct = pct === null || pct === 0 ? null : pct;
  }
  const label = str(b.offerLabel, 60);
  if (label !== undefined) out.offerLabel = label;
  const badge = str(b.badge, 30);
  if (badge !== undefined) out.badge = badge;

  const from = date(b.offerStartsAt);
  const to = date(b.offerEndsAt);
  if (from !== undefined) {
    if (from !== null && Number.isNaN(from.getTime())) return { ok: false, error: 'Offer start date is not valid.' };
    out.offerStartsAt = from;
  }
  if (to !== undefined) {
    if (to !== null && Number.isNaN(to.getTime())) return { ok: false, error: 'Offer end date is not valid.' };
    out.offerEndsAt = to;
  }

  const so = num(b.sortOrder);
  if (so !== undefined) {
    if (so === null || Number.isNaN(so) || !Number.isInteger(so) || so < -1000 || so > 1000) return { ok: false, error: 'Sort order must be a whole number.' };
    out.sortOrder = so;
  }
  if (b.isActive !== undefined) out.isActive = Boolean(b.isActive);

  // cross-field rules use the merged view (PATCH may only send one side)
  const eff = { ...(current ?? {}), ...out };
  const price2 = eff.priceInr;
  if (eff.mrpInr && price2 && eff.mrpInr <= price2) return { ok: false, error: 'MRP must be higher than the price (it is only the struck-through "was" price).' };
  if (eff.offerStartsAt && eff.offerEndsAt && eff.offerEndsAt.getTime() <= eff.offerStartsAt.getTime()) return { ok: false, error: 'Offer end must be after the offer start.' };
  if (eff.offerPct && eff.offerEndsAt && eff.offerEndsAt.getTime() <= Date.now() && out.offerEndsAt !== undefined) return { ok: false, error: 'Offer end date is already in the past.' };
  return { ok: true, data: out };
}

export type CouponWrite = {
  code?: string;
  description?: string | null;
  discountPct?: number | null;
  discountInr?: number | null;
  maxDiscountInr?: number | null;
  minOrderInr?: number | null;
  maxUses?: number;
  perUserLimit?: number;
  startsAt?: Date | null;
  expiresAt?: Date | null;
  planIds?: string[];
  stackWithOffer?: boolean;
  isActive?: boolean;
};

export const COUPON_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;

/** Whitelists and validates coupon fields. The code can only be set on create. */
export function checkCouponInput(b: Record<string, unknown>, partial: boolean, current?: Partial<CouponWrite>): Checked<CouponWrite> {
  const out: CouponWrite = {};
  if (!partial) {
    const code = String(b.code ?? '').trim().toUpperCase();
    if (!COUPON_CODE_RE.test(code)) return { ok: false, error: 'Code must be 3–24 characters: letters, digits, "-" or "_" (no spaces).' };
    out.code = code;
  }
  const desc = str(b.description, 200);
  if (desc !== undefined) out.description = desc;

  const pct = num(b.discountPct);
  const inr = num(b.discountInr);
  if (pct !== undefined) {
    if (pct !== null && (Number.isNaN(pct) || pct <= 0 || pct > 100)) return { ok: false, error: 'Discount % must be between 1 and 100.' };
    out.discountPct = pct;
  }
  if (inr !== undefined) {
    if (inr !== null && (Number.isNaN(inr) || inr <= 0 || inr > 100000)) return { ok: false, error: 'Flat discount must be a positive amount.' };
    out.discountInr = inr === null ? null : round2(inr);
  }
  // exactly one kind of discount
  const effPct = out.discountPct !== undefined ? out.discountPct : (current?.discountPct ?? null);
  const effInr = out.discountInr !== undefined ? out.discountInr : (current?.discountInr ?? null);
  if (effPct && effInr) {
    // switching kind on PATCH: the side the admin just sent wins, the other one is cleared
    if (partial && out.discountPct && !out.discountInr) out.discountInr = null;
    else if (partial && out.discountInr && !out.discountPct) out.discountPct = null;
    else return { ok: false, error: 'Use either a % discount or a flat ₹ discount, not both.' };
  } else if (!partial && !effPct && !effInr) {
    return { ok: false, error: 'Set a % discount or a flat ₹ discount.' };
  }

  const cap = num(b.maxDiscountInr);
  if (cap !== undefined) {
    if (cap !== null && (Number.isNaN(cap) || cap <= 0)) return { ok: false, error: 'Max discount must be a positive amount (or empty).' };
    out.maxDiscountInr = cap === null ? null : round2(cap);
  }
  const min = num(b.minOrderInr);
  if (min !== undefined) {
    if (min !== null && (Number.isNaN(min) || min <= 0)) return { ok: false, error: 'Minimum order must be a positive amount (or empty).' };
    out.minOrderInr = min === null ? null : round2(min);
  }
  const mu = num(b.maxUses);
  if (mu !== undefined) {
    if (mu === null || Number.isNaN(mu) || !Number.isInteger(mu) || mu < 0 || mu > 10_000_000) return { ok: false, error: 'Total uses must be a whole number (0 = unlimited).' };
    out.maxUses = mu;
  }
  const pu = num(b.perUserLimit);
  if (pu !== undefined) {
    if (pu === null || Number.isNaN(pu) || !Number.isInteger(pu) || pu < 0 || pu > 1000) return { ok: false, error: 'Uses per student must be a whole number (0 = unlimited).' };
    out.perUserLimit = pu;
  }
  const from = date(b.startsAt);
  const to = date(b.expiresAt);
  if (from !== undefined) {
    if (from !== null && Number.isNaN(from.getTime())) return { ok: false, error: 'Start date is not valid.' };
    out.startsAt = from;
  }
  if (to !== undefined) {
    if (to !== null && Number.isNaN(to.getTime())) return { ok: false, error: 'Expiry date is not valid.' };
    out.expiresAt = to;
  }
  const effFrom = out.startsAt !== undefined ? out.startsAt : (current?.startsAt ?? null);
  const effTo = out.expiresAt !== undefined ? out.expiresAt : (current?.expiresAt ?? null);
  if (effFrom && effTo && effTo.getTime() <= effFrom.getTime()) return { ok: false, error: 'Expiry must be after the start date.' };

  if (b.planIds !== undefined) {
    if (!Array.isArray(b.planIds)) return { ok: false, error: 'Plans must be a list.' };
    const ids = Array.from(new Set(b.planIds.map((x) => String(x).trim()).filter(Boolean)));
    if (ids.length > 50) return { ok: false, error: 'Too many plans selected.' };
    out.planIds = ids;
  }
  if (b.stackWithOffer !== undefined) out.stackWithOffer = Boolean(b.stackWithOffer);
  if (b.isActive !== undefined) out.isActive = Boolean(b.isActive);
  return { ok: true, data: out };
}

export type CouponStatus = 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'EXHAUSTED' | 'INACTIVE';

export function couponStatus(c: Pick<CouponRules, 'isActive' | 'startsAt' | 'expiresAt' | 'maxUses' | 'usesCount'>, now: Date = new Date()): CouponStatus {
  if (!c.isActive) return 'INACTIVE';
  if (c.expiresAt && c.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  if (c.maxUses > 0 && c.usesCount >= c.maxUses) return 'EXHAUSTED';
  if (c.startsAt && c.startsAt.getTime() > now.getTime()) return 'SCHEDULED';
  return 'ACTIVE';
}
