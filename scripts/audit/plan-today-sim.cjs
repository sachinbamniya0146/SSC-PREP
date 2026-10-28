// Simulation of the REAL StudyPlanV2Service.todayPlan() (the "Aaj" screen) and StudyPlanService.createPlan() against an in-memory fake
// database (session 23, 28 Oct 2026): the numbers on the screen must be the numbers in the data.
//   cd backend && tsx ../scripts/audit/plan-today-sim.cjs .
// Stubbed: @nestjs/common, @prisma/client. Real files: study-plan-v2.service.ts, study-plan.service.ts, study-plan-pace.util.ts,
// study-plan-progress.util.ts, gamification.service.ts (istDateKey), common/question-visibility.ts. Run from the backend folder.
const Module = require('module');
const path = require('path');

const backend = path.resolve(process.argv[2] || '.');
let allOk = true;
const check = (name, cond, info = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!cond) allOk = false; };

class BadRequestException extends Error { constructor(m) { super(typeof m === 'string' ? m : (m && m.message) || 'bad'); this.body = m; } }
class NotFoundException extends Error {}
class ForbiddenException extends Error {}
const nestStub = new Proxy({ BadRequestException, NotFoundException, ForbiddenException }, { get: (t, k) => (k in t ? t[k] : () => () => {}) });
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === '@nestjs/common') return nestStub;
  if (req === '@prisma/client') return { Prisma: { sql: () => ({}) }, StudyPlanType: { COMBINED: 'COMBINED', SUBJECT_WISE: 'SUBJECT_WISE' } };
  if (/prisma\.service$/.test(req)) return { PrismaService: class {} };
  return origLoad.call(this, req, parent, ...rest);
};
const { StudyPlanV2Service } = require(path.join(backend, 'src/study-plan/study-plan-v2.service.ts'));
const { StudyPlanService } = require(path.join(backend, 'src/study-plan/study-plan.service.ts'));

function match(row, where) {
  for (const [k, v] of Object.entries(where || {})) {
    if (k === 'OR') { if (!v.some((w) => match(row, w))) return false; continue; }
    if (k === 'NOT') continue;
    const val = row[k];
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) { if (!v.in.includes(val)) return false; continue; }
      if ('not' in v && Object.keys(v).length === 1) { if (val === v.not) return false; continue; }
      if ('gt' in v || 'gte' in v || 'lt' in v || 'lte' in v) {
        const t = (x) => (x instanceof Date ? x.getTime() : x);
        if (val == null) return false;
        if ('gt' in v && !(t(val) > t(v.gt))) return false;
        if ('gte' in v && !(t(val) >= t(v.gte))) return false;
        if ('lt' in v && !(t(val) < t(v.lt))) return false;
        if ('lte' in v && !(t(val) <= t(v.lte))) return false;
        continue;
      }
      continue; // other filters (e.g. { not: '' } on text) are not needed here
    }
    if (val !== v) return false;
  }
  return true;
}

const DAY = 24 * 3600 * 1000;
const key = (t) => new Date(t + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const NOW = Date.now();
const todayKey = key(NOW);
const keyOffset = (n) => key(NOW + n * DAY);
const at = (n, hour = 12) => new Date(new Date(`${keyOffset(n)}T00:00:00.000Z`).getTime() - 5.5 * 3600 * 1000 + hour * 3600 * 1000); // IST hour on day today+n

function world(o = {}) {
  const exam = { id: 'E1', name: 'SSC CGL' };
  const subjects = [{ id: 'S1', name: 'Maths', nameHindi: 'गणित', slug: 'maths' }, { id: 'S2', name: 'English', nameHindi: null, slug: 'english' }];
  const chapters = [
    ['M1', 'S1'], ['M2', 'S1'], ['M3', 'S1'], ['M4', 'S1'], ['N1', 'S2'], ['N2', 'S2'], ['EMPTY', 'S2'],
  ].map(([id, subjectId]) => ({ id, name: 'Chapter ' + id, nameHindi: null, subjectId, subject: subjects.find((s) => s.id === subjectId) }));
  const qCount = { M1: 30, M2: 30, M3: 30, M4: 30, N1: 30, N2: 30, EMPTY: 0 };
  const plan = {
    id: 'P1', userId: 'u1', examId: 'E1', exam, subjectId: null, type: 'COMBINED',
    startDate: new Date(`${keyOffset(-40)}T00:00:00.000Z`), targetDate: new Date(`${keyOffset(60)}T00:00:00.000Z`),
    dailyTarget: o.dailyTarget ?? 200, createdAt: new Date(NOW - 40 * DAY),
  };
  const spc = (o.chapterRows || []).map((r, i) => ({ id: 'spc' + i, userId: 'u1', lastRevisedAt: null, revisionCount: 0, lastScorePct: null, selfMarkedAt: null, completedAt: null, ...r }));
  const tests = [];
  const attempts = (o.attempts || []).map((a, i) => ({ id: 'ta' + i, userId: 'u1', startedAt: a.startedAt, answers: a.answers }));
  const prisma = {
    studyPlan: { findFirst: async () => ({ ...plan }) },
    exam: { findUnique: async () => exam },
    examPattern: { findMany: async () => [] },
    question: {
      findMany: async () => [{ subjectId: 'S1' }, { subjectId: 'S2' }],
      groupBy: async ({ where }) => chapters.filter((c) => where.chapterId.in.includes(c.id) && qCount[c.id] > 0).map((c) => ({ chapterId: c.id, _count: { _all: qCount[c.id] } })),
    },
    subject: { findMany: async () => subjects },
    chapter: { findMany: async ({ where }) => chapters.filter((c) => (!where.subjectId || where.subjectId.in.includes(c.subjectId)) && (!where.id || where.id.in.includes(c.id))) },
    studyPlanChapter: {
      findMany: async ({ where }) => spc.filter((r) => match(r, where)),
      count: async ({ where }) => spc.filter((r) => match(r, where)).length,
    },
    studyPlanTest: {
      findFirst: async ({ where }) => tests.find((t) => match(t, where)) || null,
      create: async ({ data }) => { const t = { id: 'T' + (tests.length + 1), status: 'SCHEDULED', scorePct: null, createdAt: new Date(), ...data }; tests.push(t); return t; },
    },
    testAttempt: {
      findMany: async ({ where, select }) => attempts.filter((a) => a.userId === where.userId && a.startedAt >= where.startedAt.gte).map((a) => {
        const w = select._count.select.answers.where;
        return { startedAt: a.startedAt, _count: { answers: a.answers.filter((x) => match(x, w)).length } };
      }),
    },
  };
  return { prisma, tests };
}
const ans = (n, empty = 0) => [...Array.from({ length: n }, () => ({ selectedOption: 'A' })), ...Array.from({ length: empty }, () => ({ selectedOption: null }))];

(async () => {
  // ---- scenario A: some history ----
  {
    const { prisma } = world({
      dailyTarget: 200,
      chapterRows: [
        { chapterId: 'M1', status: 'COMPLETE', completedAt: at(-3) },
        { chapterId: 'M2', status: 'SELF_MARKED', selfMarkedAt: at(0, 9) }, // marked today
        { chapterId: 'N1', status: 'WEAK' },
      ],
      attempts: [
        { startedAt: at(0, 10), answers: ans(10, 5) },   // today: 10 answered (+5 skipped, not counted)
        { startedAt: at(0, 15), answers: ans(15) },      // today: 15 more -> 25
        { startedAt: at(-1, 20), answers: ans(40) },     // yesterday 40
        { startedAt: at(-3, 8), answers: ans(7) },       // three days ago (gap on day -2)
        { startedAt: at(-40, 8), answers: ans(99) },     // outside the 30-day window
      ],
    });
    const svc = new StudyPlanV2Service(prisma);
    const t = await svc.todayPlan('u1');
    check('legacy stored daily target 200 is shown as 100 (max)', t.today.practiceQuestions === 100 && t.today.practiceSets === 4, 'got ' + t.today.practiceQuestions);
    check('answered today counts chosen options only (10+15, not the 5 skipped)', t.today.answeredToday === 25, 'got ' + t.today.answeredToday);
    check('week strip = 7 days, oldest first, today last and flagged', t.week.length === 7 && t.week[6].isToday && t.week[6].day === todayKey && t.week.filter((d) => d.isToday).length === 1);
    check('week numbers: today 25, yesterday 40, day-2 0, day-3 7', t.week[6].answered === 25 && t.week[5].answered === 40 && t.week[4].answered === 0 && t.week[3].answered === 7, JSON.stringify(t.week.map((d) => d.answered)));
    check('goal met only where answered >= target (100): none here', t.goalDaysThisWeek === 0 && t.week.every((d) => !d.goalMet));
    check('active streak = 2 (today + yesterday, broken by the empty day)', t.streakDays === 2, 'got ' + t.streakDays);
    check('chapters marked today = 1 (M2)', t.today.chaptersDoneToday === 1, 'got ' + t.today.chaptersDoneToday);
    // 6 chapters with questions; 40 of 100 days elapsed, reserve 20 -> 80 study days -> expected 3; covered = 1 complete + 1 self-marked = 2
    check('pace: 40/100 days, expected 3 of 6 chapters, covered 2 -> ON_TRACK (delta -1)', t.pace.status === 'ON_TRACK' && t.pace.expectedChapters === 3 && t.pace.coveredChapters === 2 && t.pace.delta === -1 && t.pace.elapsedDays === 40 && t.pace.totalDays === 100, JSON.stringify(t.pace));
    check('the chapter with no questions is not counted anywhere', t.progress.total === 6);
    const sp = Object.fromEntries(t.subjectProgress.map((s) => [s.name, s]));
    check('subject progress: Maths 1/4 complete, English 0/2 complete with 1 weak', sp.Maths.total === 4 && sp.Maths.complete === 1 && sp.English.total === 2 && sp.English.weak === 1, JSON.stringify(t.subjectProgress));
    check('revision available (1 completed chapter) and a REVISION paper was created once', t.revision && t.revision.available === true);
  }

  // ---- scenario B: nothing done yet, behind ----
  {
    const { prisma } = world({ dailyTarget: 3, chapterRows: [], attempts: [] });
    const svc = new StudyPlanV2Service(prisma);
    const t = await svc.todayPlan('u1');
    check('stored target 3 is shown as 25 (min)', t.today.practiceQuestions === 25 && t.today.practiceSets === 1, 'got ' + t.today.practiceQuestions);
    check('no activity: 0 answered, streak 0, empty strip', t.today.answeredToday === 0 && t.streakDays === 0 && t.week.every((d) => d.answered === 0));
    check('pace: expected 3 of 6, covered 0 -> BEHIND (delta -3)', t.pace.status === 'BEHIND' && t.pace.delta === -3, JSON.stringify(t.pace));
    check('revision is "not yet" when no chapter is complete', t.revision && t.revision.available === false);
  }

  // ---- scenario C: goal met today ----
  {
    const { prisma } = world({ dailyTarget: 50, chapterRows: [], attempts: [{ startedAt: at(0, 9), answers: ans(60) }, { startedAt: at(-1, 9), answers: ans(50) }] });
    const t = await new StudyPlanV2Service(prisma).todayPlan('u1');
    check('target 50: today 60 and yesterday 50 both meet the goal', t.today.practiceQuestions === 50 && t.goalDaysThisWeek === 2 && t.week[6].goalMet && t.week[5].goalMet, JSON.stringify(t.week.map((d) => d.goalMet)));
  }

  // ---- createPlan: dates + daily target ----
  {
    let saved = null;
    const prisma = {
      exam: { findUnique: async () => ({ id: 'E1' }) },
      question: { count: async () => 12000 },
      studyPlan: { findFirst: async () => null, create: async ({ data }) => (saved = data) },
    };
    const svc = new StudyPlanService(prisma);
    const fails = async (target) => { try { await svc.createPlan('u1', { examId: 'E1', targetDate: target }); return false; } catch (e) { return e instanceof BadRequestException; } };
    check('target date = today is refused', await fails(todayKey));
    check('target date in the past is refused', await fails(keyOffset(-5)));
    check('garbage / non-ISO / impossible dates are refused', (await fails('tomorrow')) && (await fails('31/12/2027')) && (await fails('2027-02-30')) && (await fails('')));
    check('more than 3 years away is refused', await fails(keyOffset(3 * 366 + 30)));
    await svc.createPlan('u1', { examId: 'E1', targetDate: keyOffset(100) });
    check('start date saved = today IST (not yesterday)', saved && saved.startDate.toISOString().slice(0, 10) === todayKey, saved && saved.startDate.toISOString());
    check('target date saved as the typed calendar day', saved.targetDate.toISOString().slice(0, 10) === keyOffset(100));
    check('12000 questions over 100 days = 120/day is capped at 100', saved.dailyTarget === 100, 'got ' + saved.dailyTarget);
    await svc.createPlan('u1', { examId: 'E1', targetDate: keyOffset(1) });
    check('tomorrow is a valid target date', saved.targetDate.toISOString().slice(0, 10) === keyOffset(1));
  }

  console.log(allOk ? '\nALL OK' : '\nSOME CHECKS FAILED');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
