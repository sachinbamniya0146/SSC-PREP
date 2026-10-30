import { REBALANCE_TEST_RESERVE_SQL, reserveNeeded } from './test-reserve.sql';

describe('test reserve rule (S48)', () => {
  it('half of a topic is kept for tests, rounded DOWN so students keep at least half', () => {
    expect(reserveNeeded(0, 0)).toBe(0);
    expect(reserveNeeded(1, 0)).toBe(0);
    expect(reserveNeeded(2, 0)).toBe(1);
    expect(reserveNeeded(3, 0)).toBe(1);
    expect(reserveNeeded(100, 0)).toBe(50);
    expect(reserveNeeded(101, 0)).toBe(50);
  });
  it('only adds: already-reserved rows are counted, never taken back', () => {
    expect(reserveNeeded(100, 50)).toBe(0);
    expect(reserveNeeded(100, 70)).toBe(0); // admin / earlier run reserved more: left alone
    expect(reserveNeeded(100, 20)).toBe(30);
    expect(reserveNeeded(120, 50)).toBe(10); // 20 new uploads -> 10 more reserved
  });
  it('the SQL only touches live practice rows and only sets the flag to true', () => {
    expect(REBALANCE_TEST_RESERVE_SQL).toContain('"year" IS NULL');
    expect(REBALANCE_TEST_RESERVE_SQL).toContain('"isApproved" = true');
    expect(REBALANCE_TEST_RESERVE_SQL).toContain('SET "testReserved" = true');
    expect(REBALANCE_TEST_RESERVE_SQL).not.toContain('"testReserved" = false WHERE');
    expect(REBALANCE_TEST_RESERVE_SQL).toContain('(c.n / 2) > c.r');
  });
});
