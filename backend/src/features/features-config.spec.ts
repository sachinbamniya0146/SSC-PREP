import { FLAG_DEFS, applyFeatureInput, defaultFlags, isSafeLink, mergeFeatureState, publicView } from './features-config';

describe('feature switches', () => {
  it('every declared flag has a default and the defaults come back for an empty store', () => {
    const s = mergeFeatureState(null);
    for (const d of FLAG_DEFS) expect(s.flags[d.key]).toBe(d.default);
    expect(s.announcement.enabled).toBe(false);
  });

  it('keeps stored values, drops unknown names, ignores non-boolean values', () => {
    const s = mergeFeatureState({ flags: { signup: false, nonsense: true, bookmarks: 'no' } });
    expect(s.flags.signup).toBe(false);
    expect(s.flags.bookmarks).toBe(true);
    expect((s.flags as Record<string, boolean>).nonsense).toBeUndefined();
  });

  it('applies only what was sent on top of the current state', () => {
    const cur = mergeFeatureState({ flags: { signup: false } });
    const r = applyFeatureInput(cur, { flags: { leaderboard: false } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.flags.signup).toBe(false); // untouched
      expect(r.state.flags.leaderboard).toBe(false); // changed
      expect(r.state.flags.bookmarks).toBe(true);
    }
  });

  it('rejects a typo in a flag name and a non-boolean value', () => {
    const cur = mergeFeatureState(null);
    expect(applyFeatureInput(cur, { flags: { sgnup: false } }).ok).toBe(false);
    expect(applyFeatureInput(cur, { flags: { signup: 'off' } }).ok).toBe(false);
    expect(applyFeatureInput(cur, null).ok).toBe(false);
  });

  it('announcement: needs text to be on, link must be safe, expiry must be a date', () => {
    const cur = mergeFeatureState(null);
    expect(applyFeatureInput(cur, { announcement: { enabled: true, text: '  ' } }).ok).toBe(false);
    expect(applyFeatureInput(cur, { announcement: { enabled: true, text: 'Maintenance', link: 'javascript:alert(1)' } }).ok).toBe(false);
    expect(applyFeatureInput(cur, { announcement: { text: 'x', expiresAt: 'not-a-date' } }).ok).toBe(false);
    const ok = applyFeatureInput(cur, { announcement: { enabled: true, text: 'Server upgrade tonight', level: 'warn', link: '/pricing', linkLabel: 'See plans' } });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.state.announcement.enabled).toBe(true);
      expect(ok.state.announcement.level).toBe('warn');
    }
  });

  it('link safety', () => {
    expect(isSafeLink('')).toBe(true);
    expect(isSafeLink('/pricing')).toBe(true);
    expect(isSafeLink('https://sscprephub.in/x')).toBe(true);
    expect(isSafeLink('//evil.com')).toBe(false);
    expect(isSafeLink('http://insecure.com')).toBe(false);
    expect(isSafeLink('javascript:alert(1)')).toBe(false);
  });

  it('public view hides an expired or disabled announcement', () => {
    const cur = mergeFeatureState({ announcement: { enabled: true, text: 'Hello', expiresAt: '2026-01-01T00:00:00.000Z' } });
    expect(cur.announcement.enabled).toBe(true);
    expect(publicView(cur, Date.parse('2025-12-31T00:00:00Z')).announcement.enabled).toBe(true);
    expect(publicView(cur, Date.parse('2026-01-02T00:00:00Z')).announcement.enabled).toBe(false);
    expect(Object.keys(defaultFlags()).length).toBe(FLAG_DEFS.length);
  });
});
