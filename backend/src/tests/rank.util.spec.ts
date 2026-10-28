import { RawAttempt, firstAttemptPerUser, isAhead, isRetake, placeAmong, shortName, sortRows, standingOf, withRanks } from './rank.util';

const t0 = Date.parse('2026-10-01T10:00:00Z');
const at = (min: number) => new Date(t0 + min * 60_000);
let n = 0;
function att(userId: string, score: number, startMin: number, durSec: number, state: string | null = null, name = userId): RawAttempt {
  n += 1;
  return { attemptId: `a${n}`, userId, name, state, score, accuracy: 50, startedAt: at(startMin), submittedAt: new Date(at(startMin).getTime() + durSec * 1000) };
}

describe('rank maths', () => {
  it('one row per student: the FIRST attempt counts, a better retake does not', () => {
    const rows = firstAttemptPerUser([att('ravi', 40, 0, 3000), att('ravi', 90, 100, 2000), att('sita', 60, 5, 3000)]);
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.userId === 'ravi')!.score).toBe(40);
  });

  it('higher score first; on equal score the faster finisher is ahead; equal both = tie', () => {
    expect(isAhead({ score: 50, durationSec: 100 }, { score: 40, durationSec: 10 })).toBe(true);
    expect(isAhead({ score: 50, durationSec: 100 }, { score: 50, durationSec: 200 })).toBe(true);
    expect(isAhead({ score: 50, durationSec: 100 }, { score: 50, durationSec: 100 })).toBe(false);
    // a missing duration must not beat a real one
    expect(isAhead({ score: 50, durationSec: 0 }, { score: 50, durationSec: 90 })).toBe(false);
  });

  it('standing: rank, out-of and percentile', () => {
    const rows = sortRows(firstAttemptPerUser([att('a', 90, 0, 100), att('b', 80, 1, 100), att('c', 70, 2, 100), att('d', 60, 3, 100)]));
    const c = standingOf(rows, 'c')!;
    expect(c.rank).toBe(3);
    expect(c.outOf).toBe(4);
    expect(c.percentile).toBe(50); // 2 of 4 are not ahead of c (c and d)
    expect(standingOf(rows, 'a')!.percentile).toBe(100);
    expect(standingOf(rows, 'nobody')).toBeNull();
  });

  it('a lone student is rank 1 of 1 at the 100th percentile', () => {
    expect(placeAmong([], { score: 10, durationSec: 5 })).toEqual({ rank: 1, outOf: 1, percentile: 100 });
  });

  it('ties share a rank and the next rank skips (1,2,2,4)', () => {
    const rows = sortRows(firstAttemptPerUser([att('a', 90, 0, 100), att('b', 80, 1, 100), att('c', 80, 2, 100), att('d', 70, 3, 100)]));
    expect(withRanks(rows).map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it('state rank uses the same rule inside one state', () => {
    const rows = firstAttemptPerUser([att('a', 90, 0, 100, 'Bihar'), att('b', 80, 1, 100, 'Bihar'), att('c', 85, 2, 100, 'Delhi'), att('d', 60, 3, 100, 'Bihar')]);
    const bihar = rows.filter((r) => r.state === 'Bihar');
    expect(standingOf(bihar, 'b')!.rank).toBe(2);
    expect(standingOf(bihar, 'b')!.outOf).toBe(3);
    // all-India rank of b is 3 (a and c are ahead)
    expect(standingOf(rows, 'b')!.rank).toBe(3);
  });

  it('knows a retake from a first attempt', () => {
    const raw = [att('ravi', 40, 0, 3000), att('ravi', 90, 100, 2000)];
    const rows = firstAttemptPerUser(raw);
    expect(isRetake(rows, 'ravi', raw[0].attemptId)).toBe(false);
    expect(isRetake(rows, 'ravi', raw[1].attemptId)).toBe(true);
  });

  it('short names for other students', () => {
    expect(shortName('Rahul Kumar Sharma')).toBe('Rahul S.');
    expect(shortName('Priya')).toBe('Priya');
    expect(shortName('')).toBe('Student');
  });
});
