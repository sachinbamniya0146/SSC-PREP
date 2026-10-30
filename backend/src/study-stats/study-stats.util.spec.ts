import { addDays, addMonths, cleanPeriod, fillSeries, groupBreakdown, istDay, monthStart, periodStart, seriesKeys, weekStart } from './study-stats.util';

describe('study stats helpers', () => {
  const now = new Date('2026-10-30T20:00:00Z'); // 31 Oct 01:30 IST (a Saturday)

  it('"today" is the IST day, not the UTC day', () => {
    expect(istDay(now)).toBe('2026-10-31');
    expect(periodStart('today', now)).toBe('2026-10-31 00:00:00');
  });

  it('week starts on Monday, month on the 1st, year on 1 Jan', () => {
    expect(weekStart('2026-10-31')).toBe('2026-10-26'); // Saturday -> Monday
    expect(weekStart('2026-10-26')).toBe('2026-10-26');
    expect(weekStart('2026-11-01')).toBe('2026-10-26'); // Sunday belongs to the week that began Monday
    expect(periodStart('week', now)).toBe('2026-10-26 00:00:00');
    expect(periodStart('month', now)).toBe('2026-10-01 00:00:00');
    expect(periodStart('year', now)).toBe('2026-01-01 00:00:00');
    expect(periodStart('all', now)).toBe('1970-01-01 00:00:00');
  });

  it('date arithmetic crosses month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(addMonths('2026-11-01', 3)).toBe('2027-02-01');
    expect(monthStart('2026-10-31')).toBe('2026-10-01');
  });

  it('series axes have the right length, order and end on the current bucket', () => {
    const d = seriesKeys('day', 30, now);
    expect(d.length).toBe(30);
    expect(d[29]).toBe('2026-10-31');
    expect(d[0]).toBe('2026-10-02');
    const w = seriesKeys('week', 12, now);
    expect(w[11]).toBe('2026-10-26');
    expect(w[10]).toBe('2026-10-19');
    const m = seriesKeys('month', 12, now);
    expect(m[11]).toBe('2026-10-01');
    expect(m[0]).toBe('2025-11-01');
  });

  it('fillSeries turns missing days into zeros and ignores rows outside the axis', () => {
    const f = fillSeries(['2026-10-29', '2026-10-30', '2026-10-31'], [{ key: '2026-10-30', questions: 12, correct: 9 }, { key: '2020-01-01', questions: 99, correct: 99 }]);
    expect(f).toEqual([
      { key: '2026-10-29', questions: 0, correct: 0 },
      { key: '2026-10-30', questions: 12, correct: 9 },
      { key: '2026-10-31', questions: 0, correct: 0 },
    ]);
  });

  it('groupBreakdown: subject totals, chapters biggest first, accuracy in percent', () => {
    const g = groupBreakdown([
      { subjectId: 's1', subject: 'Quant', subjectHindi: 'गणित', chapterId: 'c1', chapter: 'Percentage', chapterHindi: 'प्रतिशत', questions: 10, correct: 7 },
      { subjectId: 's1', subject: 'Quant', subjectHindi: 'गणित', chapterId: 'c2', chapter: 'Ratio', chapterHindi: null, questions: 30, correct: 15 },
      { subjectId: 's2', subject: 'English', subjectHindi: null, chapterId: 'c3', chapter: 'Noun', chapterHindi: null, questions: 5, correct: 5 },
      { subjectId: 's2', subject: 'English', subjectHindi: null, chapterId: 'c4', chapter: 'Empty', chapterHindi: null, questions: 0, correct: 0 },
    ]);
    expect(g.map((s) => s.subject)).toEqual(['Quant', 'English']);
    expect(g[0].questions).toBe(40);
    expect(g[0].correct).toBe(22);
    expect(g[0].wrong).toBe(18);
    expect(g[0].accuracy).toBe(55);
    expect(g[0].chapters.map((c) => c.chapter)).toEqual(['Ratio', 'Percentage']);
    expect(g[0].chapters[1].accuracy).toBe(70);
    expect(g[1].chapters.length).toBe(1); // the empty chapter is not listed
  });

  it('cleanPeriod falls back to week', () => {
    expect(cleanPeriod('month')).toBe('month');
    expect(cleanPeriod('x')).toBe('week');
    expect(cleanPeriod(undefined)).toBe('week');
  });
});
