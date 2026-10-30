import { ANON_LIMIT_PER_MIN, USER_LIMIT_PER_MIN, throttleLimit, throttleTracker, userLimitFromEnv } from './throttle-key';

describe('rate limit key (S47)', () => {
  it('two students on the same IP are counted separately', () => {
    const a = throttleTracker({ ip: '10.0.0.1', user: { userId: 'u1' } });
    const b = throttleTracker({ ip: '10.0.0.1', user: { userId: 'u2' } });
    expect(a).not.toBe(b);
  });
  it('the same student is one key whatever the IP', () => {
    expect(throttleTracker({ ip: '1.1.1.1', user: { userId: 'u1' } })).toBe(throttleTracker({ ip: '2.2.2.2', user: { userId: 'u1' } }));
  });
  it('an anonymous caller is counted by IP and gets the strict limit', () => {
    expect(throttleTracker({ ip: '9.9.9.9' })).toBe('9.9.9.9');
    expect(throttleLimit({ ip: '9.9.9.9' })).toBe(ANON_LIMIT_PER_MIN);
  });
  it('a request with a fake user object but no id is anonymous (nothing a header can fake)', () => {
    expect(throttleTracker({ ip: '9.9.9.9', user: {} })).toBe('9.9.9.9');
    expect(throttleLimit({ user: { userId: '' } })).toBe(ANON_LIMIT_PER_MIN);
  });
  it('a logged-in student gets the larger budget, which a 100-question submit fits in', () => {
    expect(throttleLimit({ user: { userId: 'u1' } })).toBe(USER_LIMIT_PER_MIN);
    expect(USER_LIMIT_PER_MIN).toBeGreaterThan(100 * 2);
  });
  it('THROTTLE_USER_LIMIT: valid value used, junk / too small / too big falls back', () => {
    expect(userLimitFromEnv({})).toBe(USER_LIMIT_PER_MIN);
    expect(userLimitFromEnv({ THROTTLE_USER_LIMIT: '500' })).toBe(500);
    expect(userLimitFromEnv({ THROTTLE_USER_LIMIT: '10' })).toBe(USER_LIMIT_PER_MIN);
    expect(userLimitFromEnv({ THROTTLE_USER_LIMIT: '999999' })).toBe(USER_LIMIT_PER_MIN);
    expect(userLimitFromEnv({ THROTTLE_USER_LIMIT: 'abc' })).toBe(USER_LIMIT_PER_MIN);
  });
});
