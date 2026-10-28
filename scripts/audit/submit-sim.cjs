// Simulation of the REAL TestsService.submitAttempt() against an in-memory fake database (session 21, 28 Oct 2026).
//   cd backend && tsx ../scripts/audit/submit-sim.cjs .            -> the tree you run it in (must print ALL OK)
//   cd <old-tree>/backend && tsx <new-tree>/scripts/audit/submit-sim.cjs .   -> the same checks against an older tree (session 20: FAILs)
// Only @nestjs/common, @prisma/client and the services that tests.service.ts imports are stubbed; tests.service.ts,
// common/marking.ts, common/section-plan.ts etc. are the real files. Run from the backend folder so tsx finds its tsconfig.
const Module = require('module');
const path = require('path');

const backend = path.resolve(process.argv[2] || '.');
let allOk = true;
const check = (name, cond, info = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!cond) allOk = false; };

class BadRequestException extends Error {}
const noop = () => () => {};
const nestStub = new Proxy({ BadRequestException, Logger: class { log() {} warn() {} error() {} } }, { get: (t, k) => (k in t ? t[k] : noop) });
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === '@nestjs/common') return nestStub;
  if (req === '@prisma/client') return { Prisma: {} };
  if (/study-plan-progress\.util$/.test(req)) return { applyAttemptToChapters: async () => undefined };
  if (/pyq-paper-builder$/.test(req)) return { legacyPaperCeiling: () => 0 };
  if (/(weak-topic|prisma|gamification|telegram|question-bank-practice)\.service$/.test(req)) {
    return new Proxy({}, { get: (t, k) => (k === '__esModule' ? false : class {}) });
  }
  return origLoad.call(this, req, parent, ...rest);
};
const { TestsService } = require(path.join(backend, 'src/tests/tests.service.ts'));

const tick = () => new Promise((r) => setImmediate(r)); // lets concurrent requests interleave between every DB call

function world(opts = {}) {
  const T0 = Date.now();
  const attempts = [{ id: 'a1', userId: 'u1', testTemplateId: 'tpl', status: 'IN_PROGRESS', startedAt: new Date(T0 - 60_000), expiresAt: new Date(T0 + 3_600_000), sectionPlan: null, lastSyncAt: null }];
  const answerRows = new Map(); // `${attemptId}:${questionId}` -> row
  const questions = [
    { id: 'q1', correctAnswer: 'A', marks: 2, negativeMarks: 0.5, examId: null, examTier: null, tierPaper: null, subject: { slug: 'reasoning' } },
    { id: 'q2', correctAnswer: 'B', marks: 2, negativeMarks: 0.5, examId: null, examTier: null, tierPaper: null, subject: { slug: 'reasoning' } },
    { id: 'q3', correctAnswer: 'C', marks: 2, negativeMarks: 0.5, examId: null, examTier: null, tierPaper: null, subject: { slug: 'reasoning' } },
  ];
  const template = { id: 'tpl', title: 'T', totalQuestions: 3, totalMarks: 6, durationMinutes: 60, examId: null, examPatternId: null, examTier: null, tierPaper: null };
  const stats = { xp: 0, upserts: 0, claims: 0, weak: 0, pdf: 0 };
  const find = (w) => attempts.find((x) => (!w.id || x.id === w.id) && (!w.userId || x.userId === w.userId) && (!w.status || x.status === w.status));
  const prisma = {
    testTemplate: { findUnique: async () => { await tick(); return template; } },
    examPattern: { findMany: async () => [], findUnique: async () => null },
    testAttempt: {
      findFirst: async ({ where }) => { await tick(); const a = find(where); return a ? { ...a } : null; },
      updateMany: async ({ where, data }) => {
        await tick();
        const a = find(where); // the conditional WHERE and the write happen in ONE step: no await in between (like one SQL UPDATE)
        if (!a) return { count: 0 };
        Object.assign(a, data); stats.claims++;
        return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }) => {
        await tick();
        const a = attempts.find((x) => x.id === where.id);
        const answers = [...answerRows.values()].filter((r) => r.testAttemptId === where.id).map(({ questionId, selectedOption, isCorrect, timeSpentSeconds }) => ({ questionId, selectedOption, isCorrect, timeSpentSeconds }));
        return { ...a, testTemplate: { id: 'tpl', title: 'T', totalQuestions: 3, totalMarks: 6 }, answers };
      },
    },
    attemptAnswer: {
      findMany: async ({ where }) => { await tick(); return [...answerRows.values()].filter((r) => r.testAttemptId === where.testAttemptId); },
      upsert: async ({ where, create, update }) => {
        await tick();
        if (opts.failUpsertOnce && !opts._failed) { opts._failed = true; throw new Error('db down'); }
        const k = where.testAttemptId_questionId.testAttemptId + ':' + where.testAttemptId_questionId.questionId;
        stats.upserts++;
        answerRows.set(k, answerRows.has(k) ? { ...answerRows.get(k), ...update } : { ...create });
        return {};
      },
    },
    question: { findMany: async ({ where }) => { await tick(); return questions.filter((q) => where.id.in.includes(q.id)); } },
  };
  const svc = new TestsService(
    prisma,
    { awardTestXp: async () => { stats.xp++; } },
    { getTelegramUserByUserId: async () => { stats.pdf++; return null; } },
    {},
    { recordAnswers: async () => { stats.weak++; } },
  );
  return { svc, attempts, answerRows, stats };
}

const A = [{ questionId: 'q1', selectedOption: 'A' }, { questionId: 'q2', selectedOption: 'D' }, { questionId: 'q3', selectedOption: null }]; // 1 right, 1 wrong, 1 skipped = 2 - 0.5 = 1.5
const B = [{ questionId: 'q1', selectedOption: 'D' }, { questionId: 'q2', selectedOption: 'B' }, { questionId: 'q3', selectedOption: 'C' }]; // a DIFFERENT payload (a stale retry / another tab) = would be 2+2-0.5... if it re-scored

(async () => {
  // 1. sequential duplicate: the retry after a lost response
  {
    const { svc, attempts, answerRows, stats } = world();
    const first = await svc.submitAttempt('u1', 'a1', { answers: A });
    check('first submit scores 1.5 (1 right, 1 wrong, 1 skipped)', first.score === 1.5 && first.totalCorrect === 1 && first.totalWrong === 1 && first.totalSkipped === 1, `score=${first.score}`);
    let second, err = null;
    try { second = await svc.submitAttempt('u1', 'a1', { answers: B }); } catch (e) { err = e; }
    check('second submit does NOT throw', !err, err ? `threw: ${err.message}` : '');
    if (second) {
      check('second submit returns the SAME finished result (score / counts / status)', second.score === 1.5 && second.totalCorrect === 1 && second.totalWrong === 1 && second.status === 'SUBMITTED', `score=${second.score}`);
      check('second submit says alreadySubmitted: true', second.alreadySubmitted === true);
      check('second submit has the same per-question answers as the first (payload B ignored)', JSON.stringify(second.answers.map((a) => [a.questionId, a.selectedOption]).sort()) === JSON.stringify(first.answers.map((a) => [a.questionId, a.selectedOption]).sort()));
      check('response shape matches (testTemplate + answers present)', !!second.testTemplate && Array.isArray(second.answers));
    }
    await tick(); await tick();
    check('XP awarded exactly once', stats.xp === 1, `xp=${stats.xp}`);
    check('weak-topic recording + PDF hook ran exactly once', stats.weak === 1 && stats.pdf === 1, `weak=${stats.weak} pdf=${stats.pdf}`);
    check('answer rows written once (3), not touched by the repeat', stats.upserts === 3, `upserts=${stats.upserts}`);
    check('stored attempt keeps the first score', attempts[0].score === 1.5 && attempts[0].status === 'SUBMITTED');
    check('stored answer for q1 is still A (not overwritten by payload B)', answerRows.get('a1:q1')?.selectedOption === 'A');
  }
  // 2. two submits at the same moment (double tap / two tabs / queue replay at the same time)
  {
    const { svc, attempts, stats } = world();
    const r = await Promise.allSettled([svc.submitAttempt('u1', 'a1', { answers: A }), svc.submitAttempt('u1', 'a1', { answers: A }), svc.submitAttempt('u1', 'a1', { answers: B })]);
    check('three simultaneous submits: all fulfilled', r.every((x) => x.status === 'fulfilled'), r.map((x) => x.status === 'rejected' ? x.reason.message : 'ok').join(' | '));
    const scores = r.filter((x) => x.status === 'fulfilled').map((x) => x.value.score);
    check('all three see the same score', scores.length === 3 && new Set(scores).size === 1, JSON.stringify(scores));
    await tick(); await tick();
    check('exactly one claim won, XP once', stats.claims === 1 && stats.xp === 1, `claims=${stats.claims} xp=${stats.xp}`);
    check('attempt is SUBMITTED once', attempts[0].status === 'SUBMITTED');
  }
  // 3. the winner's answer write fails: the attempt goes back to IN_PROGRESS so the retry can finish it (and only then XP)
  {
    const { svc, attempts, stats } = world({ failUpsertOnce: true });
    let err = null;
    try { await svc.submitAttempt('u1', 'a1', { answers: A }); } catch (e) { err = e; }
    check('failed answer write surfaces as an error', !!err);
    check('attempt is back to IN_PROGRESS after the failure', attempts[0].status === 'IN_PROGRESS');
    const retry = await svc.submitAttempt('u1', 'a1', { answers: A }).catch((e) => ({ err: e }));
    check('the retry completes and scores', !retry.err && retry.score === 1.5, retry.err ? retry.err.message : `score=${retry.score}`);
    await tick(); await tick();
    check('XP once in total', stats.xp === 1, `xp=${stats.xp}`);
  }
  // 4. someone else's attempt / unknown attempt stays refused
  {
    const { svc } = world();
    const other = await svc.submitAttempt('u2', 'a1', { answers: A }).then(() => null, (e) => e);
    check("another student cannot submit / read someone's attempt", !!other && /not found/i.test(other.message), other ? other.message : 'no error!');
    const none = await svc.submitAttempt('u1', 'nope', { answers: A }).then(() => null, (e) => e);
    check('unknown attempt id is refused', !!none && /not found/i.test(none.message));
  }
  console.log(allOk ? '\nALL OK' : '\nSOME CHECKS FAILED');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('SIM CRASHED', e); process.exit(2); });
