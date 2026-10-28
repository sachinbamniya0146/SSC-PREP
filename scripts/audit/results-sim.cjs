// Simulation of the REAL result / analysis code against an in-memory fake database (session 24, 28 Oct 2026, roadmap area 3).
//   cd backend && tsx ../scripts/audit/results-sim.cjs .            -> the tree you run it in (must print ALL OK)
//   cd <old-tree>/backend && tsx <new-tree>/scripts/audit/results-sim.cjs .   -> the same checks against the session-23 tree: FAILs
// Real files: tests.service.ts (submitAttempt, saveAnswers, saveAttempt, attemptDetail), rank.service.ts, test-stats.service.ts,
// bank.service.ts + review.service.ts (only their answer-reveal gate), marking-scheme.ts, common/marking.ts, rank.util.ts.
// Stubbed: @nestjs/common, @prisma/client and the services those files import. Run from the backend folder so tsx finds its tsconfig.
//
// Output lines:  PASS / FAIL = a rule that must hold (FAIL makes the script exit 1).
//                GAP        = a KNOWN weakness that is documented in AUDIT_RESULTS_ANALYSIS_OCT2026.md and NOT fixed yet; it is
//                             printed so nobody forgets it, and it does not fail the script. When a gap gets fixed, turn it into a check.
const Module = require('module');
const path = require('path');

const backend = path.resolve(process.argv[2] || '.');
let allOk = true;
let gaps = 0;
const check = (name, cond, info = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!cond) allOk = false; };
// gap(name, stillOpen): stillOpen = true while the weakness exists
const gap = (name, stillOpen, info = '') => { console.log((stillOpen ? 'GAP  ' : 'PASS ') + name + (info ? '  ' + info : '')); if (stillOpen) gaps++; };

class BadRequestException extends Error {}
class NotFoundException extends Error {}
const noop = () => () => {};
const nestStub = new Proxy(
  { BadRequestException, NotFoundException, ConflictException: class extends Error {}, Logger: class { log() {} warn() {} error() {} } },
  { get: (t, k) => (k in t ? t[k] : noop) },
);
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === '@nestjs/common') return nestStub;
  if (req === '@prisma/client') return { Prisma: {}, AttemptStatus: { SUBMITTED: 'SUBMITTED', IN_PROGRESS: 'IN_PROGRESS' } };
  if (/study-plan-progress\.util$/.test(req)) return { applyAttemptToChapters: async () => undefined };
  if (/pyq-paper-builder$/.test(req)) return { legacyPaperCeiling: () => 0 };
  if (/(weak-topic|prisma|gamification|telegram|question-bank-practice|features|search|admin|upload|bank-upload|monetization|referral)\.service$/.test(req) || /bank-upload|question-edit|meili/.test(req)) {
    return new Proxy({}, { get: (t, k) => (k === '__esModule' ? false : class {}) });
  }
  return origLoad.call(this, req, parent, ...rest);
};
const { TestsService } = require(path.join(backend, 'src/tests/tests.service.ts'));
const { RankService } = require(path.join(backend, 'src/tests/rank.service.ts'));
const { TestStatsService } = require(path.join(backend, 'src/tests/test-stats.service.ts'));
const { BankService } = require(path.join(backend, 'src/bank/bank.service.ts'));
const { ReviewService } = require(path.join(backend, 'src/review/review.service.ts'));
const { cacheClearAll } = require(path.join(backend, 'src/common/cache.ts'));

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

const T0 = Date.now();
const MIN = 60000;

function world() {
  cacheClearAll();
  const U = (id, fullName, role = 'STUDENT', state = 'Bihar') => ({ id, fullName, role, state, isSuspended: false });
  const users = [U('admin', 'Sachin Admin', 'ADMIN', 'Delhi'), U('mod', 'Meena Moderator', 'MODERATOR'), U('s1', 'Asha Kumari'), U('s2', 'Ravi Singh'), U('s3', 'Neha Gupta'), U('s5', 'Cheat Boy')];
  const userOf = (id) => users.find((u) => u.id === id);

  // MTS-like paper: Quant 2 Q x 2 marks, NO negative marking; Reasoning 2 Q x 3 marks, -1. Max 10. The stored template total (16) is stale.
  const template = { id: 'T1', title: 'MTS mock', type: 'MOCK', totalQuestions: 4, totalMarks: 16, durationMinutes: 60, examId: null, examPatternId: 'p1', examTier: null, tierPaper: null };
  const pattern = {
    id: 'p1', name: 'MTS test pattern', negativeMarks: 0.25, lockPreviousSections: false,
    sections: [
      { name: 'Quant', subjectSlug: 'quantitative_aptitude', questions: 2, marks: 4, durationMinutes: 0, negativeMarks: 0 },
      { name: 'Reasoning', subjectSlug: 'reasoning', questions: 2, marks: 6, durationMinutes: 0, negativeMarks: 1 },
    ],
  };
  const Q = (id, no, correct, slug) => ({
    id, questionNo: no, paperQuestionNo: no, examDate: null, questionText: 'Question ' + no, questionTextHindi: null,
    questionDiagramType: null, questionDiagramLabels: null, questionImageUrl: null,
    optionsJson: ['A', 'B', 'C', 'D'].map((k) => ({ key: k, text: 'opt ' + k })),
    correctAnswer: correct, explanation: 'because ' + no, explanationHindi: null, explanationSource: null,
    exam: { name: 'MTS' }, chapter: { name: 'Ch' }, subject: { name: slug === 'reasoning' ? 'Reasoning' : 'Quant', slug }, topic: null, subTopic: null,
    year: 2025, shift: 'S1', marks: 2, negativeMarks: 0.5, difficulty: null, examId: null, examTier: null, tierPaper: null,
  });
  const questions = [
    Q('q1', 1, 'A', 'quantitative_aptitude'), Q('q2', 2, 'B', 'quantitative_aptitude'), Q('q3', 3, 'C', 'reasoning'), Q('q4', 4, 'D', 'reasoning'),
    Q('q5', 5, 'A', 'reasoning'), Q('q6', 6, 'A', 'reasoning'), Q('q7', 7, 'A', 'reasoning'), // not part of the 4-question paper
  ];
  const attempts = [];
  const answerRows = [];
  let seq = 0;
  const mk = (id, userId, status, score, startMin, durMin, extra = {}) => {
    const a = {
      id, userId, testTemplateId: 'T1', status, score, totalCorrect: 0, totalWrong: 0, totalSkipped: 0, accuracyPercent: 50, rank: null, percentile: null,
      startedAt: new Date(T0 - 1e7 + startMin * MIN), submittedAt: status === 'IN_PROGRESS' ? null : new Date(T0 - 1e7 + (startMin + durMin) * MIN),
      expiresAt: new Date(T0 + 3_600_000), sectionPlan: null, lastSyncAt: null, ...extra,
    };
    a.user = userOf(userId);
    attempts.push(a);
    return a;
  };
  mk('a-admin', 'admin', 'SUBMITTED', 10, 0, 20);
  mk('a-mod', 'mod', 'SUBMITTED', 9, 1, 25);
  mk('a-s2', 's2', 'SUBMITTED', 5, 2, 30);
  mk('a-s2b', 's2', 'SUBMITTED', 10, 50, 20); // Ravi's RETAKE after seeing the answers
  mk('a-s1', 's1', 'IN_PROGRESS', 0, 3, 0);

  const withRel = (a, inc) => {
    const o = { ...a, user: a.user };
    if (inc && inc.testTemplate) o.testTemplate = { ...template };
    if (inc && inc.answers) {
      o.answers = answerRows.filter((r) => r.testAttemptId === a.id).map((r) => {
        const row = { ...r };
        if (inc.answers.include && inc.answers.include.question) row.question = questions.find((q) => q.id === r.questionId);
        return row;
      });
    }
    return o;
  };
  const stats = { xp: 0 };
  const prisma = {
    user: { findUnique: async ({ where }) => { const u = userOf(where.id); return u ? { ...u } : null; } },
    testTemplate: { findUnique: async ({ where }) => (where.id === 'T1' ? { ...template } : null) },
    examPattern: { findMany: async () => [], findUnique: async ({ where }) => (where.id === 'p1' ? { ...pattern } : null) },
    testAttemptStats: { upsert: async () => ({}) },
    questionBankSet: { findMany: async () => [] },
    dailyQuizAttempt: { findMany: async () => [] },
    testAttempt: {
      findFirst: async ({ where, include }) => { const a = attempts.find((x) => match(x, where)); return a ? withRel(a, include) : null; },
      findMany: async ({ where, orderBy, take }) => {
        let r = attempts.filter((x) => match(x, where));
        if (orderBy && orderBy.startedAt === 'asc') r = r.sort((x, y) => x.startedAt - y.startedAt);
        if (orderBy && orderBy.score === 'desc') r = r.sort((x, y) => y.score - x.score);
        return r.slice(0, take || 1e9).map((a) => ({ ...a, user: a.user }));
      },
      count: async ({ where }) => attempts.filter((x) => match(x, where)).length,
      aggregate: async ({ where }) => {
        const r = attempts.filter((x) => match(x, where));
        const avg = (f) => (r.length ? r.reduce((t, x) => t + f(x), 0) / r.length : null);
        return {
          _max: { score: r.length ? Math.max(...r.map((x) => x.score)) : null, accuracyPercent: r.length ? Math.max(...r.map((x) => x.accuracyPercent)) : null },
          _avg: { score: avg((x) => x.score), accuracyPercent: avg((x) => x.accuracyPercent) },
          _count: r.length,
        };
      },
      update: async ({ where, data }) => { const a = attempts.find((x) => x.id === where.id); Object.assign(a, data); return a; },
      updateMany: async ({ where, data }) => {
        const a = attempts.find((x) => match(x, where));
        if (!a) return { count: 0 };
        Object.assign(a, data);
        return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }) => {
        const a = attempts.find((x) => x.id === where.id);
        return { ...withRel(a, { testTemplate: true, answers: {} }), testTemplate: { id: 'T1', title: template.title, totalQuestions: 4, totalMarks: 16 }, answers: answerRows.filter((r) => r.testAttemptId === a.id).map(({ questionId, selectedOption, isCorrect, timeSpentSeconds }) => ({ questionId, selectedOption, isCorrect, timeSpentSeconds })) };
      },
      create: async ({ data }) => {
        const { answers, ...rest } = data;
        const a = { id: 'new' + ++seq, rank: null, percentile: null, startedAt: new Date(), expiresAt: null, sectionPlan: null, lastSyncAt: null, ...rest };
        a.user = userOf(a.userId);
        attempts.push(a);
        for (const r of (answers && answers.create) || []) answerRows.push({ testAttemptId: a.id, isMarkedForReview: false, ...r });
        return { ...withRel(a, { testTemplate: true, answers: {} }), testTemplate: { id: 'T1', title: template.title, totalQuestions: 4, totalMarks: 16 }, answers: answerRows.filter((r) => r.testAttemptId === a.id) };
      },
    },
    attemptAnswer: {
      findMany: async ({ where }) =>
        answerRows
          .map((r) => ({ ...r, testAttempt: attempts.find((a) => a.id === r.testAttemptId) }))
          .filter((r) => match(r, where))
          .map(({ testAttempt, ...r }) => r),
      upsert: async ({ where, create, update }) => {
        const k = where.testAttemptId_questionId;
        const row = answerRows.find((r) => r.testAttemptId === k.testAttemptId && r.questionId === k.questionId);
        if (row) Object.assign(row, update); else answerRows.push({ isMarkedForReview: false, ...create });
        return {};
      },
    },
    question: { findMany: async ({ where }) => questions.filter((q) => match(q, where)).map((q) => ({ ...q })) },
  };
  const svc = new TestsService(
    prisma,
    { awardTestXp: async () => { stats.xp++; } },
    { getTelegramUserByUserId: async () => null },
    {},
    { recordAnswers: async () => undefined },
  );
  svc.assertMockEntitled = async () => undefined; // entitlement is not what this sim is about
  const features = { assertEnabled: async () => undefined };
  return { prisma, svc, attempts, answerRows, questions, template, rank: new RankService(prisma, features), stats: new TestStatsService(prisma) };
}

const ask = (fn) => fn().then((v) => ({ v }), (e) => ({ err: e }));
const ALL4 = [{ questionId: 'q1', selectedOption: 'A' }, { questionId: 'q2', selectedOption: 'D' }, { questionId: 'q3', selectedOption: 'C' }, { questionId: 'q4', selectedOption: 'A' }];
const sumReview = (qs) => Math.round(qs.reduce((s, q) => s + (q.isCorrect ? q.marks : q.selectedOption ? -q.negativeMarks : 0), 0) * 100) / 100;

(async () => {
  // =====================================================================================================================
  // 1. score reconciliation:  score = right x marks - wrong x negative  (Quant has NO negative marking, Reasoning -1)
  // =====================================================================================================================
  {
    const w = world();
    // while running, the review (answer key + explanations) must not exist
    const running = await ask(() => w.svc.attemptDetail('s1', 'a-s1'));
    check('review of a RUNNING attempt is refused (no answer key before the attempt is finished)', !!running.err && /in progress/i.test(running.err.message), running.err ? running.err.message : 'it returned the review!');

    const sub = await ask(() => w.svc.submitAttempt('s1', 'a-s1', { answers: ALL4 }));
    const r = sub.v || {};
    check('submit: q1 right +2, q2 wrong in a no-negative section 0, q3 right +3, q4 wrong -1  => score 4', r.score === 4, 'score=' + r.score + (sub.err ? ' err=' + sub.err.message : ''));
    check('submit: right 2, wrong 2, skipped 0', r.totalCorrect === 2 && r.totalWrong === 2 && r.totalSkipped === 0, JSON.stringify([r.totalCorrect, r.totalWrong, r.totalSkipped]));
    check('submit: right + wrong + skipped = question count of the paper (4)', (r.totalCorrect + r.totalWrong + r.totalSkipped) === w.template.totalQuestions, 'sum=' + (r.totalCorrect + r.totalWrong + r.totalSkipped));

    const d = await ask(() => w.svc.attemptDetail('s1', 'a-s1'));
    const det = d.v || { questions: [] };
    check('review: one row per question of the paper (4)', det.questions.length === 4, 'rows=' + det.questions.length + (d.err ? ' err=' + d.err.message : ''));
    check('review: sum of the per-question marks = the stored score (4)', sumReview(det.questions) === det.score, 'sum=' + sumReview(det.questions) + ' score=' + det.score);
    const cnt = (f) => det.questions.filter(f).length;
    check('review: right / wrong / skipped rows = stored totals', cnt((q) => q.isCorrect) === det.totalCorrect && cnt((q) => !q.isCorrect && !q.isSkipped) === det.totalWrong && cnt((q) => q.isSkipped) === det.totalSkipped);
    const q2 = det.questions.find((q) => q.questionId === 'q2') || {};
    const q4 = det.questions.find((q) => q.questionId === 'q4') || {};
    check('review: a wrong answer in the no-negative section shows 0 negative, in Reasoning shows 1', q2.negativeMarks === 0 && q4.negativeMarks === 1 && q4.marks === 3, JSON.stringify([q2.negativeMarks, q4.negativeMarks, q4.marks]));
    check('review: "out of" marks = the pattern total (10), not the stale stored 16', det.testTemplate && det.testTemplate.totalMarks === 10, 'totalMarks=' + (det.testTemplate && det.testTemplate.totalMarks));
    check('review of another student\'s attempt is refused', !!(await ask(() => w.svc.attemptDetail('s2', 'a-s1'))).err);

    // =================================================================================================================
    // 2. one crowd for every peer number on the result page: first finished attempt of every active STUDENT
    //    (admin 10, moderator 9 and Ravi's retake 10 must not count; Ravi's first attempt 5 and Asha 4 do)
    // =================================================================================================================
    const rk = await ask(() => w.rank.forAttempt('s1', 'a-s1'));
    check('rank card: Asha is #2 of 2 (admin, moderator and the retake are not counted)', rk.v && rk.v.overall.rank === 2 && rk.v.overall.outOf === 2, rk.v ? JSON.stringify(rk.v.overall) : rk.err.message);
    check('result hero rank (attemptDetail) = the rank card rank', rk.v && det.rank === rk.v.overall.rank, 'detail.rank=' + det.rank + ' card=' + (rk.v && rk.v.overall.rank));
    check('result hero percentile = the rank card percentile', rk.v && det.percentile === rk.v.overall.percentile, 'detail=' + det.percentile + ' card=' + (rk.v && rk.v.overall.percentile));
    check('"Topper" on the comparison bar = best score of the students (5), not the admin\'s 10', det.topper && det.topper.score === 5, 'topper=' + (det.topper && det.topper.score));

    const st = await ask(() => w.stats.getStats('T1', 's1'));
    const s = st.v || { toppers: [] };
    check('real stats: 2 attempts (the 2 students\' first attempts)', s.attempts === 2, 'attempts=' + s.attempts + (st.err ? ' err=' + st.err.message : ''));
    check('real stats: average = (4 + 5) / 2 = 4.5', s.avgScore === 4.5, 'avg=' + s.avgScore);
    const names = s.toppers.map((t) => t.fullName).join(' | ');
    check('real stats toppers: no admin / moderator, students only', !/Sachin|Meena/.test(names) && s.toppers.length === 2, names);
    check('real stats toppers: other students are "Ravi S." (short name), the viewer sees their own full name', s.toppers[0] && s.toppers[0].fullName === 'Ravi S.' && s.toppers[1] && s.toppers[1].fullName === 'Asha Kumari', names);
    check('real stats toppers: the viewer\'s row is flagged isMe', s.toppers.length === 2 && s.toppers[1].isMe === true && s.toppers[0].isMe === false);
    check('real stats toppers: no user id is sent to the browser', s.toppers.length > 0 && s.toppers.every((t) => !('userId' in t)));

    const cmp = await ask(() => w.svc.getComparisonWithToppers('s1', 'T1'));
    const c = cmp.v || { toppers: [] };
    check('comparison route: rank / percentile / crowd size = the rank card (#2 of 2)', rk.v && c.yourRank === rk.v.overall.rank && c.yourPercentile === rk.v.overall.percentile && c.totalAttempts === rk.v.overall.outOf, JSON.stringify({ rank: c.yourRank, pct: c.yourPercentile, n: c.totalAttempts }) + (cmp.err ? ' err=' + cmp.err.message : ''));
    check('comparison route: best score = 5 (students only), average of the same crowd', c.maxScore === 5 && c.averageScore === 4.5, JSON.stringify({ max: c.maxScore, avg: c.averageScore }));
    check('comparison route: toppers are students only, other students as short names', c.toppers.length === 2 && c.toppers[0].name === 'Ravi S.' && c.toppers[1].name === 'Asha Kumari', c.toppers.map((t) => t.name).join(' | '));

    const adm = await ask(() => w.svc.attemptDetail('admin', 'a-admin'));
    const admCard = await ask(() => w.rank.forAttempt('admin', 'a-admin'));
    check('admin viewer: hero rank = rank card (practice rank), still no student is pushed down', adm.v && admCard.v && adm.v.rank === admCard.v.overall.rank && admCard.v.countsForRank === false, adm.v ? 'detail=' + adm.v.rank + ' card=' + (admCard.v && admCard.v.overall.rank) : adm.err.message);

    // =================================================================================================================
    // 3. KNOWN GAPS - documented in AUDIT_RESULTS_ANALYSIS_OCT2026.md, not fixed in this session
    // =================================================================================================================
    // G3. answer key corrected after the attempt: the review shows the NEW key next to the OLD isCorrect
    w.questions.find((q) => q.id === 'q1').correctAnswer = 'B';
    const after = await ask(() => w.svc.attemptDetail('s1', 'a-s1'));
    const q1 = ((after.v && after.v.questions) || []).find((q) => q.questionId === 'q1') || {};
    gap('G3 answer key corrected after submit: review stays consistent (selected A, key now B, so it must not say "correct")', q1.selectedOption === q1.correctAnswer ? false : q1.isCorrect === true, `selected=${q1.selectedOption} key=${q1.correctAnswer} isCorrect=${q1.isCorrect} (stored score is not re-scored)`);
    w.questions.find((q) => q.id === 'q1').correctAnswer = 'A';
  }

  // G1. abandoned / expired attempt scored from autosaved rows only: unvisited questions have no row
  {
    const w = world();
    w.attempts.push({ id: 'a-s3', userId: 's3', testTemplateId: 'T1', status: 'IN_PROGRESS', score: 0, totalCorrect: 0, totalWrong: 0, totalSkipped: 0, accuracyPercent: 0, rank: null, percentile: null, startedAt: new Date(T0 - 2 * 3600e3), submittedAt: null, expiresAt: new Date(T0 - 3600e3), sectionPlan: null, lastSyncAt: null, user: w.attempts[0].user });
    w.attempts[w.attempts.length - 1].user = { id: 's3', fullName: 'Neha Gupta', role: 'STUDENT', state: 'Bihar', isSuspended: false };
    w.answerRows.push({ testAttemptId: 'a-s3', questionId: 'q1', selectedOption: 'A', isCorrect: true, timeSpentSeconds: 5, isMarkedForReview: false });
    const r = (await ask(() => w.svc.submitAttempt('s3', 'a-s3', { answers: ALL4 }))).v || {};
    const total = (r.totalCorrect || 0) + (r.totalWrong || 0) + (r.totalSkipped || 0);
    gap('G1 expired attempt: right + wrong + skipped = question count (4)', total !== w.template.totalQuestions, `totals add up to ${total} of ${w.template.totalQuestions} (no question list is stored for a normal mock)`);
    const det = (await ask(() => w.svc.attemptDetail('s3', 'a-s3'))).v || { questions: [] };
    gap('G1b expired attempt: the review lists every question of the paper', det.questions.length !== w.template.totalQuestions, `review has ${det.questions.length} of ${w.template.totalQuestions} rows`);
  }

  // G2. autosave accepts ANY question id: a score can exceed the paper's maximum
  {
    const w = world();
    w.attempts.push({ id: 'a-s5', userId: 's5', testTemplateId: 'T1', status: 'IN_PROGRESS', score: 0, totalCorrect: 0, totalWrong: 0, totalSkipped: 0, accuracyPercent: 0, rank: null, percentile: null, startedAt: new Date(T0 - 60000), submittedAt: null, expiresAt: new Date(T0 + 3600e3), sectionPlan: null, lastSyncAt: null, user: { id: 's5', fullName: 'Cheat Boy', role: 'STUDENT', state: 'Bihar', isSuspended: false } });
    const key = { q1: 'A', q2: 'B', q3: 'C', q4: 'D', q5: 'A', q6: 'A', q7: 'A' };
    await ask(() => w.svc.saveAnswers('s5', 'a-s5', { answers: Object.entries(key).map(([questionId, selectedOption]) => ({ questionId, selectedOption })) }));
    const r = (await ask(() => w.svc.submitAttempt('s5', 'a-s5', { answers: [] }))).v || {};
    gap('G2 score never exceeds the paper maximum (10)', r.score > 10, `score=${r.score}, totalCorrect=${r.totalCorrect} on a 4-question paper (autosave does not check that the question belongs to the paper)`);
  }

  // G4. POST /tests/attempts (saveAttempt) turns client-sent answers into an instantly SUBMITTED, rankable attempt
  {
    const w = world();
    const out = await ask(() => w.svc.saveAttempt('s5', { testTemplateId: 'T1', answers: [{ questionId: 'q1', selectedOption: 'A' }, { questionId: 'q2', selectedOption: 'B' }, { questionId: 'q3', selectedOption: 'C' }, { questionId: 'q4', selectedOption: 'D' }] }));
    const card = out.v ? (await ask(() => w.rank.forAttempt('s5', out.v.id))).v : null;
    gap('G4 a client cannot create a finished, ranked attempt without a server-timed start', !!(card && card.countsForRank && card.overall.rank === 1), out.v ? `full marks (${out.v.score}) in 0 s was accepted as a first attempt: rank #${card && card.overall.rank} of ${card && card.overall.outOf}` : String(out.err));
  }

  // =====================================================================================================================
  // 4. answer key must not unlock from a RUNNING attempt (bank browse / question detail + review queue)
  // =====================================================================================================================
  {
    const w = world();
    const mkRunning = () => {
      w.attempts.push({ id: 'a-s3', userId: 's3', testTemplateId: 'T1', status: 'IN_PROGRESS', score: 0, startedAt: new Date(), expiresAt: new Date(T0 + 3600e3), user: { id: 's3', role: 'STUDENT' } });
      // a client can autosave an answer for ANY question id, so these three rows prove nothing about the student having seen the questions
      for (const q of ['q1', 'q2', 'q5']) w.answerRows.push({ testAttemptId: 'a-s3', questionId: q, selectedOption: 'A', isCorrect: false, timeSpentSeconds: 0 });
    };
    mkRunning();
    const bankGate = (uid, ids) => BankService.prototype.getAttemptedQuestionIds.call({ prisma: w.prisma }, uid, ids);
    const reviewGate = (uid, ids) => ReviewService.prototype.getAttemptedQuestionIds.call({ prisma: w.prisma }, uid, ids);
    const b1 = await bankGate('s3', ['q1', 'q2', 'q5']);
    check('bank browse / question detail: autosaved rows of a RUNNING attempt do not unlock the answer key', b1.size === 0, 'unlocked=' + JSON.stringify([...b1]));
    const r1 = await reviewGate('s3', ['q1', 'q2', 'q5']);
    check('review queue: autosaved rows of a RUNNING attempt do not unlock the answer key', r1.size === 0, 'unlocked=' + JSON.stringify([...r1]));
    // once the attempt is finished the same answers do count
    w.attempts.find((a) => a.id === 'a-s3').status = 'SUBMITTED';
    const b2 = await bankGate('s3', ['q1', 'q2', 'q5']);
    const r2 = await reviewGate('s3', ['q1', 'q2', 'q5']);
    check('bank gate: after the attempt is SUBMITTED the answered questions unlock (q1, q2, q5)', b2.size === 3, 'unlocked=' + JSON.stringify([...b2]));
    check('review gate: after the attempt is SUBMITTED the answered questions unlock', r2.size === 3, 'unlocked=' + JSON.stringify([...r2]));
    const other = await bankGate('s2', ['q1']);
    check("another student's attempts never unlock anything for you", other.size === 0, 'unlocked=' + JSON.stringify([...other]));
  }

  console.log('\n' + (gaps ? `${gaps} known gap(s) are still open (printed as GAP, documented in AUDIT_RESULTS_ANALYSIS_OCT2026.md)` : 'no open gaps'));
  console.log(allOk ? '\nALL OK' : '\nSOME CHECKS FAILED');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('SIM CRASHED', e); process.exit(2); });
