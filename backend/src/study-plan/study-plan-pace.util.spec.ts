import { DAILY_TARGET_MAX, DAILY_TARGET_MIN, activeStreak, bucketAnswered, clampDailyTarget, istDayStart, istKey, lastDayKeys, paceOf } from './study-plan-pace.util';

describe('IST day keys', () => {
  it('a UTC time after 18:30 belongs to the NEXT IST day', () => {
    expect(istKey(new Date('2026-10-27T18:29:59Z'))).toBe('2026-10-27');
    expect(istKey(new Date('2026-10-27T18:30:00Z'))).toBe('2026-10-28');
    expect(istKey(new Date('2026-10-28T00:10:00+05:30'))).toBe('2026-10-28');
  });

  it('istDayStart is 00:00 IST of that day (18:30 UTC the day before)', () => {
    expect(istDayStart('2026-10-28').toISOString()).toBe('2026-10-27T18:30:00.000Z');
    expect(istKey(istDayStart('2026-10-28'))).toBe('2026-10-28');
  });

  it('lastDayKeys: oldest first, today last, crosses month and year ends', () => {
    expect(lastDayKeys('2026-10-28', 3)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28']);
    expect(lastDayKeys('2027-01-02', 4)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(lastDayKeys('2028-03-01', 2)).toEqual(['2028-02-29', '2028-03-01']);
    expect(lastDayKeys('2026-10-28', 1)).toEqual(['2026-10-28']);
  });
});

describe('questions answered per day', () => {
  it('sums attempts of the same IST day, ignores empty attempts', () => {
    const m = bucketAnswered([
      { startedAt: new Date('2026-10-28T03:00:00+05:30'), answered: 20 },
      { startedAt: new Date('2026-10-28T23:30:00+05:30'), answered: 5 },
      { startedAt: new Date('2026-10-27T10:00:00+05:30'), answered: 0 },
      { startedAt: new Date('2026-10-27T10:00:00+05:30'), answered: 7 },
    ]);
    expect(m.get('2026-10-28')).toBe(25);
    expect(m.get('2026-10-27')).toBe(7);
    expect(m.size).toBe(2);
  });
});

describe('active streak', () => {
  const m = (o: Record<string, number>) => new Map(Object.entries(o));
  it('counts days in a row back from today', () => {
    expect(activeStreak(m({ '2026-10-28': 4, '2026-10-27': 9, '2026-10-26': 1 }), '2026-10-28', 30)).toBe(3);
  });
  it('today still empty: the streak is alive and counts from yesterday', () => {
    expect(activeStreak(m({ '2026-10-27': 9, '2026-10-26': 1 }), '2026-10-28', 30)).toBe(2);
  });
  it('a missed day breaks it', () => {
    expect(activeStreak(m({ '2026-10-28': 4, '2026-10-26': 9 }), '2026-10-28', 30)).toBe(1);
    expect(activeStreak(m({ '2026-10-26': 9 }), '2026-10-28', 30)).toBe(0);
  });
  it('is capped by the window', () => {
    const o: Record<string, number> = {};
    for (const k of lastDayKeys('2026-10-28', 40)) o[k] = 1;
    expect(activeStreak(m(o), '2026-10-28', 30)).toBe(30);
  });
  it('nothing at all', () => {
    expect(activeStreak(new Map(), '2026-10-28', 30)).toBe(0);
  });
});

describe('daily target', () => {
  it('stays inside 25..100 in steps of 5', () => {
    expect(clampDailyTarget(0)).toBe(DAILY_TARGET_MIN);
    expect(clampDailyTarget(NaN)).toBe(DAILY_TARGET_MIN);
    expect(clampDailyTarget(23)).toBe(25);
    expect(clampDailyTarget(47)).toBe(45);
    expect(clampDailyTarget(48)).toBe(50);
    expect(clampDailyTarget(200)).toBe(DAILY_TARGET_MAX);
    expect(clampDailyTarget(100)).toBe(100);
  });
});

describe('pace estimate', () => {
  const base = { totalChapters: 100, completeChapters: 0, selfMarkedChapters: 0, startKey: '2026-10-01', targetKey: '2027-01-09' };
  // 100 days runway -> reserve round(100*0.2)=20 -> 80 study days
  it('day 0 of the plan is JUST_STARTED, never behind', () => {
    const p = paceOf({ ...base, todayKey: '2026-10-01' });
    expect(p.status).toBe('JUST_STARTED');
    expect(p.expectedChapters).toBe(0);
    expect(p.totalDays).toBe(100);
  });
  it('expected chapters grow evenly over the study days (40 of 80 days = half)', () => {
    const p = paceOf({ ...base, todayKey: '2026-11-10', completeChapters: 50 });
    expect(p.elapsedDays).toBe(40);
    expect(p.expectedChapters).toBe(50);
    expect(p.status).toBe('ON_TRACK');
  });
  it('2+ chapters ahead = AHEAD, 2+ behind = BEHIND, 1 either way = ON_TRACK', () => {
    expect(paceOf({ ...base, todayKey: '2026-11-10', completeChapters: 40, selfMarkedChapters: 12 }).status).toBe('AHEAD');
    expect(paceOf({ ...base, todayKey: '2026-11-10', completeChapters: 47 }).status).toBe('BEHIND');
    expect(paceOf({ ...base, todayKey: '2026-11-10', completeChapters: 49 }).status).toBe('ON_TRACK');
    expect(paceOf({ ...base, todayKey: '2026-11-10', completeChapters: 51 }).status).toBe('ON_TRACK');
  });
  it('marked-but-untested chapters count as covered, weak / pending ones do not', () => {
    const p = paceOf({ ...base, todayKey: '2026-11-10', completeChapters: 30, selfMarkedChapters: 20 });
    expect(p.coveredChapters).toBe(50);
    expect(p.delta).toBe(0);
  });
  it('after the study days everything is expected (revision reserve starts)', () => {
    const p = paceOf({ ...base, todayKey: '2026-12-25', completeChapters: 100 });
    expect(p.expectedChapters).toBe(100);
    expect(p.status).toBe('ON_TRACK');
  });
  it('a short plan (10 days or less) has no reserve', () => {
    const p = paceOf({ totalChapters: 10, completeChapters: 0, selfMarkedChapters: 0, startKey: '2026-10-01', targetKey: '2026-10-09', todayKey: '2026-10-05' });
    expect(p.totalDays).toBe(8);
    expect(p.expectedChapters).toBe(5);
    expect(p.status).toBe('BEHIND');
  });
  it('no chapters with questions = NO_DATA; a date after the target is capped, not negative', () => {
    expect(paceOf({ ...base, totalChapters: 0, todayKey: '2026-10-10' }).status).toBe('NO_DATA');
    const late = paceOf({ ...base, todayKey: '2027-03-01', completeChapters: 100 });
    expect(late.elapsedDays).toBe(100);
    expect(late.expectedChapters).toBe(100);
  });
});
