/**
 * Study stats: PURE date helpers (no database, no clock). Every "day" is an IST calendar day, because that is what a student means by "today".
 * All timestamps handed to SQL are IST wall-clock strings ("YYYY-MM-DD HH:MM:SS"), compared with the answers' IST wall-clock time.
 */

export type Period = 'today' | 'week' | 'month' | 'year' | 'all';
export const PERIODS: Period[] = ['today', 'week', 'month', 'year', 'all'];

const MS_DAY = 86_400_000;
const IST_MS = 5.5 * 3_600_000;

export function cleanPeriod(v: unknown): Period {
  return PERIODS.includes(v as Period) ? (v as Period) : 'week';
}

/** YYYY-MM-DD of `now` in IST. */
export function istDay(now: Date): string {
  return new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);
}

const dayMs = (day: string) => Date.parse(`${day}T00:00:00.000Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  return fromMs(dayMs(day) + n * MS_DAY);
}

/** Monday of the week that holds `day` (weeks run Monday-Sunday). */
export function weekStart(day: string): string {
  const dow = new Date(dayMs(day)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function addMonths(monthFirstDay: string, n: number): string {
  const y = Number(monthFirstDay.slice(0, 4));
  const m = Number(monthFirstDay.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
}

/** First instant of a period, as an IST wall-clock string. 'all' starts in 1970. */
export function periodStart(period: Period, now: Date): string {
  const d = istDay(now);
  const day = period === 'today' ? d : period === 'week' ? weekStart(d) : period === 'month' ? monthStart(d) : period === 'year' ? `${d.slice(0, 4)}-01-01` : '1970-01-01';
  return `${day} 00:00:00`;
}

export interface Bucket {
  key: string; // YYYY-MM-DD (the day, the Monday of the week, or the first day of the month)
  questions: number;
  correct: number;
}

/** The keys of the last `count` days / weeks / months ending with the current one, oldest first. */
export function seriesKeys(kind: 'day' | 'week' | 'month', count: number, now: Date): string[] {
  const d = istDay(now);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(kind === 'day' ? addDays(d, -i) : kind === 'week' ? addDays(weekStart(d), -7 * i) : addMonths(monthStart(d), -i));
  }
  return out;
}

/** Puts database rows on a complete axis: a day without answers is a zero bar, not a gap. */
export function fillSeries(keys: string[], rows: { key: string; questions: number; correct: number }[]): Bucket[] {
  const by = new Map(rows.map((r) => [r.key, r]));
  return keys.map((k) => {
    const r = by.get(k);
    return { key: k, questions: Number(r?.questions) || 0, correct: Number(r?.correct) || 0 };
  });
}

export interface BreakdownRow {
  subjectId: string | null;
  subject: string | null;
  subjectHindi: string | null;
  chapterId: string | null;
  chapter: string | null;
  chapterHindi: string | null;
  questions: number;
  correct: number;
}

export interface SubjectGroup {
  subjectId: string | null;
  subject: string;
  subjectHindi: string | null;
  questions: number;
  correct: number;
  wrong: number;
  accuracy: number;
  chapters: { chapterId: string | null; chapter: string; chapterHindi: string | null; questions: number; correct: number; wrong: number; accuracy: number }[];
}

const pct = (c: number, n: number) => (n > 0 ? Math.round((c / n) * 100) : 0);

/** Subject -> chapter tree, biggest first; accuracy in whole percent. */
export function groupBreakdown(rows: BreakdownRow[]): SubjectGroup[] {
  const subjects = new Map<string, SubjectGroup>();
  for (const r of rows) {
    const n = Number(r.questions) || 0;
    const c = Number(r.correct) || 0;
    if (n <= 0) continue;
    const key = r.subjectId ?? '-';
    let s = subjects.get(key);
    if (!s) {
      s = { subjectId: r.subjectId, subject: r.subject ?? 'Other', subjectHindi: r.subjectHindi ?? null, questions: 0, correct: 0, wrong: 0, accuracy: 0, chapters: [] };
      subjects.set(key, s);
    }
    s.questions += n;
    s.correct += c;
    s.chapters.push({ chapterId: r.chapterId, chapter: r.chapter ?? 'Other', chapterHindi: r.chapterHindi ?? null, questions: n, correct: c, wrong: n - c, accuracy: pct(c, n) });
  }
  const out = Array.from(subjects.values());
  for (const s of out) {
    s.wrong = s.questions - s.correct;
    s.accuracy = pct(s.correct, s.questions);
    s.chapters.sort((a, b) => b.questions - a.questions || a.chapter.localeCompare(b.chapter));
  }
  return out.sort((a, b) => b.questions - a.questions || a.subject.localeCompare(b.subject));
}
