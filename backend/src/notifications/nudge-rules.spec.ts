import { decideNudges, NudgeFacts, DEFAULT_PREFS, daysBetween, cleanHour } from './nudge-rules';

const base = (o: Partial<NudgeFacts> = {}): NudgeFacts => ({
  now: new Date('2026-10-30T13:30:00Z'),
  istDay: '2026-10-30',
  istHour: 19,
  prefs: { ...DEFAULT_PREFS },
  openAttempt: null,
  weakCount: 0,
  weakExample: null,
  currentStreak: 0,
  lastPracticeDay: null,
  targetExamName: null,
  ...o,
});

describe('nudge rules', () => {
  it('says nothing to a brand-new student', () => {
    expect(decideNudges(base())).toEqual([]);
  });

  it('RESUME: a test left open for 15+ minutes with time left, any hour', () => {
    const f = base({ istHour: 3, openAttempt: { id: 'a1', startedAt: new Date('2026-10-30T13:00:00Z'), expiresAt: new Date('2026-10-30T14:30:00Z') } });
    const n = decideNudges(f);
    expect(n.length).toBe(1);
    expect(n[0].kind).toBe('RESUME');
    expect(n[0].url).toBe('/test?resume=a1');
    expect(n[0].dedupeKey).toBe('resume:a1');
  });

  it('RESUME: not for a test just started, nor one about to run out', () => {
    const justStarted = base({ openAttempt: { id: 'a', startedAt: new Date('2026-10-30T13:25:00Z'), expiresAt: new Date('2026-10-30T14:25:00Z') } });
    expect(decideNudges(justStarted)).toEqual([]);
    const ending = base({ openAttempt: { id: 'a', startedAt: new Date('2026-10-30T12:00:00Z'), expiresAt: new Date('2026-10-30T13:33:00Z') } });
    expect(decideNudges(ending)).toEqual([]);
  });

  it('STREAK: practised yesterday, not today, streak 2+, in the reminder hour only', () => {
    const f = base({ currentStreak: 5, lastPracticeDay: '2026-10-29' });
    const n = decideNudges(f);
    expect(n[0].kind).toBe('STREAK');
    expect(n[0].title).toContain('5');
    expect(decideNudges(base({ currentStreak: 5, lastPracticeDay: '2026-10-29', istHour: 11 }))).toEqual([]);
    expect(decideNudges(base({ currentStreak: 5, lastPracticeDay: '2026-10-30' }))).toEqual([]);
    expect(decideNudges(base({ currentStreak: 1, lastPracticeDay: '2026-10-29' }))).toEqual([]);
  });

  it('WEAK: every second day, not when the student already practised today', () => {
    // 2026-10-30 is an even day number? compute both days and require exactly one of two neighbours to fire
    const a = decideNudges(base({ weakCount: 3, weakExample: 'Percentage', istDay: '2026-10-30' })).some((x) => x.kind === 'WEAK');
    const b = decideNudges(base({ weakCount: 3, weakExample: 'Percentage', istDay: '2026-10-31' })).some((x) => x.kind === 'WEAK');
    expect(a !== b).toBe(true);
    const day = a ? '2026-10-30' : '2026-10-31';
    expect(decideNudges(base({ weakCount: 3, istDay: day, lastPracticeDay: day })).some((x) => x.kind === 'WEAK')).toBe(false);
    expect(decideNudges(base({ weakCount: 0, istDay: day })).some((x) => x.kind === 'WEAK')).toBe(false);
  });

  it('COMEBACK: after 3, 6, 9 ... idle days, up to 30', () => {
    expect(decideNudges(base({ lastPracticeDay: '2026-10-27' })).some((x) => x.kind === 'COMEBACK')).toBe(true);
    expect(decideNudges(base({ lastPracticeDay: '2026-10-28' })).some((x) => x.kind === 'COMEBACK')).toBe(false);
    expect(decideNudges(base({ lastPracticeDay: '2026-08-01' })).some((x) => x.kind === 'COMEBACK')).toBe(false);
  });

  it('only ONE phone push per run, the most important keeps it', () => {
    const f = base({
      currentStreak: 4,
      lastPracticeDay: '2026-10-29',
      weakCount: 2,
      istDay: '2026-10-30',
      openAttempt: { id: 'a1', startedAt: new Date('2026-10-30T12:00:00Z'), expiresAt: new Date('2026-10-30T15:00:00Z') },
    });
    const n = decideNudges(f);
    expect(n.length).toBeGreaterThanOrEqual(2);
    expect(n.filter((x) => x.push).length).toBe(1);
    expect(n[0].kind).toBe('RESUME');
    expect(n[0].push).toBe(true);
  });

  it('respects switches and pause', () => {
    const f = base({ currentStreak: 5, lastPracticeDay: '2026-10-29', prefs: { ...DEFAULT_PREFS, streak: false } });
    expect(decideNudges(f)).toEqual([]);
    const paused = base({ currentStreak: 5, lastPracticeDay: '2026-10-29', prefs: { ...DEFAULT_PREFS, pausedUntil: new Date('2026-11-02T00:00:00Z') } });
    expect(decideNudges(paused)).toEqual([]);
  });

  it('helpers', () => {
    expect(daysBetween('2026-10-27', '2026-10-30')).toBe(3);
    expect(cleanHour(7)).toBe(7);
    expect(cleanHour(24)).toBe(19);
    expect(cleanHour('x')).toBe(19);
  });
});
