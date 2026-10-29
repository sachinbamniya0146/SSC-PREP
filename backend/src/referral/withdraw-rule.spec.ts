import { DEFAULT_REFERRAL_CONFIG, effectiveMinFriends, parseWithdrawOverride } from './referral-config';

describe('per-student withdrawal rule (admin override)', () => {
  const cfg = { ...DEFAULT_REFERRAL_CONFIG, minPaidReferralsToWithdraw: 3 };
  it('no override -> follows the programme rule', () => {
    expect(effectiveMinFriends(null, cfg)).toBe(3);
    expect(effectiveMinFriends(undefined, cfg)).toBe(3);
  });
  it('override wins, including 0 (nobody needed) and a value ABOVE the rule', () => {
    expect(effectiveMinFriends(0, cfg)).toBe(0);
    expect(effectiveMinFriends(1, cfg)).toBe(1);
    expect(effectiveMinFriends(2, cfg)).toBe(2);
    expect(effectiveMinFriends(5, cfg)).toBe(5);
  });
  it('junk stored value falls back to the programme rule', () => {
    expect(effectiveMinFriends(-1, cfg)).toBe(3);
    expect(effectiveMinFriends(Number.NaN, cfg)).toBe(3);
  });
  it('admin input: blank/null clears, 0..100 whole numbers are accepted, the rest is refused', () => {
    expect(parseWithdrawOverride(null)).toEqual({ ok: true, value: null });
    expect(parseWithdrawOverride('')).toEqual({ ok: true, value: null });
    expect(parseWithdrawOverride(undefined)).toEqual({ ok: true, value: null });
    expect(parseWithdrawOverride(0)).toEqual({ ok: true, value: 0 });
    expect(parseWithdrawOverride('1')).toEqual({ ok: true, value: 1 });
    expect(parseWithdrawOverride(100)).toEqual({ ok: true, value: 100 });
    expect(parseWithdrawOverride(-1).ok).toBe(false);
    expect(parseWithdrawOverride(101).ok).toBe(false);
    expect(parseWithdrawOverride(1.5).ok).toBe(false);
    expect(parseWithdrawOverride('abc').ok).toBe(false);
  });
});
