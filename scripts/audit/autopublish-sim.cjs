// Simulation of AutoPublishService.run() with an in-memory fake Prisma + fake DuplicateReviewService.
// @nestjs/common and the heavy duplicate-review.service are replaced by stubs; everything else is the real code.
const Module = require('module'); const path = require('path');
const origLoad = Module._load;
class FakeHttp extends Error {}
const nestStub = { Injectable: () => () => {}, Logger: class { log() {} warn() {} }, BadRequestException: class extends FakeHttp {}, OnModuleInit: class {}, OnModuleDestroy: class {} };
let reviewsFake;
Module._load = function (req, parent, ...rest) {
  if (req === '@nestjs/common') return nestStub;
  if (/\/duplicate-review\.service$/.test(req) || req === './duplicate-review.service') return { DuplicateReviewService: class {} };
  if (/prisma\.service$/.test(req)) return { PrismaService: class {} };
  return origLoad.call(this, req, parent, ...rest);
};
const { AutoPublishService } = require(path.resolve(process.argv[2]));
const util = require(path.resolve(process.argv[3]));

// ---- fake DB ----
function makeDb(rows, settings, users) {
  const matchWhere = (r, w) => {
    if (!w) return true;
    if (w.status !== undefined && r.status !== w.status) return false;
    if (w.createdAt?.lte && !(r.createdAt <= w.createdAt.lte)) return false;
    if (w.id?.in && !w.id.in.includes(r.id)) return false;
    if (w.OR && !w.OR.some(o => matchWhere(r, o))) return false;
    if ('autoReason' in w) {
      const c = w.autoReason;
      if (c === null) { if (r.autoReason !== null && r.autoReason !== undefined) return false; }
      else if (c && typeof c === 'object' && 'not' in c) { if (r.autoReason === c.not) return false; }
      else if (typeof c === 'string' && r.autoReason !== c) return false;
    }
    return true;
  };
  return {
    duplicateReview: {
      count: async ({ where }) => rows.filter(r => matchWhere(r, where)).length,
      findMany: async ({ where, orderBy, take, cursor, skip, select }) => {
        let out = rows.filter(r => matchWhere(r, where));
        out.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
        if (cursor) { const i = out.findIndex(r => r.id === cursor.id); out = out.slice(i + 1 + ((skip || 1) - 1)); }
        return out.slice(0, take).map(r => ({ ...r }));
      },
      updateMany: async ({ where, data }) => { let n = 0; for (const r of rows) if (matchWhere(r, where)) { Object.assign(r, data); n++; } return { count: n }; },
    },
    question: { findMany: async ({ where }) => where.id.in.map(id => ({ id, year: 2024, examDate: null, isActive: true, isApproved: true, autoSuspended: false, createdAt: new Date() })) },
    appSetting: { findUnique: async ({ where }) => settings[where.key] ?? null, upsert: async ({ where, create, update }) => { settings[where.key] = { key: where.key, valueJson: (settings[where.key] ? update : create).valueJson, updatedBy: (create || {}).updatedBy }; } },
    user: { findUnique: async () => ({ id: 'admin1', role: 'ADMIN' }), findFirst: async () => ({ id: 'admin1' }) },
  };
}
const DAY = 86400000, old = new Date(Date.now() - 3 * DAY);
const mk = (i, kind, extra = {}) => ({ id: 'r' + String(i).padStart(5, '0'), status: 'PENDING', matchType: kind === 'human' ? 'SIMILAR' : 'EXACT', differences: kind === 'human' ? ['questionText'] : [], existingQuestionId: 'q' + i, candidateQuestionId: 'c' + i, candidateJson: null, createdAt: new Date(old.getTime() + i), autoResolved: false, autoReason: null, ...extra });
let ok = true; const check = (name, cond, info = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!cond) ok = false; };

(async () => {
  // Scenario 1: 650 reviews that need a person come FIRST (oldest), then 40 decidable ones. Old code looked at 300 only.
  let rows = []; for (let i = 0; i < 650; i++) rows.push(mk(i, 'human')); for (let i = 650; i < 690; i++) rows.push(mk(i, 'exact'));
  let db = makeDb(rows, {}, {});
  const reviews = { resolveDecided: async (items) => { for (const it of items) { const r = rows.find(x => x.id === it.id); r.status = it.action === 'KEEP_NEW' ? 'KEPT_NEW' : it.action === 'KEEP_BOTH' ? 'KEPT_BOTH' : 'KEPT_EXISTING'; r.autoResolved = false; } return { doneIds: items.map(i => i.id), failedIds: [] }; } };
  let svc = new AutoPublishService(db, reviews);
  let s = await svc.run('manual');
  check('S1 decidable reviews behind 650 human ones are reached', s && s.keptExisting === 40, JSON.stringify(s));
  check('S1 human ones left untouched and counted', rows.filter(r => r.status === 'PENDING').length === 650 && s.needsHuman === 650);
  check('S1 decided ones are marked Auto', rows.filter(r => r.autoResolved).length === 40 && rows.find(r => r.autoResolved).autoReason.length > 5);

  // Scenario 2: Undo -> the job must not decide the same review again
  const r = rows.find(x => x.autoResolved);
  // emulate DuplicateReviewService.undo() claim
  Object.assign(r, { status: 'PENDING', autoResolved: false, autoReason: util.AUTO_UNDONE });
  const before = JSON.stringify(r);
  s = await svc.run('manual');
  check('S2 undone review is NOT auto-decided again', rows.find(x => x.id === r.id).status === 'PENDING' && JSON.stringify(rows.find(x => x.id === r.id)) === before, JSON.stringify(s));
  const pv = await svc.preview();
  check('S2 preview does not count the undone one as ready', pv.keepExisting === 0 && pv.due === 650, JSON.stringify(pv));

  // Scenario 3: cap per run (350 decidable, MAX 300) -> 300 now, 50 next run
  rows = []; for (let i = 0; i < 350; i++) rows.push(mk(i, 'exact')); db = makeDb(rows, {}, {});
  const reviews3 = { resolveDecided: async (items) => { for (const it of items) { const x = rows.find(y => y.id === it.id); x.status = 'KEPT_EXISTING'; } return { doneIds: items.map(i => i.id), failedIds: [] }; } };
  svc = new AutoPublishService(db, reviews3);
  s = await svc.run('manual'); check('S3 first run decides 300', s.keptExisting === 300, JSON.stringify(s));
  s = await svc.run('manual'); check('S3 second run decides the remaining 50', s.keptExisting === 50, JSON.stringify(s));
  s = await svc.run('manual'); check('S3 third run: nothing due -> null', s === null);

  // Scenario 4: scan limit 3000: 3100 human then 5 decidable -> the 5 are NOT reached this run (documented limit), no crash
  rows = []; for (let i = 0; i < 3100; i++) rows.push(mk(i, 'human')); for (let i = 3100; i < 3105; i++) rows.push(mk(i, 'exact')); db = makeDb(rows, {}, {});
  svc = new AutoPublishService(db, reviews3);
  s = await svc.run('manual'); check('S4 stops after SCAN_MAX without crashing', s && s.keptExisting === 0 && s.needsHuman === 3000, JSON.stringify(s));
  console.log(ok ? 'ALL OK' : 'SOME FAILED'); process.exitCode = ok ? 0 : 1;
})();
