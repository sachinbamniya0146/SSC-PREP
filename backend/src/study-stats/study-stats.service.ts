/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Bucket, Period, PERIODS, cleanPeriod, fillSeries, groupBreakdown, periodStart, seriesKeys } from './study-stats.util';

// Every answered question of a SUBMITTED test or practice set of this student, with its IST wall-clock time, subject and chapter.
// Skipped questions (no option chosen) and unfinished attempts are not counted: "solved" means answered in a finished test / set.
const ANSWERS_CTE = `
  WITH a AS (
    SELECT (ta."submittedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') AS ts,
           aa."isCorrect" AS ok, q."subjectId" AS sid, q."chapterId" AS cid
    FROM "attempt_answers" aa
    JOIN "test_attempts" ta ON ta."id" = aa."testAttemptId"
    JOIN "questions" q ON q."id" = aa."questionId"
    WHERE ta."userId" = $1
      AND ta."submittedAt" IS NOT NULL
      AND ta."status" IN ('SUBMITTED', 'AUTO_SUBMITTED')
      AND aa."selectedOption" IS NOT NULL AND aa."selectedOption" <> '' AND upper(aa."selectedOption") <> 'SKIPPED'
  )`;

export const TOTALS_SQL = `${ANSWERS_CTE}
  SELECT
    COUNT(*)::int AS "allQ", (COUNT(*) FILTER (WHERE ok))::int AS "allC",
    (COUNT(*) FILTER (WHERE ts >= $2::timestamp))::int AS "todayQ", (COUNT(*) FILTER (WHERE ts >= $2::timestamp AND ok))::int AS "todayC",
    (COUNT(*) FILTER (WHERE ts >= $3::timestamp))::int AS "weekQ", (COUNT(*) FILTER (WHERE ts >= $3::timestamp AND ok))::int AS "weekC",
    (COUNT(*) FILTER (WHERE ts >= $4::timestamp))::int AS "monthQ", (COUNT(*) FILTER (WHERE ts >= $4::timestamp AND ok))::int AS "monthC",
    (COUNT(*) FILTER (WHERE ts >= $5::timestamp))::int AS "yearQ", (COUNT(*) FILTER (WHERE ts >= $5::timestamp AND ok))::int AS "yearC",
    to_char(MIN(ts), 'YYYY-MM-DD') AS "firstDay",
    COUNT(DISTINCT ts::date)::int AS "activeDays"
  FROM a`;

const seriesSql = (bucket: string) => `${ANSWERS_CTE}
  SELECT to_char(${bucket}, 'YYYY-MM-DD') AS key, COUNT(*)::int AS questions, (COUNT(*) FILTER (WHERE ok))::int AS correct
  FROM a WHERE ts >= $2::timestamp GROUP BY 1`;

export const DAILY_SQL = seriesSql('ts::date');
export const WEEKLY_SQL = seriesSql("date_trunc('week', ts)::date");
export const MONTHLY_SQL = seriesSql("date_trunc('month', ts)::date");

export const BREAKDOWN_SQL = `${ANSWERS_CTE}
  SELECT a.sid AS "subjectId", s."name" AS subject, s."nameHindi" AS "subjectHindi",
         a.cid AS "chapterId", c."name" AS chapter, c."nameHindi" AS "chapterHindi",
         COUNT(*)::int AS questions, (COUNT(*) FILTER (WHERE a.ok))::int AS correct
  FROM a
  LEFT JOIN "subjects" s ON s."id" = a.sid
  LEFT JOIN "chapters" c ON c."id" = a.cid
  WHERE a.ts >= $2::timestamp
  GROUP BY a.sid, s."name", s."nameHindi", a.cid, c."name", c."nameHindi"`;

const DAYS = 30;
const WEEKS = 12;
const MONTHS = 12;

/** "How much did I study": questions answered per day / week / month / year / since the start, split by subject and chapter. */
@Injectable()
export class StudyStatsService {
  constructor(private readonly prisma: PrismaService) {}

  private raw(sql: string, ...params: unknown[]): Promise<any[]> {
    return (this.prisma as any).$queryRawUnsafe(sql, ...params);
  }

  async overview(userId: string, periodIn?: string, now = new Date()) {
    const period: Period = cleanPeriod(periodIn);
    const start = (p: Period) => periodStart(p, now);
    const dayKeys = seriesKeys('day', DAYS, now);
    const weekKeys = seriesKeys('week', WEEKS, now);
    const monthKeys = seriesKeys('month', MONTHS, now);

    const [totalsRows, daily, weekly, monthly, breakdown] = await Promise.all([
      this.raw(TOTALS_SQL, userId, start('today'), start('week'), start('month'), start('year')),
      this.raw(DAILY_SQL, userId, `${dayKeys[0]} 00:00:00`),
      this.raw(WEEKLY_SQL, userId, `${weekKeys[0]} 00:00:00`),
      this.raw(MONTHLY_SQL, userId, `${monthKeys[0]} 00:00:00`),
      this.raw(BREAKDOWN_SQL, userId, start(period)),
    ]);
    const t = totalsRows?.[0] ?? {};
    const tot = (q: string, c: string) => {
      const questions = Number(t[q]) || 0;
      const correct = Number(t[c]) || 0;
      return { questions, correct, wrong: questions - correct, accuracy: questions > 0 ? Math.round((correct / questions) * 100) : 0 };
    };
    const totals: Record<Period, ReturnType<typeof tot>> = {
      today: tot('todayQ', 'todayC'),
      week: tot('weekQ', 'weekC'),
      month: tot('monthQ', 'monthC'),
      year: tot('yearQ', 'yearC'),
      all: tot('allQ', 'allC'),
    };
    const series: { daily: Bucket[]; weekly: Bucket[]; monthly: Bucket[] } = {
      daily: fillSeries(dayKeys, daily),
      weekly: fillSeries(weekKeys, weekly),
      monthly: fillSeries(monthKeys, monthly),
    };
    return {
      period,
      periods: PERIODS,
      totals,
      firstDay: t.firstDay ?? null,
      activeDays: Number(t.activeDays) || 0,
      series,
      subjects: groupBreakdown(breakdown as any[]),
    };
  }
}
