// S48 simulation: the REAL NotificationsService + NudgeService against an in-memory fake database and a fake push service.
// Proves: a message is stored once per key (two ticks / two containers = one message), one phone push per student per run,
// switches and pause are respected, admin send reaches only the chosen group, "news off" students are skipped,
// a link can only point inside the app, and the inbox counts / marks read per student.
// Run: cd backend && tsx --require ../scripts/audit/nest-stubs.cjs ../scripts/audit/notify-sim.cjs .
const path = require('path');
const root = path.resolve(process.argv[2] || '.');
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (/(^|\/)gamification\.service$/.test(req)) return { istDateKey: (d) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10), GamificationService: class {} };
  return origLoad.call(this, req, parent, ...rest);
};
const { NotificationsService, cleanUrl, audienceWhere } = require(path.join(root, 'src/notifications/notifications.service.ts'));
const { NudgeService } = require(path.join(root, 'src/notifications/nudge.service.ts'));

let fails = 0;
const check = (name, ok, extra) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok || !extra ? '' : '  -> ' + extra)); if (!ok) fails++; };

const NOW = new Date('2026-10-30T13:30:00Z'); // 19:00 IST
const day = (d) => new Date(`${d}T08:00:00Z`);
const users = [
  { id: 'u-streak', role: 'STUDENT', isSuspended: false, currentStreak: 6, lastPracticeDate: day('2026-10-29'), targetExamId: 'cgl' },
  { id: 'u-resume', role: 'STUDENT', isSuspended: false, currentStreak: 0, lastPracticeDate: day('2026-10-30'), targetExamId: 'gd' },
  { id: 'u-gone', role: 'STUDENT', isSuspended: false, currentStreak: 0, lastPracticeDate: day('2026-10-24'), targetExamId: 'cgl' },
  { id: 'u-off', role: 'STUDENT', isSuspended: false, currentStreak: 9, lastPracticeDate: day('2026-10-29'), targetExamId: 'cgl' },
  { id: 'u-susp', role: 'STUDENT', isSuspended: true, currentStreak: 9, lastPracticeDate: day('2026-10-29'), targetExamId: 'cgl' },
  { id: 'u-admin', role: 'ADMIN', isSuspended: false, currentStreak: 9, lastPracticeDate: day('2026-10-29'), targetExamId: null },
  { id: 'u-newsoff', role: 'STUDENT', isSuspended: false, currentStreak: 0, lastPracticeDate: null, targetExamId: 'cgl' },
];
const prefs = [
  { userId: 'u-off', weakTopic: true, streak: false, tests: true, news: true, remindHourIst: 19, pausedUntil: null },
  { userId: 'u-newsoff', weakTopic: true, streak: true, tests: true, news: false, remindHourIst: 19, pausedUntil: null },
];
const attempts = [{ id: 'att-1', userId: 'u-resume', status: 'IN_PROGRESS', startedAt: new Date('2026-10-30T12:40:00Z'), expiresAt: new Date('2026-10-30T14:40:00Z') }];
const weak = [{ userId: 'u-streak', status: 'WEAK', wrongCount: 5, chapterId: 'c-pct' }, { userId: 'u-gone', status: 'WEAK', wrongCount: 2, chapterId: 'c-pct' }];
const subs = [{ id: 's1', userId: 'u-streak' }, { id: 's2', userId: 'u-resume' }, { id: 's3', userId: 'u-gone' }];
const inbox = [];

function userMatch(u, w) {
  if (w.role && u.role !== w.role) return false;
  if (w.isSuspended !== undefined && u.isSuspended !== w.isSuspended) return false;
  if (w.targetExamId && u.targetExamId !== w.targetExamId) return false;
  if (w.id && w.id.in && !w.id.in.includes(u.id)) return false;
  if (w.OR && w.OR.length === 2 && 'lastPracticeDate' in w.OR[0] && w.OR[0].lastPracticeDate === null) {
    const cut = w.OR[1].lastPracticeDate.lt;
    if (!(u.lastPracticeDate === null || u.lastPracticeDate < cut)) return false;
  }
  if (w.weakTopicEntries && !weak.some((x) => x.userId === u.id && x.status === 'WEAK')) return false;
  return true;
}
const prisma = {
  user: {
    count: async ({ where }) => users.filter((u) => userMatch(u, where)).length,
    findMany: async ({ where, take, skip, cursor }) => {
      // the nudge ticker asks for "students who have used the app"; the fake treats everyone with a real student row as such
      let list = users.filter((u) => u.role === 'STUDENT' && !u.isSuspended && (where.OR && where.OR[0].testAttempts ? true : userMatch(u, where)));
      list = list.sort((a, b) => (a.id < b.id ? -1 : 1));
      if (cursor) list = list.slice(list.findIndex((u) => u.id === cursor.id) + (skip || 0));
      return list.slice(0, take).map((u) => ({ ...u, notificationPref: prefs.find((p) => p.userId === u.id) || null, testAttempts: attempts.filter((a) => a.userId === u.id && a.status === 'IN_PROGRESS') }));
    },
  },
  userWeakTopic: {
    groupBy: async ({ where }) => { const m = new Map(); for (const w of weak) if (where.userId.in.includes(w.userId) && w.status === where.status) m.set(w.userId, (m.get(w.userId) || 0) + 1); return [...m].map(([userId, n]) => ({ userId, _count: { _all: n } })); },
    findFirst: async ({ where }) => weak.find((w) => w.userId === where.userId) || null,
  },
  chapter: { findUnique: async () => ({ name: 'Percentage' }) },
  notificationPref: {
    findUnique: async ({ where }) => prefs.find((p) => p.userId === where.userId) || null,
    findMany: async ({ where }) => prefs.filter((p) => where.userId.in.includes(p.userId) && p.news === where.news),
    upsert: async ({ where, update, create }) => { let r = prefs.find((p) => p.userId === where.userId); if (r) Object.assign(r, update); else { r = { weakTopic: true, streak: true, tests: true, news: true, remindHourIst: 19, pausedUntil: null, ...create }; prefs.push(r); } return r; },
  },
  userNotification: {
    createMany: async ({ data }) => { let n = 0; for (const d of data) { if (inbox.some((x) => x.userId === d.userId && x.dedupeKey === d.dedupeKey)) continue; inbox.push({ id: 'n' + (inbox.length + 1), readAt: null, createdAt: new Date(), ...d }); n++; } return { count: n }; },
    findMany: async ({ where }) => inbox.filter((x) => x.userId === where.userId).sort((a, b) => b.createdAt - a.createdAt),
    count: async ({ where }) => inbox.filter((x) => x.userId === where.userId && (where.readAt === null ? !x.readAt : true)).length,
    updateMany: async ({ where, data }) => { let n = 0; for (const x of inbox) if (x.userId === where.userId && !x.readAt && (!where.id || where.id.in.includes(x.id))) { x.readAt = data.readAt; n++; } return { count: n }; },
  },
  pushSubscription: { count: async ({ where }) => subs.filter((s) => userMatch(users.find((u) => u.id === s.userId), where.user)).length },
};
const pushed = [];
const push = { pushEnabled: true, sendToUsers: async (ids, dto) => { pushed.push({ ids, dto }); return { sent: ids.filter((i) => subs.some((s) => s.userId === i)).length, failed: 0 }; } };

(async () => {
  const notes = new NotificationsService(prisma, push);
  const nudge = new NudgeService(prisma, notes);

  const made = await nudge.tick(NOW);
  const kinds = (id) => inbox.filter((x) => x.userId === id).map((x) => x.kind).sort().join(',');
  check('streak student gets STREAK (+ WEAK only on an even day)', /STREAK/.test(kinds('u-streak')), kinds('u-streak'));
  check('student with a test left open gets RESUME pointing at that attempt', inbox.some((x) => x.userId === 'u-resume' && x.kind === 'RESUME' && x.url === '/test?resume=att-1'));
  check('student idle 6 days gets COMEBACK', /COMEBACK/.test(kinds('u-gone')), kinds('u-gone'));
  check('streak switch off -> no STREAK', !/STREAK/.test(kinds('u-off')), kinds('u-off'));
  check('suspended student and admin get nothing', kinds('u-susp') === '' && kinds('u-admin') === '');
  check('tick reports what it created', made === inbox.length && made > 0, `${made} vs ${inbox.length}`);

  const pushesFirst = pushed.length;
  const again = await nudge.tick(NOW);
  check('second tick (second container) adds nothing', again === 0 && inbox.length === made, `${again}`);
  check('second tick sends no second push', pushed.length === pushesFirst);
  const perUser = {}; for (const p of pushed) for (const i of p.ids) perUser[i] = (perUser[i] || 0) + 1;
  check('at most ONE phone push per student per run', Object.values(perUser).every((n) => n <= 1), JSON.stringify(perUser));

  const early = await nudge.tick(new Date('2026-10-30T05:30:00Z')); // 11:00 IST, not anyone's hour
  check('outside the reminder hour only RESUME can fire (already sent) -> nothing new', early === 0, `${early}`);

  // pause
  await notes.updatePrefs('u-gone', { pauseDays: 3 });
  inbox.length = 0; pushed.length = 0;
  await nudge.tick(NOW);
  check('paused student gets nothing while paused', kinds('u-gone') === '', kinds('u-gone'));
  await notes.updatePrefs('u-gone', { pauseDays: 0 });
  const pr = await notes.getPrefs('u-gone');
  check('pause can be switched off again', pr.pausedUntil === null);
  check('bad reminder hour falls back to 19', (await notes.updatePrefs('u-gone', { remindHourIst: 99 })).remindHourIst === 19);

  // inbox
  const list = await notes.list('u-streak');
  check('inbox lists only my messages with unread count', list.items.every((x) => x.userId === 'u-streak') && list.unread === list.items.length);
  const first = list.items[0];
  check('another student cannot mark my message read', (await notes.markRead('u-resume', [first.id])).updated === 0);
  check('I can mark one read', (await notes.markRead('u-streak', [first.id])).updated === 1 && (await notes.unreadCount('u-streak')).unread === list.unread - 1);
  await notes.markAllRead('u-streak');
  check('mark all read', (await notes.unreadCount('u-streak')).unread === 0);

  // admin: call a group
  inbox.length = 0; pushed.length = 0;
  const cnt = await notes.audienceCount({ type: 'TARGET_EXAM', examId: 'cgl' });
  check('audience preview counts only active students of that exam', cnt.students === 4 && cnt.devices === 2, JSON.stringify(cnt)); // u-streak,u-gone,u-off,u-newsoff (not suspended)
  const sent = await notes.adminSend({ title: 'CGL mock live', body: 'Attempt now', url: '/mocks', audience: { type: 'TARGET_EXAM', examId: 'cgl' } });
  check('admin send stored one inbox message per reached student', inbox.length === sent.students && sent.students === 3, `${sent.students}`); // u-newsoff opted out
  check('news-off student skipped', !inbox.some((x) => x.userId === 'u-newsoff'));
  check('GD student not reached by a CGL audience', !inbox.some((x) => x.userId === 'u-resume'));
  check('push went to the reached students', sent.pushed === 2, `${sent.pushed}`);
  const weakAud = await notes.audienceCount({ type: 'HAS_WEAK' });
  check('HAS_WEAK audience', weakAud.students === 2, JSON.stringify(weakAud));
  const idle = await notes.audienceCount({ type: 'INACTIVE', days: 3 });
  check('INACTIVE 3 days audience counts the idle + never-practised', idle.students >= 2, JSON.stringify(idle));
  let threw = false; try { await notes.audienceCount({ type: 'TARGET_EXAM' }); } catch { threw = true; }
  check('TARGET_EXAM without an exam is refused', threw);
  let threw2 = false; try { await notes.adminSend({ title: ' ', body: 'x', audience: { type: 'ALL' } }); } catch { threw2 = true; }
  check('empty title refused', threw2);

  // links
  check('link must stay inside the app', cleanUrl('https://evil.com') === '/dashboard' && cleanUrl('//evil.com') === '/dashboard' && cleanUrl('javascript:alert(1)') === '/dashboard' && cleanUrl('/mocks?x=1') === '/mocks?x=1' && cleanUrl(undefined) === '/dashboard');
  check('audienceWhere never includes admins or suspended', audienceWhere({ type: 'ALL' }).role === 'STUDENT' && audienceWhere({ type: 'ALL' }).isSuspended === false);

  console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
