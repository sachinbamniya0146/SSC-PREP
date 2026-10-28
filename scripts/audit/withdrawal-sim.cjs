// Simulation of the REAL withdrawal code against an in-memory fake database and a fake Cashfree Payouts API.
//   tsx scripts/audit/withdrawal-sim.cjs new     <repo>/backend   -> WithdrawalService + PayoutService + ReferralService (session 18)
//   tsx scripts/audit/withdrawal-sim.cjs old     <repo>/backend   -> the session-15 AdminController routes (shows the old bugs)
// Run from the backend folder of a tree so tsx picks up its tsconfig:  cd backend && tsx ../scripts/audit/withdrawal-sim.cjs new .
// Only @nestjs/common, @prisma/client, Prisma / audit services are stubbed. Everything else is the real file.
const Module = require('module');
const path = require('path');

const mode = process.argv[2];
const backend = path.resolve(process.argv[3] || '.');
const ok = { v: true };
const check = (name, cond, info = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!cond) ok.v = false; };

// ---------------------------------------------------------------- stubs for the framework
class HttpErr extends Error { constructor(m) { super(typeof m === 'string' ? m : JSON.stringify(m)); this.message = typeof m === 'string' ? m : JSON.stringify(m); } }
class BadRequestException extends HttpErr {}
class ConflictException extends HttpErr {}
class NotFoundException extends HttpErr {}
class ForbiddenException extends HttpErr {}
const noop = () => () => {};
const nestStub = new Proxy({
  BadRequestException, ConflictException, NotFoundException, ForbiddenException,
  Logger: class { log() {} warn() {} error() {} },
  OnModuleInit: class {}, OnModuleDestroy: class {},
  ParseUUIDPipe: class {},
}, { get: (t, k) => (k in t ? t[k] : noop) });
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === '@nestjs/common') return nestStub;
  if (req === '@prisma/client') return { Role: { ADMIN: 'ADMIN' }, Prisma: {} };
  if (/prisma\.service$/.test(req)) return { PrismaService: class {} };
  if (/audit-log\.service$/.test(req)) return { AuditLogService: class {} };
  if (/referral-config\.service$/.test(req)) return { ReferralConfigService: class {} };
  if (mode === 'old' && parent && /admin\.controller/.test(parent.filename || '') && req.startsWith('.')) {
    return new Proxy(function () {}, { get: (t, k) => (k === '__esModule' ? false : noop), apply: () => () => {} });
  }
  return origLoad.call(this, req, parent, ...rest);
};

// ---------------------------------------------------------------- fake database
const clone = (o) => JSON.parse(JSON.stringify(o), (k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v) ? new Date(v) : v));
function matches(row, w, db) {
  if (!w) return true;
  for (const [k, c] of Object.entries(w)) {
    if (k === 'OR') { if (!c.some((o) => matches(row, o, db))) return false; continue; }
    if (k === 'user') { const u = db.t.user.find((x) => x.id === row.userId); if (!matches(u || {}, c, db)) return false; continue; }
    const v = row[k];
    if (c === null) { if (v !== null && v !== undefined) return false; continue; }
    if (c instanceof Date) { if (!(v instanceof Date) || v.getTime() !== c.getTime()) return false; continue; }
    if (typeof c === 'object') {
      if ('in' in c && !c.in.includes(v)) return false;
      if ('not' in c) { if (c.not === null ? (v === null || v === undefined) : v === c.not) return false; }
      if ('gte' in c && !(v >= c.gte)) return false;
      if ('lte' in c && !(v <= c.lte)) return false;
      if ('contains' in c && !String(v ?? '').toLowerCase().includes(String(c.contains).toLowerCase())) return false;
      continue;
    }
    if (v !== c) return false;
  }
  return true;
}
function applyData(row, data) {
  for (const [k, d] of Object.entries(data)) {
    if (d === undefined) continue;
    if (d && typeof d === 'object' && !(d instanceof Date)) {
      if ('increment' in d) row[k] = (row[k] || 0) + d.increment;
      else if ('decrement' in d) row[k] = (row[k] || 0) - d.decrement;
      continue;
    }
    row[k] = d;
  }
}
function makeDb(seed) {
  const db = { t: clone(seed), ids: 0, lock: Promise.resolve(), yields: 0 };
  const tick = () => new Promise((r) => setImmediate(r)); // every call yields, so concurrent requests really interleave
  const table = (name, extra = {}) => ({
    findUnique: async ({ where, include, select }) => {
      await tick();
      const key = Object.keys(where)[0];
      const r = db.t[name].find((x) => x[key] === where[key]); if (!r) return null;
      const out = { ...r };
      if (include?.user) out.user = { ...db.t.user.find((u) => u.id === r.userId) };
      return select ? Object.fromEntries(Object.keys(select).map((k) => [k, out[k]])) : out;
    },
    findFirst: async ({ where, select }) => { await tick(); const r = db.t[name].find((x) => matches(x, where, db)); if (!r) return null; return select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : { ...r }; },
    findMany: async ({ where, orderBy, take, include, select } = {}) => {
      await tick();
      let rows = db.t[name].filter((x) => matches(x, where, db)).map((x) => ({ ...x }));
      const ob = Array.isArray(orderBy) ? orderBy[0] : orderBy;
      if (ob) { const [f, d] = Object.entries(ob)[0]; if (typeof d === 'string') rows.sort((a, b) => (a[f] - b[f]) * (d === 'asc' ? 1 : -1)); }
      if (take) rows = rows.slice(0, take);
      if (include?.user) rows = rows.map((r) => ({ ...r, user: { ...db.t.user.find((u) => u.id === r.userId) } }));
      if (select) rows = rows.map((r) => Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])));
      return rows;
    },
    count: async ({ where } = {}) => { await tick(); return db.t[name].filter((x) => matches(x, where, db)).length; },
    updateMany: async ({ where, data }) => { await tick(); let n = 0; for (const r of db.t[name]) if (matches(r, where, db)) { applyData(r, data); n++; } return { count: n }; },
    update: async ({ where, data }) => { await tick(); const key = Object.keys(where)[0]; const r = db.t[name].find((x) => x[key] === where[key]); if (!r) throw new Error('P2025 not found'); applyData(r, data); return { ...r }; },
    create: async ({ data, select }) => { await tick(); const r = { id: 'w' + String(++db.ids).padStart(8, '0') + '-aaaa-4bbb-8ccc-dddddddddddd'.slice(0, 28), createdAt: new Date(), status: 'REQUESTED', ...data }; db.t[name].push(r); return select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : { ...r }; },
    upsert: async ({ where, create }) => { await tick(); const key = Object.keys(where)[0]; let r = db.t[name].find((x) => x[key] === where[key]); if (!r) { r = { balanceInr: 0, pendingInr: 0, totalEarnedInr: 0, totalWithdrawnInr: 0, isSuspended: false, ...create }; db.t[name].push(r); } return { ...r }; },
    groupBy: async ({ by, where, _sum }) => {
      await tick(); const g = new Map();
      for (const r of db.t[name].filter((x) => matches(x, where, db))) {
        const k = by.map((b) => r[b]).join('|'); const cur = g.get(k) || { ...Object.fromEntries(by.map((b) => [b, r[b]])), _count: { _all: 0 }, _sum: { amountInr: 0 } };
        cur._count._all++; if (_sum) cur._sum.amountInr += r.amountInr || 0; g.set(k, cur);
      }
      return [...g.values()];
    },
    aggregate: async ({ where, _sum }) => {
      await tick(); const rows = db.t[name].filter((x) => matches(x, where, db));
      const s = {}; if (_sum) for (const f of Object.keys(_sum)) s[f] = rows.reduce((a, r) => a + (r[f] || 0), 0);
      return { _sum: s, _count: { _all: rows.length } };
    },
    ...extra,
  });
  Object.assign(db, {
    withdrawalRequest: table('withdrawalRequest'), referralWallet: table('referralWallet'), referral: table('referral'),
    payoutMethod: table('payoutMethod'), user: table('user'),
    referralEarning: { findMany: async () => [] },
    $queryRaw: async () => [],
    // an interactive transaction: one at a time (like row locks) and all-or-nothing
    $transaction: async (arg) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      const prev = db.lock; let release; db.lock = new Promise((r) => (release = r)); await prev;
      const snap = clone(db.t);
      try { return await arg(db); } catch (e) { db.t = snap; throw e; } finally { release(); }
    },
  });
  return db;
}

// ---------------------------------------------------------------- fake Cashfree Payouts
function makeCashfree() {
  const cf = { transfers: new Map(), beneficiaries: new Set(), calls: [], postMode: 'ok', nextStatus: 'RECEIVED' };
  global.fetch = async (url, init) => {
    const u = new URL(url); const p = u.pathname.replace(/^\/payout/, ''); const method = init.method; const body = init.body ? JSON.parse(init.body) : {};
    cf.calls.push(method + ' ' + p);
    const res = (status, json) => ({ status, ok: status >= 200 && status < 300, json: async () => json });
    if (p === '/beneficiary' && method === 'POST') { if (cf.beneficiaries.has(body.beneficiary_id)) return res(409, { code: 'beneficiary_id_already_exists', message: 'exists' }); cf.beneficiaries.add(body.beneficiary_id); return res(200, { status: 'VERIFIED' }); }
    if (p === '/transfers' && method === 'GET') { const t = cf.transfers.get(u.searchParams.get('transfer_id')); return t ? res(200, t) : res(404, { type: 'invalid_request_error', code: 'transfer_id_not_found', message: 'transfer_id does not exist' }); }
    if (p === '/transfers' && method === 'POST') {
      if (cf.postMode === 'dropBefore') throw new Error('socket hang up');
      if (cf.postMode === 'http500') return res(500, { message: 'internal error' });
      if (cf.postMode === 'refuse422') return res(422, { type: 'invalid_request_error', code: 'beneficiary_instrument_invalid', message: 'bank account is invalid' });
      if (cf.transfers.has(body.transfer_id)) return res(200, { ...cf.transfers.get(body.transfer_id), status: 'REJECTED', status_code: 'DUPLICATE_TRANSFER' });
      const t = { transfer_id: body.transfer_id, cf_transfer_id: 'CF' + (cf.transfers.size + 1), status: cf.nextStatus, status_code: '', transfer_amount: body.transfer_amount };
      cf.transfers.set(body.transfer_id, t);
      if (cf.postMode === 'dropResponse') throw new Error('timeout after the transfer was created');
      return res(200, t);
    }
    return res(500, { message: 'unknown ' + method + ' ' + p });
  };
  return cf;
}

const seed = () => ({
  user: [
    { id: 'u1', fullName: 'Rahul Sharma', email: 'rahul@example.com', phone: '+91 98765 43210', isSuspended: false },
    { id: 'u2', fullName: 'Priya Singh', email: 'priya@example.com', phone: '9123456780', isSuspended: false },
  ],
  referralWallet: [
    { id: 'wl1', userId: 'u1', balanceInr: 300, pendingInr: 0, totalEarnedInr: 500, totalWithdrawnInr: 0, isSuspended: false },
    { id: 'wl2', userId: 'u2', balanceInr: 1000, pendingInr: 0, totalEarnedInr: 1000, totalWithdrawnInr: 0, isSuspended: false },
  ],
  referral: [1, 2, 3].map((i) => ({ id: 'rf' + i, referrerId: 'u2', refereeId: 'x' + i, status: 'PAIDED', flagReason: i === 1 ? 'SAME_DEVICE' : null })),
  payoutMethod: [{ userId: 'u2', type: 'UPI', upiId: 'priya@okhdfcbank', bankAccountNo: null, bankIfsc: null, bankAccountName: null }],
  withdrawalRequest: [],
});
let seq = 0;
const addWd = (db, o = {}) => { const id = '00000000-0000-4000-8000-' + String(++seq).padStart(12, '0'); const r = { id, userId: 'u1', amountInr: 200, status: 'REQUESTED', payoutMethodType: 'UPI', upiId: 'rahul@okicici', bankAccountNo: null, bankIfsc: null, bankAccountName: null, paymentRef: null, createdAt: new Date(Date.now() - seq * 1000), processedAt: null, ...o }; db.t.withdrawalRequest.push(r); return r; };
const wd = (db, id) => db.t.withdrawalRequest.find((x) => x.id === id);
const wallet = (db, uid = 'u1') => db.t.referralWallet.find((x) => x.userId === uid);
const settle = async (ps) => (await Promise.allSettled(ps)).map((r) => (r.status === 'fulfilled' ? 'ok' : 'err:' + String(r.reason.message).slice(0, 60)));
const okCount = (a) => a.filter((x) => x === 'ok').length;

// ================================================================= NEW CODE
async function runNew() {
  delete process.env.CASHFREE_PAYOUT_CLIENT_ID; delete process.env.CASHFREE_PAYOUT_CLIENT_SECRET;
  const { PayoutService } = require(path.join(backend, 'src/referral/payout.service.ts'));
  const { WithdrawalService } = require(path.join(backend, 'src/referral/withdrawal.service.ts'));
  const { ReferralService } = require(path.join(backend, 'src/referral/referral.service.ts'));
  const { DEFAULT_REFERRAL_CONFIG } = require(path.join(backend, 'src/referral/referral-config.ts'));
  const audits = []; const auditLog = { log: async (a) => { audits.push(a.action); } };
  const manual = new PayoutService();
  process.env.CASHFREE_PAYOUT_CLIENT_ID = 'id'; process.env.CASHFREE_PAYOUT_CLIENT_SECRET = 'secret';
  const live = new PayoutService();
  check('M0 manual mode when keys are missing, live mode when set', manual.isConfigured() === false && live.isConfigured() === true);

  // ---- manual mode ----
  {
    const db = makeDb(seed()); const svc = new WithdrawalService(db, manual, auditLog);
    const w = addWd(db);
    const a = await svc.approve('admin1', w.id);
    check('M1 approve = sanction (nothing paid yet)', wd(db, w.id).status === 'APPROVED' && wd(db, w.id).approvedAt && wd(db, w.id).approvedById === 'admin1' && wallet(db).totalWithdrawnInr === 0 && a.autoPayout === false);
    let r = await settle([svc.markPaid('admin1', w.id, '412345678901')]);
    check('M2 mark paid with UTR -> PAID, wallet counter +200 once, balance untouched', r[0] === 'ok' && wd(db, w.id).status === 'PAID' && wd(db, w.id).paymentRef === '412345678901' && wd(db, w.id).paidAt && wallet(db).totalWithdrawnInr === 200 && wallet(db).balanceInr === 300);

    const w2 = addWd(db); await svc.approve('admin1', w2.id);
    r = await settle([svc.markPaid('admin1', w2.id, 'UTR000000AA'), svc.markPaid('admin1', w2.id, 'UTR000000AA'), svc.markPaid('admin1', w2.id, 'UTR000000BB')]);
    check('M3 triple click / two admins on "Mark paid": exactly one wins, counter +200 once', okCount(r) === 1 && wallet(db).totalWithdrawnInr === 400, JSON.stringify(r));

    const w3 = addWd(db); await svc.approve('admin1', w3.id);
    r = await settle([svc.markPaid('admin1', w3.id, '412345678901')]);
    check('M4 same UTR on a different withdrawal is refused', r[0].startsWith('err:') && wd(db, w3.id).status === 'APPROVED', r[0]);
    r = await settle([svc.markPaid('admin1', w3.id, 'ab')]);
    check('M5 too-short UTR is refused', r[0].startsWith('err:') && wd(db, w3.id).status === 'APPROVED');
    const w4 = addWd(db);
    r = await settle([svc.markPaid('admin1', w4.id, 'UTR1234567')]);
    check('M6 cannot mark paid before the sanction', r[0].startsWith('err:') && wd(db, w4.id).status === 'REQUESTED', r[0]);

    // refunds happen once
    const bal0 = wallet(db).balanceInr;
    r = await settle([svc.reject('admin1', w4.id, 'wrong UPI'), svc.reject('admin1', w4.id, 'wrong UPI'), svc.reject('admin1', w4.id, 'wrong UPI')]);
    check('M7 triple click on Reject refunds exactly once', okCount(r) === 1 && wallet(db).balanceInr === bal0 + 200 && wd(db, w4.id).status === 'REJECTED', JSON.stringify(r) + ' balance ' + wallet(db).balanceInr);
    r = await settle([svc.reject('admin1', w4.id, 'again')]);
    check('M8 reject of an already rejected request refuses and does not refund again', r[0].startsWith('err:') && wallet(db).balanceInr === bal0 + 200);
    r = await settle([svc.reject('admin1', w.id, 'late')]);
    check('M9 a PAID request can never be rejected / refunded', r[0].startsWith('err:') && wd(db, w.id).status === 'PAID' && wallet(db).balanceInr === bal0 + 200);
    r = await settle([svc.reject('admin1', w3.id, '  ')]);
    check('M10 reject needs a reason', r[0].startsWith('err:') && wd(db, w3.id).status === 'APPROVED');
    const bal1 = wallet(db).balanceInr;
    r = await settle([svc.reject('admin1', w3.id, 'UTR was wrong, cancel')]);
    check('M11 a sanction can be taken back before paying (refund once)', r[0] === 'ok' && wd(db, w3.id).status === 'REJECTED' && wallet(db).balanceInr === bal1 + 200);

    // student cancel racing admin reject
    const w5 = addWd(db); const bal2 = wallet(db).balanceInr;
    const refSvc = new ReferralService(db, { get: async () => DEFAULT_REFERRAL_CONFIG });
    r = await settle([svc.reject('admin1', w5.id, 'not valid'), refSvc.cancelWithdrawal('u1', w5.id), refSvc.cancelWithdrawal('u1', w5.id)]);
    check('M12 student Cancel racing admin Reject refunds exactly once', okCount(r) === 1 && wallet(db).balanceInr === bal2 + 200, JSON.stringify(r));
    const w6 = addWd(db); await svc.approve('admin1', w6.id);
    r = await settle([refSvc.cancelWithdrawal('u1', w6.id)]);
    check('M13 student cannot cancel after the sanction', r[0].startsWith('err:') && wd(db, w6.id).status === 'APPROVED');
    const w7 = addWd(db, { userId: 'u2', amountInr: 100 });
    r = await settle([refSvc.cancelWithdrawal('u1', w7.id)]);
    check('M14 student cannot cancel somebody else\'s request', r[0].startsWith('err:') && wd(db, w7.id).status === 'REQUESTED');

    // double approve
    const w8 = addWd(db);
    r = await settle([svc.approve('admin1', w8.id), svc.approve('admin2', w8.id)]);
    check('M15 two admins pressing Approve at once: one sanction', okCount(r) === 1 && wd(db, w8.id).status === 'APPROVED', JSON.stringify(r));

    // frozen wallet
    const w9 = addWd(db, { userId: 'u2', amountInr: 150 }); wallet(db, 'u2').isSuspended = true;
    r = await settle([svc.approve('admin1', w9.id)]);
    check('M16 a frozen wallet cannot be sanctioned (reject instead)', r[0].startsWith('err:') && wd(db, w9.id).status === 'REQUESTED', r[0]);
    wallet(db, 'u2').isSuspended = false;

    // audit failure must not undo the money step
    const noisy = new WithdrawalService(db, manual, { log: async () => { throw new Error('audit table down'); } });
    const w10 = addWd(db, { userId: 'u2', amountInr: 120 });
    r = await settle([noisy.approve('admin1', w10.id)]);
    check('M17 a failing audit log does not fail the sanction', r[0] === 'ok' && wd(db, w10.id).status === 'APPROVED');

    // pay / check without Cashfree
    r = await settle([svc.pay('admin1', w10.id)]);
    check('M18 "Send via Cashfree" is refused when Cashfree is not configured', r[0].startsWith('err:') && wd(db, w10.id).status === 'APPROVED');

    // stats
    const st = await svc.stats();
    const count = (s) => db.t.withdrawalRequest.filter((x) => x.status === s).length;
    const sum = (ss) => Math.round(db.t.withdrawalRequest.filter((x) => ss.includes(x.status)).reduce((a, x) => a + x.amountInr, 0) * 100) / 100;
    check('M19 stats equal the table (counts and rupees per bucket)', st.awaiting.count === count('REQUESTED') && st.sanctioned.count === count('APPROVED') && st.paid.count === count('PAID') && st.rejected.count === count('REJECTED') + count('FAILED')
      && st.paid.amountInr === sum(['PAID']) && st.sanctioned.amountInr === sum(['APPROVED']) && st.sanctionedTotal.amountInr === sum(['APPROVED', 'PROCESSING', 'PAID']) && st.toPay.amountInr === sum(['APPROVED', 'PROCESSING']), JSON.stringify({ a: st.awaiting, s: st.sanctioned, p: st.paid, r: st.rejected }));
    check('M20 stats: wallet counters match the paid rows (no mismatch)', st.mismatch === null && st.payoutMode === 'MANUAL', JSON.stringify(st.mismatch));
    wallet(db).totalWithdrawnInr += 50;
    const st2 = await svc.stats();
    check('M21 stats: a hand-edited wallet counter is flagged', st2.mismatch && st2.mismatch.differenceInr === 50, JSON.stringify(st2.mismatch));
    wallet(db).totalWithdrawnInr -= 50;
    check('M22 stats: paid today counts the ones paid just now', st.paidToday.count === st.paid.count && st.paidToday.amountInr === st.paid.amountInr);

    // lists
    const q1 = await svc.list('APPROVED', ''); const q2 = await svc.list(undefined, 'priya'); const q3 = await svc.list('not-a-status', '');
    check('M23 list filters by status, searches by name, ignores a bogus status', q1.every((x) => x.status === 'APPROVED') && q2.length > 0 && q2.every((x) => x.user.fullName === 'Priya Singh') && q3.length === db.t.withdrawalRequest.length);
    check('M24 list tells the admin how many of the referrer\'s friends are flagged', q2.every((x) => x.flaggedFriends === 1), JSON.stringify(q2.map((x) => x.flaggedFriends)));

    // student request: one open request, never more than the balance
    const db2 = makeDb(seed()); const rs = new ReferralService(db2, { get: async () => DEFAULT_REFERRAL_CONFIG });
    r = await settle([rs.requestWithdrawal('u2', 400), rs.requestWithdrawal('u2', 400), rs.requestWithdrawal('u2', 400)]);
    check('M25 three taps on Withdraw: one request, balance reduced once', okCount(r) === 1 && db2.t.withdrawalRequest.length === 1 && wallet(db2, 'u2').balanceInr === 600, JSON.stringify(r) + ' bal ' + wallet(db2, 'u2').balanceInr);
    const mine = await rs.getMyWithdrawals('u2');
    check('M26 student list: no bank internals, no admin ids', mine.length === 1 && !('bankAccountNo' in mine[0]) && !('approvedById' in mine[0]) && !('cashfreeTransferId' in mine[0]));
    const f = addWd(db2, { userId: 'u2', status: 'FAILED', adminNote: 'Cashfree: REJECTED / ACCOUNT_BLOCKED secret detail' });
    const p = addWd(db2, { userId: 'u2', status: 'PAID', paymentRef: 'UTR998877', adminNote: null });
    const a2 = addWd(db2, { userId: 'u2', status: 'APPROVED', paymentRef: 'LEAK', adminNote: 'internal' });
    const mine2 = await rs.getMyWithdrawals('u2'); const byId = Object.fromEntries(mine2.map((x) => [x.id, x]));
    check('M27 student sees a fixed sentence for FAILED (no gateway text), the UTR only when PAID, no internal notes', !/Cashfree|secret/.test(byId[f.id].note) && byId[p.id].paymentRef === 'UTR998877' && byId[a2.id].paymentRef === null && byId[a2.id].note === null);
  }

  // ---- Cashfree mode ----
  {
    const cf = makeCashfree(); const db = makeDb(seed()); const svc = new WithdrawalService(db, live, auditLog);
    // happy path
    const w = addWd(db); await svc.approve('admin1', w.id);
    let r = await svc.pay('admin1', w.id);
    check('C1 pay -> PROCESSING (Cashfree "RECEIVED"), not PAID yet, money not refunded', r.status === 'PROCESSING' && wd(db, w.id).status === 'PROCESSING' && wd(db, w.id).gatewayStatus === 'RECEIVED' && wallet(db).totalWithdrawnInr === 0 && wallet(db).balanceInr === 300);
    cf.transfers.get(Object.keys([...cf.transfers.keys()])[0] && [...cf.transfers.keys()][0]).status = 'SUCCESS';
    cf.transfers.get([...cf.transfers.keys()][0]).transfer_utr = 'CFUTR0001';
    await svc.tick();
    check('C2 status job: Cashfree says SUCCESS -> PAID with its UTR, counter +200 once', wd(db, w.id).status === 'PAID' && wd(db, w.id).paymentRef === 'CFUTR0001' && wallet(db).totalWithdrawnInr === 200);
    await svc.tick(); await svc.tick();
    check('C3 running the job again changes nothing', wallet(db).totalWithdrawnInr === 200 && wd(db, w.id).status === 'PAID');
    let e = await settle([svc.pay('admin1', w.id)]);
    check('C4 a paid request cannot be sent again', e[0].startsWith('err:') && cf.transfers.size === 1);

    // double click on Send
    cf.calls.length = 0; const w2 = addWd(db); await svc.approve('admin1', w2.id);
    e = await settle([svc.pay('admin1', w2.id), svc.pay('admin2', w2.id), svc.pay('admin1', w2.id)]);
    check('C5 triple click on Send creates ONE transfer', okCount(e) === 1 && cf.calls.filter((c) => c === 'POST /transfers').length === 1 && cf.transfers.size === 2, JSON.stringify(e) + ' ' + cf.calls.join(','));

    // Cashfree fails later
    cf.transfers.get(buildId(w2.id)).status = 'FAILED'; const bal = wallet(db).balanceInr;
    await svc.tick(); await svc.tick();
    check('C6 Cashfree says FAILED -> FAILED, amount back once (even if the job runs twice)', wd(db, w2.id).status === 'FAILED' && wallet(db).balanceInr === bal + 200 && wallet(db).totalWithdrawnInr === 200, 'bal ' + wallet(db).balanceInr);

    // answer lost AFTER Cashfree created the transfer: must NOT refund, must NOT send twice
    const w3 = addWd(db); await svc.approve('admin1', w3.id); cf.postMode = 'dropResponse'; const bal3 = wallet(db).balanceInr;
    r = await svc.pay('admin1', w3.id);
    check('C7 answer lost after sending: stays PROCESSING, says "do not pay again", NO refund', r.uncertain === true && wd(db, w3.id).status === 'PROCESSING' && wallet(db).balanceInr === bal3, JSON.stringify(r));
    cf.postMode = 'ok'; cf.transfers.get(buildId(w3.id)).status = 'SUCCESS';
    cf.calls.length = 0; await svc.tick();
    check('C8 the job later finds it succeeded -> PAID, still no refund, no second transfer', wd(db, w3.id).status === 'PAID' && wallet(db).balanceInr === bal3 && !cf.calls.includes('POST /transfers'), cf.calls.join(','));

    // answer lost BEFORE Cashfree got it
    const w4 = addWd(db); await svc.approve('admin1', w4.id); cf.postMode = 'dropBefore'; const bal4 = wallet(db).balanceInr;
    r = await svc.pay('admin1', w4.id); cf.postMode = 'ok';
    check('C9 request never arrived: PROCESSING, no refund', r.uncertain === true && wd(db, w4.id).status === 'PROCESSING' && wallet(db).balanceInr === bal4);
    r = await svc.checkStatus('admin1', w4.id);
    check('C10 checking too early: still PROCESSING (could be a short delay)', r.status === 'PROCESSING');
    wd(db, w4.id).processedAt = new Date(Date.now() - 11 * 60_000);
    r = await svc.checkStatus('admin1', w4.id);
    check('C11 not known to Cashfree after 10 min: back to SANCTIONED, no refund', r.status === 'APPROVED' && wd(db, w4.id).status === 'APPROVED' && wallet(db).balanceInr === bal4, JSON.stringify(r));
    r = await svc.pay('admin1', w4.id);
    check('C12 sending again works and creates the transfer once', r.status === 'PROCESSING' && cf.transfers.has(buildId(w4.id)));

    // 5xx
    const w5 = addWd(db); await svc.approve('admin1', w5.id); cf.postMode = 'http500'; const bal5 = wallet(db).balanceInr;
    r = await svc.pay('admin1', w5.id); cf.postMode = 'ok';
    check('C13 Cashfree 500: uncertain, stays PROCESSING, no refund', r.uncertain === true && wd(db, w5.id).status === 'PROCESSING' && wallet(db).balanceInr === bal5);

    // clear refusal
    const w6 = addWd(db); await svc.approve('admin1', w6.id); cf.postMode = 'refuse422'; const bal6 = wallet(db).balanceInr;
    e = await settle([svc.pay('admin1', w6.id)]); cf.postMode = 'ok';
    check('C14 Cashfree clearly refuses (bad account): FAILED, refunded once, admin told', e[0].startsWith('err:') && /refused/i.test(e[0]) && wd(db, w6.id).status === 'FAILED' && wallet(db).balanceInr === bal6 + 200, e[0]);

    // overrides
    const w7 = addWd(db); wd(db, w7.id).status = 'PROCESSING'; wd(db, w7.id).processedAt = new Date(); const bal7 = wallet(db).balanceInr;
    e = await settle([svc.reject('admin1', w7.id, 'cancel it')]);
    check('C15 a PROCESSING request cannot be rejected (money may be on its way)', e[0].startsWith('err:') && /on its way/.test(e[0]) && wallet(db).balanceInr === bal7);
    e = await settle([svc.markFailed('admin1', w7.id, 'dashboard shows failed'), svc.markFailed('admin1', w7.id, 'dashboard shows failed')]);
    check('C16 override "mark failed" refunds exactly once', okCount(e) === 1 && wallet(db).balanceInr === bal7 + 200 && wd(db, w7.id).status === 'FAILED');
    const w8 = addWd(db); wd(db, w8.id).status = 'PROCESSING';
    e = await settle([svc.markPaid('admin1', w8.id, 'HDFCN5202610280001')]);
    check('C17 override "mark paid" on a stuck PROCESSING request works once', e[0] === 'ok' && wd(db, w8.id).status === 'PAID');

    // stats with cashfree
    const st = await svc.stats();
    check('C18 stats: payout mode CASHFREE, wallet counters equal paid rows', st.payoutMode === 'CASHFREE' && st.mismatch === null, JSON.stringify(st.mismatch));
  }
  function buildId(id) { return 'WD_' + id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 35); }
}

// ================================================================= OLD CODE (session 15 routes in AdminController)
async function runOld() {
  const { AdminController } = require(path.join(backend, 'src/admin/admin.controller.ts'));
  const db = makeDb(seed()); const audits = [];
  const ctl = new AdminController(db, { log: async (a) => audits.push(a) }, {}, {}, { isConfigured: () => false }, {});
  const admin = { userId: 'admin1' };
  const refund = addWd(db);
  let r = await settle([ctl.rejectWithdrawal(admin, refund.id, { reason: 'x' }), ctl.rejectWithdrawal(admin, refund.id, { reason: 'x' }), ctl.rejectWithdrawal(admin, refund.id, { reason: 'x' })]);
  check('OLD1 triple click on Reject refunds exactly once', wallet(db).balanceInr === 500, 'balance is ' + wallet(db).balanceInr + ' (should be 500)');
  const failed = addWd(db, { status: 'FAILED' }); const before = wallet(db).balanceInr;
  r = await settle([ctl.rejectWithdrawal(admin, failed.id, { reason: 'x' })]);
  check('OLD2 rejecting an already FAILED (already refunded) request does not refund again', wallet(db).balanceInr === before, 'balance went ' + before + ' -> ' + wallet(db).balanceInr);
  const paid = addWd(db, { status: 'APPROVED' });
  r = await settle([ctl.markWithdrawalManuallyPaid(admin, paid.id, {}), ctl.markWithdrawalManuallyPaid(admin, paid.id, {})]);
  check('OLD3 two clicks on Mark paid count the payout once', wallet(db).totalWithdrawnInr === 200, 'total withdrawn is ' + wallet(db).totalWithdrawnInr + ' (should be 200)');
}

(async () => {
  if (mode === 'new') await runNew(); else if (mode === 'old') await runOld(); else { console.log('usage: new|old <backend dir>'); process.exit(2); }
  console.log(ok.v ? 'ALL OK' : 'SOME FAILED'); process.exitCode = ok.v ? 0 : 1;
})().catch((e) => { console.error('SIM CRASHED', e); process.exitCode = 3; });
