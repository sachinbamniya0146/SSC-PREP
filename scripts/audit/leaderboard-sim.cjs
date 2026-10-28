// Simulation of the REAL GamificationService (XP leaderboard + dashboard rank) and RankService (per-test toppers / result rank)
// against an in-memory fake database (session 23, 28 Oct 2026): admin and staff accounts must never be listed, never be counted in a
// student's rank, and a staff viewer must get no rank.
//   cd backend && tsx ../scripts/audit/leaderboard-sim.cjs .            -> the tree you run it in (must print ALL OK)
//   cd <old-tree>/backend && tsx <new-tree>/scripts/audit/leaderboard-sim.cjs .   -> against the session-22 tree: FAILs (admin on the board)
// Only @nestjs/common, @prisma/client and the feature controller are stubbed; gamification.service.ts, rank.service.ts, rank.util.ts,
// common/cache.ts and (in the new tree) common/rankable.ts are the real files. Run from the backend folder so tsx finds its tsconfig.
const Module = require('module');
const path = require('path');

const backend = path.resolve(process.argv[2] || '.');
let allOk = true;
const check = (name, cond, info = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!cond) allOk = false; };

class BadRequestException extends Error {}
class NotFoundException extends Error {}
const nestStub = new Proxy({ BadRequestException, NotFoundException }, { get: (t, k) => (k in t ? t[k] : () => () => {}) });
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === '@nestjs/common') return nestStub;
  if (req === '@prisma/client') return { Prisma: {} };
  if (/features\.service$/.test(req) || /prisma\.service$/.test(req)) return { FeaturesService: class {}, PrismaService: class {} };
  return origLoad.call(this, req, parent, ...rest);
};
const { GamificationService } = require(path.join(backend, 'src/gamification/gamification.service.ts'));
const { RankService } = require(path.join(backend, 'src/tests/rank.service.ts'));

// ---- a tiny Prisma `where` evaluator: equality, in, gt/gte/lt/lte, not, nested relation objects ----
function match(row, where) {
  for (const [k, v] of Object.entries(where || {})) {
    const val = row[k];
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) { if (!v.in.includes(val)) return false; continue; }
      if ('gt' in v || 'gte' in v || 'lt' in v || 'lte' in v || 'not' in v) {
        if ('gt' in v && !(val > v.gt)) return false;
        if ('gte' in v && !(val >= v.gte)) return false;
        if ('lt' in v && !(val < v.lt)) return false;
        if ('lte' in v && !(val <= v.lte)) return false;
        if ('not' in v && val === v.not) return false;
        continue;
      }
      if (val && typeof val === 'object') { if (!match(val, v)) return false; continue; }
      return false;
    }
    if (val !== v) return false;
  }
  return true;
}

const NOW = Date.now();
const day = 24 * 3600 * 1000;
function world() {
  const U = (id, fullName, xp, extra = {}) => ({ id, fullName, xp, currentStreak: 1, longestStreak: 1, coins: 0, hintQuota: 0, lastPracticeDate: null, state: 'Bihar', role: 'STUDENT', isSuspended: false, updatedAt: new Date(NOW - day), ...extra });
  const users = [
    U('admin', 'Sachin Admin', 9999, { role: 'ADMIN' }),
    U('mod', 'Meena Moderator', 700, { role: 'MODERATOR' }),
    U('s1', 'Asha Kumari', 500),
    U('s2', 'Ravi Singh', 300),
    U('bad', 'Banned Boy', 800, { isSuspended: true }),
    U('s3', 'Neha Gupta', 100, { state: 'Delhi' }),
    U('s4', 'Old Active', 50, { updatedAt: new Date(NOW - 30 * day) }),
    U('zero', 'No Xp', 0),
  ];
  const byId = (id) => users.find((u) => u.id === id) || null;
  const pick = (u, sel) => { if (!sel) return { ...u }; const o = {}; for (const k of Object.keys(sel)) if (sel[k]) o[k] = u[k]; return o; };
  const attempts = [];
  const A = (id, userId, score, startMin) => attempts.push({ id, userId, testTemplateId: 'T1', status: 'SUBMITTED', score, accuracyPercent: 50, expiresAt: new Date(NOW - 1e7 + startMin * 60000 + 3600000), startedAt: new Date(NOW - 1e7 + startMin * 60000), submittedAt: new Date(NOW - 1e7 + startMin * 60000 + 1800000), user: byId(userId) });
  A('a-admin', 'admin', 190, 0); A('a-mod', 'mod', 150, 1); A('a-s1', 's1', 120, 2); A('a-s2', 's2', 100, 3); A('a-bad', 'bad', 180, 4);
  const prisma = {
    user: {
      findUnique: async ({ where, select }) => { const u = byId(where.id); return u ? pick(u, select) : null; },
      findMany: async ({ where, orderBy, take, select }) => {
        let r = users.filter((u) => match(u, where));
        if (orderBy && orderBy.xp === 'desc') r = r.sort((a, b) => b.xp - a.xp);
        if (take) r = r.slice(0, take);
        return r.map((u) => pick(u, select));
      },
      count: async ({ where }) => users.filter((u) => match(u, where)).length,
    },
    attemptAnswer: { count: async () => 0 },
    testAttempt: {
      findMany: async ({ where, take }) => attempts.filter((a) => match(a, where)).slice(0, take || 1e9).map((a) => ({ ...a, user: { fullName: a.user.fullName, state: a.user.state } })),
      findFirst: async ({ where }) => { const a = attempts.find((x) => (!where.id || x.id === where.id) && (!where.userId || x.userId === where.userId)); return a ? { ...a, user: { state: a.user.state, role: a.user.role } } : null; },
    },
  };
  return { prisma, attempts, users };
}

(async () => {
  // ---- XP leaderboard ----
  {
    const { prisma } = world();
    const g = new GamificationService(prisma);
    const lb = await g.leaderboard('s2', 'all', 50, 'india');
    const ids = lb.rows.map((r) => r.id);
    check('XP board never lists the admin', !ids.includes('admin'), JSON.stringify(ids));
    check('XP board never lists a moderator', !ids.includes('mod'), JSON.stringify(ids));
    check('suspended students stay out', !ids.includes('bad'));
    check('board = the 4 active students with XP, best first, ranks 1..4', JSON.stringify(ids) === JSON.stringify(['s1', 's2', 's3', 's4']) && lb.rows.map((r) => r.rank).join() === '1,2,3,4', JSON.stringify(ids));
    check("a student's own rank ignores admin / staff XP (Ravi is #2, not #4)", lb.myRank === 2, 'myRank=' + lb.myRank);
    check('student viewer: me.rank = 2, not flagged staff', lb.me && lb.me.rank === 2 && !lb.staff);

    const lbAdmin = await g.leaderboard('admin', 'all', 50, 'india');
    check('admin viewer: sees the same board', JSON.stringify(lbAdmin.rows.map((r) => r.id)) === JSON.stringify(ids));
    check('admin viewer: no rank and no "me" row, staff = true', lbAdmin.myRank === null && lbAdmin.me === null && lbAdmin.staff === true, JSON.stringify({ myRank: lbAdmin.myRank, me: lbAdmin.me && 'row', staff: lbAdmin.staff }));
    check('no row on the board is the admin even when an admin request filled the cache first', !lbAdmin.rows.some((r) => r.id === 'admin'));

    const lbMod = await g.leaderboard('mod', 'all', 50, 'india');
    check('moderator viewer: no rank either', lbMod.myRank === null && lbMod.me === null);

    const lbState = await g.leaderboard('s2', 'all', 50, 'state'); // Bihar
    check('state board (Bihar): students only, admin / mod (also Bihar) excluded', JSON.stringify(lbState.rows.map((r) => r.id)) === JSON.stringify(['s1', 's2', 's4']), JSON.stringify(lbState.rows.map((r) => r.id)));
    check('state rank of Ravi = 2', lbState.myRank === 2, 'myRank=' + lbState.myRank);

    const lbWeek = await g.leaderboard('s1', 'weekly', 50, 'india');
    check('weekly board: only recently active students, still no admin', JSON.stringify(lbWeek.rows.map((r) => r.id)) === JSON.stringify(['s1', 's2', 's3']), JSON.stringify(lbWeek.rows.map((r) => r.id)));

    const lbStaffState = await g.leaderboard('admin', 'all', 50, 'state');
    check('admin on the state board does not get a "choose your state" prompt', lbStaffState.needState === false && lbStaffState.staff === true);
  }

  // ---- dashboard rank ----
  {
    const { prisma } = world();
    const g = new GamificationService(prisma);
    const me = await g.myState('s2');
    check('dashboard: Ravi rank #2, 5 ranked students (4 with XP + one with 0 XP)', me.rank === 2 && me.totalUsers === 5 /* s1 s2 s3 s4 zero */, 'rank=' + me.rank + ' total=' + me.totalUsers);
    const adm = await g.myState('admin');
    check('dashboard: admin has no rank, staff = true', adm.rank === null && adm.staff === true, 'rank=' + adm.rank);
    check('dashboard payload does not carry the role field', !('role' in me) && !('role' in adm));
  }

  // ---- per-test toppers + result rank ----
  {
    const { prisma } = world();
    const features = { assertEnabled: async () => undefined };
    const r = new RankService(prisma, features);
    const board = await r.leaderboard('s2', 'T1');
    const names = board.rows.map((x) => x.name).join(' | ');
    check('test toppers: admin and moderator attempts are not listed', !/Sachin|Meena/.test(names), names);
    check('test toppers: only the 2 active students, best score first', board.total === 2 && board.rows[0].score === 120 && board.rows[1].score === 100, 'total=' + board.total);
    const s2 = await r.forAttempt('s2', 'a-s2');
    check("student's rank in the test ignores the admin's 190 (Ravi #2 of 2)", s2.overall.rank === 2 && s2.overall.outOf === 2, JSON.stringify(s2.overall));
    check('student attempt counts for rank, not staff', s2.countsForRank === true && s2.staff === false);
    const adm = await r.forAttempt('admin', 'a-admin');
    check('admin result: shown as practice only (does not count, staff = true)', adm.countsForRank === false && adm.staff === true, JSON.stringify({ c: adm.countsForRank, s: adm.staff }));
    const s2again = await r.forAttempt('s2', 'a-s2');
    check('the admin attempt did not change the student rank', s2again.overall.rank === 2 && s2again.overall.outOf === 2);
  }

  console.log(allOk ? '\nALL OK' : '\nSOME CHECKS FAILED');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
