import { ATTEMPT_DONE, ATTEMPT_DONE_STATUSES, isAttemptDone } from '../common/attempt-status';
import { SWEEP_GRACE_MS, sweepGraceMs } from './attempt-sweeper.service';

// Pure rules of the abandoned-attempt sweeper (session 29). The behaviour against a database is in scripts/audit/results-sim.cjs.

describe('sweeper grace', () => {
  it('is 6 h 10 min by default: longer than the 6 h an offline student may still replay a submit', () => {
    expect(SWEEP_GRACE_MS).toBe(6 * 60 * 60_000 + 10 * 60_000);
    expect(sweepGraceMs({})).toBe(SWEEP_GRACE_MS);
  });
  it('can be made longer with ATTEMPT_SWEEP_GRACE_MIN, never shorter', () => {
    expect(sweepGraceMs({ ATTEMPT_SWEEP_GRACE_MIN: '720' })).toBe(720 * 60_000);
    expect(sweepGraceMs({ ATTEMPT_SWEEP_GRACE_MIN: '60' })).toBe(SWEEP_GRACE_MS);
    expect(sweepGraceMs({ ATTEMPT_SWEEP_GRACE_MIN: '0' })).toBe(SWEEP_GRACE_MS);
    expect(sweepGraceMs({ ATTEMPT_SWEEP_GRACE_MIN: 'abc' })).toBe(SWEEP_GRACE_MS);
    expect(sweepGraceMs({ ATTEMPT_SWEEP_GRACE_MIN: '-5' })).toBe(SWEEP_GRACE_MS);
  });
});

describe('finished attempt statuses', () => {
  it('SUBMITTED and AUTO_SUBMITTED are finished; running and expired attempts are not', () => {
    expect(isAttemptDone('SUBMITTED')).toBe(true);
    expect(isAttemptDone('AUTO_SUBMITTED')).toBe(true);
    expect(isAttemptDone('IN_PROGRESS')).toBe(false);
    expect(isAttemptDone('EXPIRED')).toBe(false);
    expect(isAttemptDone(undefined)).toBe(false);
    expect(isAttemptDone(null)).toBe(false);
  });
  it('the Prisma fragment lists exactly the finished statuses', () => {
    expect([...ATTEMPT_DONE.in]).toEqual([...ATTEMPT_DONE_STATUSES]);
    expect(ATTEMPT_DONE_STATUSES).toHaveLength(2);
  });
});
