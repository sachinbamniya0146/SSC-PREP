// S50 simulation: the REAL StudyStatsService (its real SQL) against a REAL PostgreSQL that has all migrations applied.
// Proves: IST "today" (a 00:30 IST answer is today even though UTC says yesterday), Monday weeks, month / year / all-time counts,
// skipped answers and unfinished attempts are not counted, another student's answers are not counted, subject -> chapter split, zero-filled series.
// Needs a scratch database: apply every backend/prisma/migrations/*/migration.sql in order to it, then
//   cd backend && PGHOST=/tmp/pg PGPORT=5544 PGUSER=postgres PGDATABASE=t tsx --require ../scripts/audit/nest-stubs.cjs ../scripts/audit/study-stats-sim.cjs .
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(process.argv[2] || '.');
const { StudyStatsService } = require(path.join(root, 'src/study-stats/study-stats.service.ts'));
const DB = process.env.PGDATABASE || 't';

const psql = (sql) => execFileSync('psql', ['-q', '-At', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
const lit = (v) => (v instanceof Date ? `'${v.toISOString().replace('T', ' ').replace('Z', '')}'` : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const prisma = {
  $queryRawUnsafe: async (sql, ...params) => {
    const filled = sql.replace(/\$(\d+)/g, (_, n) => lit(params[Number(n) - 1]));
    const out = psql(`select coalesce(json_agg(t), '[]'::json) from (${filled}) t`).trim();
    return JSON.parse(out);
  },
};

let fails = 0;
const check = (name, ok, extra) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok || !extra ? '' : '  -> ' + extra)); if (!ok) fails++; };

// ---------------- seed
psql(`truncate attempt_answers, test_attempts, test_templates, questions, chapters, subjects, users cascade`);
const sql = [];
sql.push(`insert into users(id,email,"fullName","passwordHash","updatedAt") values ('u1','a@x.in','A','x',now()),('u2','b@x.in','B','x',now())`);
sql.push(`insert into subjects(id,name,"nameHindi",slug) values ('s-q','Quant','गणित','quant'),('s-e','English',null,'english')`);
sql.push(`insert into chapters(id,name,"nameHindi",slug,"subjectId") values ('c-pct','Percentage','प्रतिशत','pct','s-q'),('c-ratio','Ratio',null,'ratio','s-q'),('c-noun','Noun',null,'noun','s-e')`);
let qn = 0;
const qs = {};
for (const [ch, sub, n] of [['c-pct', 's-q', 12], ['c-ratio', 's-q', 12], ['c-noun', 's-e', 12]]) {
  qs[ch] = [];
  for (let i = 0; i < n; i++) { qn++; const id = `q${qn}`; qs[ch].push(id); sql.push(`insert into questions(id,"questionText","optionsJson","correctAnswer","subjectId","chapterId","updatedAt") values ('${id}','Q ${qn}','[]'::jsonb,'A','${sub}','${ch}',now())`); }
}
sql.push(`insert into test_templates(id,title,type,"updatedAt") values ('tp','T','CUSTOM',now())`);
let an = 0;
function attempt(id, user, status, submittedAt, chapter, answers) { // answers: array of 'ok' | 'bad' | 'skip'
  sql.push(`insert into test_attempts(id,"userId","testTemplateId",status,"submittedAt") values ('${id}','${user}','tp','${status}',${submittedAt ? `'${submittedAt}'` : 'null'})`);
  answers.forEach((a, i) => { an++; sql.push(`insert into attempt_answers(id,"testAttemptId","questionId","selectedOption","isCorrect") values ('aa${an}','${id}','${qs[chapter][i]}',${a === 'skip' ? 'null' : "'A'"},${a === 'ok'})`); });
}
const rep = (v, n) => Array(n).fill(v);
attempt('A', 'u1', 'SUBMITTED', '2026-10-30 19:00:00', 'c-pct', ['ok', 'ok', 'ok', 'bad', 'skip']); // 31 Oct 00:30 IST: today by IST, yesterday by UTC
attempt('B', 'u1', 'AUTO_SUBMITTED', '2026-10-29 10:00:00', 'c-noun', ['ok', 'ok', 'bad', 'bad', 'bad']); // Thu this week
attempt('C', 'u1', 'SUBMITTED', '2026-10-05 10:00:00', 'c-ratio', [...rep('ok', 6), ...rep('bad', 4)]); // this month, earlier week
attempt('D', 'u1', 'SUBMITTED', '2026-03-01 10:00:00', 'c-pct', [...rep('ok', 5), ...rep('bad', 3)]); // this year
attempt('E', 'u1', 'SUBMITTED', '2025-06-10 10:00:00', 'c-noun', [...rep('ok', 4), ...rep('bad', 3)]); // before this year
attempt('F', 'u1', 'IN_PROGRESS', null, 'c-ratio', rep('ok', 5)); // never counted
attempt('G', 'u2', 'SUBMITTED', '2026-10-30 19:10:00', 'c-pct', rep('ok', 9)); // another student
psql(sql.join(';\n'));

(async () => {
  const svc = new StudyStatsService(prisma);
  const now = new Date('2026-10-30T20:00:00Z'); // Saturday 31 Oct 2026, 01:30 IST
  const r = await svc.overview('u1', 'week', now);
  const T = r.totals;
  check('today: the 00:30 IST answers count as today (4 answered, skipped not counted)', T.today.questions === 4 && T.today.correct === 3 && T.today.wrong === 1 && T.today.accuracy === 75, JSON.stringify(T.today));
  check('week (Mon 26 Oct): today + Thursday = 9, 5 right', T.week.questions === 9 && T.week.correct === 5, JSON.stringify(T.week));
  check('month: + the 5 Oct set = 19, 11 right', T.month.questions === 19 && T.month.correct === 11, JSON.stringify(T.month));
  check('year: + the March set = 27', T.year.questions === 27 && T.year.correct === 16, JSON.stringify(T.year));
  check('all time: + the 2025 set = 34', T.all.questions === 34 && T.all.correct === 20, JSON.stringify(T.all));
  check('unfinished attempt and other student are not counted', T.all.questions === 34);
  check('first day and active days', r.firstDay === '2025-06-10' && r.activeDays === 5, `${r.firstDay} ${r.activeDays}`);

  const d = r.series.daily;
  check('daily series: 30 days, ends today (31 Oct)', d.length === 30 && d[29].key === '2026-10-31' && d[0].key === '2026-10-02');
  check('daily: 31 Oct = 4, 29 Oct = 5, 5 Oct = 10, a quiet day = 0', d[29].questions === 4 && d.find((x) => x.key === '2026-10-29').questions === 5 && d.find((x) => x.key === '2026-10-05').questions === 10 && d.find((x) => x.key === '2026-10-30').questions === 0);
  const w = r.series.weekly;
  check('weekly series: 12 weeks, this week (Mon 26 Oct) = 9, week of 5 Oct (Mon 5 Oct) = 10', w.length === 12 && w[11].key === '2026-10-26' && w[11].questions === 9 && w.find((x) => x.key === '2026-10-05').questions === 10, JSON.stringify(w.slice(-4)));
  const m = r.series.monthly;
  check('monthly series: 12 months, October = 19, March 2026 = 8, June 2025 is outside', m.length === 12 && m[11].questions === 19 && m.find((x) => x.key === '2026-03-01').questions === 8 && !m.some((x) => x.key === '2025-06-01'));

  const bw = r.subjects;
  check('week split: Quant 4 (Percentage), English 5 (Noun)', bw.length === 2 && bw.find((s) => s.subject === 'Quant').questions === 4 && bw.find((s) => s.subject === 'English').questions === 5, JSON.stringify(bw.map((s) => [s.subject, s.questions])));
  const month = await svc.overview('u1', 'month', now);
  const q = month.subjects.find((s) => s.subject === 'Quant');
  check('month split: Quant = Percentage 4 + Ratio 10, biggest chapter first, Hindi name kept', q.questions === 14 && q.chapters[0].chapter === 'Ratio' && q.chapters[1].chapterHindi === 'प्रतिशत' && q.subjectHindi === 'गणित', JSON.stringify(q));
  const all = await svc.overview('u1', 'all', now);
  check('all-time split adds the old sets', all.subjects.reduce((a, s) => a + s.questions, 0) === 34);
  const today = await svc.overview('u1', 'today', now);
  check('today split = 4 questions, one chapter', today.subjects.length === 1 && today.subjects[0].chapters.length === 1 && today.subjects[0].questions === 4);
  const none = await svc.overview('nobody', 'all', now);
  check('a student with no answers gets zeros, not an error', none.totals.all.questions === 0 && none.firstDay === null && none.subjects.length === 0 && none.series.daily.length === 30);
  const bad = await svc.overview('u1', 'garbage', now);
  check('unknown period falls back to week', bad.period === 'week');

  console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
