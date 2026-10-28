// Refer & Earn rules. Pure helpers (no Nest / Prisma imports) so the rules can be unit-tested on their own.

export interface ReferralConfig {
  /** Master switch. Off = no new welcome discounts and no new commission; money already earned stays withdrawable. */
  enabled: boolean;
  /** Welcome discount a referred student gets on their FIRST plan purchase (percent of the selling price). */
  refereeDiscountPct: number;
  /** Cap for that discount in rupees. */
  refereeDiscountMaxInr: number;
  /** Commission % while the referrer has fewer than `highTierAfter` paying friends. */
  lowTierPct: number;
  /** Commission % from the `highTierAfter`-th paying friend onward. */
  highTierPct: number;
  highTierAfter: number;
  /** Days a commission stays "pending" after the friend pays (covers the refund window). 0 = instant. */
  holdDays: number;
  minWithdrawInr: number;
  minPaidReferralsToWithdraw: number;
  /** Paying friends needed for the free 30-day plan / the free 6-month upgrade. */
  freeMonthAt: number;
  freeUpgradeAt: number;
}

export const DEFAULT_REFERRAL_CONFIG: ReferralConfig = {
  enabled: true,
  refereeDiscountPct: 10,
  refereeDiscountMaxInr: 150,
  lowTierPct: 20,
  highTierPct: 30,
  highTierAfter: 10,
  holdDays: 7,
  minWithdrawInr: 100,
  minPaidReferralsToWithdraw: 3,
  freeMonthAt: 10,
  freeUpgradeAt: 20,
};

export const REFERRAL_CONFIG_KEY = 'referral.config';

type Rule = { min: number; max: number; int?: boolean; label: string };
const RULES: Record<Exclude<keyof ReferralConfig, 'enabled'>, Rule> = {
  refereeDiscountPct: { min: 0, max: 50, label: 'Friend discount %' },
  refereeDiscountMaxInr: { min: 0, max: 5000, label: 'Friend discount cap' },
  lowTierPct: { min: 0, max: 50, label: 'Commission % (starting)' },
  highTierPct: { min: 0, max: 60, label: 'Commission % (top tier)' },
  highTierAfter: { min: 1, max: 200, int: true, label: 'Top tier starts at' },
  holdDays: { min: 0, max: 60, int: true, label: 'Hold days' },
  minWithdrawInr: { min: 1, max: 100000, label: 'Minimum withdrawal' },
  minPaidReferralsToWithdraw: { min: 0, max: 100, int: true, label: 'Paid friends needed to withdraw' },
  freeMonthAt: { min: 1, max: 500, int: true, label: 'Free month at' },
  freeUpgradeAt: { min: 1, max: 500, int: true, label: 'Free upgrade at' },
};

/** Reads whatever was stored and returns a complete, in-range config (bad / missing values fall back to the default). */
export function mergeReferralConfig(stored: unknown): ReferralConfig {
  const out: ReferralConfig = { ...DEFAULT_REFERRAL_CONFIG };
  if (!stored || typeof stored !== 'object') return out;
  const src = stored as Record<string, unknown>;
  if (typeof src.enabled === 'boolean') out.enabled = src.enabled;
  for (const key of Object.keys(RULES) as (keyof typeof RULES)[]) {
    const v = Number(src[key]);
    const r = RULES[key];
    if (src[key] !== undefined && src[key] !== null && src[key] !== '' && Number.isFinite(v) && v >= r.min && v <= r.max) {
      (out as any)[key] = r.int ? Math.round(v) : Math.round(v * 100) / 100;
    }
  }
  if (out.highTierPct < out.lowTierPct) out.highTierPct = out.lowTierPct;
  if (out.freeUpgradeAt < out.freeMonthAt) out.freeUpgradeAt = out.freeMonthAt;
  return out;
}

/** Strict check for an admin edit: returns the clean config, or the first problem as a readable message. */
export function validateReferralConfigInput(input: unknown): { ok: true; config: ReferralConfig } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Send the settings as an object.' };
  const src = input as Record<string, unknown>;
  const out: ReferralConfig = { ...DEFAULT_REFERRAL_CONFIG };
  if (typeof src.enabled !== 'boolean') return { ok: false, error: 'Switch must be on or off.' };
  out.enabled = src.enabled;
  for (const key of Object.keys(RULES) as (keyof typeof RULES)[]) {
    const r = RULES[key];
    const raw = src[key];
    const v = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(v)) return { ok: false, error: `${r.label}: enter a number.` };
    if (v < r.min || v > r.max) return { ok: false, error: `${r.label}: must be between ${r.min} and ${r.max}.` };
    if (r.int && !Number.isInteger(v)) return { ok: false, error: `${r.label}: must be a whole number.` };
    (out as any)[key] = Math.round(v * 100) / 100;
  }
  if (out.highTierPct < out.lowTierPct) return { ok: false, error: 'Top-tier commission cannot be lower than the starting commission.' };
  if (out.freeUpgradeAt < out.freeMonthAt) return { ok: false, error: 'The free upgrade needs at least as many friends as the free month.' };
  return { ok: true, config: out };
}

/** Commission % that applies when the referrer already has `paidFriends` distinct paying friends. */
export function commissionPctFor(paidFriends: number, cfg: ReferralConfig): number {
  return paidFriends >= cfg.highTierAfter ? cfg.highTierPct : cfg.lowTierPct;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Welcome discount (₹) for a friend's first plan, given the plan's selling price. Never takes the price below ₹1. */
export function welcomeDiscountFor(priceInr: number, cfg: ReferralConfig): number {
  if (!cfg.enabled || !(priceInr > 0) || cfg.refereeDiscountPct <= 0 || cfg.refereeDiscountMaxInr <= 0) return 0;
  const raw = Math.min(round2((priceInr * cfg.refereeDiscountPct) / 100), cfg.refereeDiscountMaxInr);
  return Math.max(0, Math.min(raw, round2(priceInr - 1)));
}

/** When a commission earned at `now` is released. */
export function releaseAt(now: Date, holdDays: number): Date {
  return new Date(now.getTime() + holdDays * 86_400_000);
}

/** "Rahul Sharma" -> "Rahul S." — friends' names are shown masked on the referrer's page. */
export function maskName(fullName: string | null | undefined): string {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Student';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
