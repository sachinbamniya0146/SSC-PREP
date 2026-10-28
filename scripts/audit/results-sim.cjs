// Simulation of the REAL result / analysis code against an in-memory fake database (sessions 24 + 25, 28 Oct 2026, roadmap area 3).
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
class ForbiddenException extends Error {}
const noop = () => () => {};
const nestStub = new Proxy(
  { BadRequestException, NotFoundException, ForbiddenException, ConflictException: class extends Error {}, Logger: class { log() {} warn() {} error() {} } },
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
const { ExplanationsService } = require(path.join(backend, 'src/explanations/explanations.service.ts'));
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
    testTemplate: { findUnique: async ({ where }) => (where.id === 'T1' ? { ...template } : where.id === 'pyq-x' ? { ...template, id: 'pyq-x', type: 'SHIFT_WISE' } : null) },
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
      create: async ({ data, select }) => {
        const { answers, ...rest } = data;
        const a = { id: 'new' + ++seq, rank: null, percentile: null, startedAt: new Date(), expiresAt: null, sectionPlan: null, lastSyncAt: null, ...rest };
        a.user = userOf(a.userId);
        attempts.push(a);
        for (const r of (answers && answers.create) || []) answerRows.push({ testAttemptId: a.id, isMarkedForReview: false, ...r });
        if (select) return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, a[k]])); // like Prisma: only the selected columns come back
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

// A world for the CGL sectional page (session 29): exam 'cgl', 4 subjects x 30 bilingual questions, template tpl-cgl-pyq-2024.
function cglWorld() {
  const w = world();
  const slugs = ['reasoning', 'general_awareness', 'quantitative_aptitude', 'english'];
  const subjects = slugs.map((slug, i) => ({ id: 'sub-' + slug, slug, name: slug }));
  const bank = [];
  slugs.forEach((slug) => {
    for (let i = 0; i < 30; i++) {
      bank.push({
        id: `${slug}-${i}`, subjectId: 'sub-' + slug, examId: 'exam-cgl', year: 2020 + (i % 5), createdAt: new Date(2026, 0, 1, 0, i),
        questionText: `${slug} question ${i}`, questionTextHindi: 'hi ' + i, questionNo: i, paperQuestionNo: i,
        optionsJson: ['A', 'B', 'C', 'D'].map((k) => ({ key: k, text: `${slug} ${i} option ${k}` })),
        correctAnswer: 'A', marks: 2, negativeMarks: 0.5, shift: 'S1', exam: { name: 'SSC CGL' }, chapter: { name: 'Ch' },
        questionDiagramType: null, questionDiagramLabels: null, questionImageUrl: null,
      });
    }
  });
  bank.forEach((q) => {
    const slug = q.id.replace(/-\d+$/, '');
    Object.assign(q, { subject: { name: slug, slug }, topic: null, subTopic: null, explanation: 'because', explanationHindi: null, explanationSource: null, difficulty: null, examTier: null, tierPaper: null, examDate: null });
  });
  w.questions.push(...bank); // the review (attemptDetail) reads its questions from here
  w.bank = bank;
  const sortBank = (rows) => rows.sort((a, b) => b.year - a.year || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  w.prisma.exam = { findUnique: async ({ where }) => (where.slug === 'cgl' ? { id: 'exam-cgl', name: 'SSC CGL' } : null) };
  w.prisma.subject = { findMany: async () => subjects.map((x) => ({ ...x })) };
  w.prisma.question.findMany = async ({ where }) => {
    if (where.id && where.id.in) return bank.filter((q) => where.id.in.includes(q.id)).map((q) => ({ ...q }));
    return sortBank(bank.filter((q) => q.subjectId === where.subjectId && q.examId === where.examId)).map((q) => ({ ...q }));
  };
  const baseTpl = w.prisma.testTemplate.findUnique;
  w.prisma.testTemplate.findUnique = async (a) => (a.where.id === 'tpl-cgl-pyq-2024' ? { id: 'tpl-cgl-pyq-2024', title: 'CGL', type: 'MOCK', durationMinutes: 60, totalQuestions: 100, totalMarks: 200, examPatternId: null, examId: 'exam-cgl', examPattern: null } : baseTpl(a));
  w.svc.markingSchemeFor = async () => null; // the preset lookup is not what this sim is about; the question columns (2 / -0.5) score
  return w;
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

  // ---- session 25: the attempt remembers the questions of its paper (TestAttempt.questionSnapshot) ----
  const U3 = { id: 's3', fullName: 'Neha Gupta', role: 'STUDENT', state: 'Bihar', isSuspended: false };
  const rawAttempt = (id, userId, user, extra) => ({ id, userId, testTemplateId: 'T1', status: 'IN_PROGRESS', score: 0, totalCorrect: 0, totalWrong: 0, totalSkipped: 0, accuracyPercent: 0, rank: null, percentile: null, startedAt: new Date(T0 - 2 * 3600e3), submittedAt: null, expiresAt: new Date(T0 - 3600e3), sectionPlan: null, lastSyncAt: null, user, ...extra });
  const PAPER = ['q1', 'q2', 'q3', 'q4'];

  // G1 (closed for papers with a stored list). Expired / abandoned attempt: only q1 was ever autosaved.
  {
    const w = world();
    w.attempts.push(rawAttempt('a-s3', 's3', U3, { questionSnapshot: PAPER }));
    w.answerRows.push({ testAttemptId: 'a-s3', questionId: 'q1', selectedOption: 'A', isCorrect: true, timeSpentSeconds: 5, isMarkedForReview: false });
    const r = (await ask(() => w.svc.submitAttempt('s3', 'a-s3', { answers: ALL4 }))).v || {};
    const total = (r.totalCorrect || 0) + (r.totalWrong || 0) + (r.totalSkipped || 0);
    check('G1 expired attempt with a stored paper: right + wrong + skipped = question count (4)', total === 4 && r.totalCorrect === 1 && r.totalWrong === 0 && r.totalSkipped === 3, `right=${r.totalCorrect} wrong=${r.totalWrong} skipped=${r.totalSkipped}`);
    check('G1 expired attempt: the late client payload is still ignored, only the autosaved q1 scores (+2)', r.score === 2, 'score=' + r.score);
    const det = (await ask(() => w.svc.attemptDetail('s3', 'a-s3'))).v || { questions: [] };
    check('G1b expired attempt: the review lists every question of the paper (4), the 3 untouched ones as skipped', det.questions.length === 4 && det.questions.filter((q) => q.isSkipped).length === 3, `rows=${det.questions.length} skipped=${det.questions.filter((q) => q.isSkipped).length}`);
    check('G1b review: sum of the per-question marks = the stored score', sumReview(det.questions) === det.score, `sum=${sumReview(det.questions)} score=${det.score}`);
    const filler = w.answerRows.filter((x) => x.testAttemptId === 'a-s3' && x.questionId !== 'q1');
    check('untouched questions are stored as skipped rows (no answer, not correct)', filler.length === 3 && filler.every((x) => x.selectedOption === null && x.isCorrect === false), JSON.stringify(filler.map((x) => x.questionId)));
  }

  // G1 on a question deleted from the bank after the attempt started: no row can be written for it (foreign key), submit must still work
  {
    const w = world();
    w.attempts.push(rawAttempt('a-s3', 's3', U3, { questionSnapshot: PAPER }));
    w.answerRows.push({ testAttemptId: 'a-s3', questionId: 'q1', selectedOption: 'A', isCorrect: true, timeSpentSeconds: 5, isMarkedForReview: false });
    w.questions.splice(w.questions.findIndex((q) => q.id === 'q4'), 1);
    const out = await ask(() => w.svc.submitAttempt('s3', 'a-s3', { answers: [] }));
    const r = out.v || {};
    check('a question deleted after the start: submit still works, it is simply not counted (right 1, skipped 2)', !out.err && r.totalCorrect === 1 && r.totalSkipped === 2 && !w.answerRows.some((x) => x.questionId === 'q4'), out.err ? out.err.message : `right=${r.totalCorrect} skipped=${r.totalSkipped}`);
  }

  // G2 (closed for papers with a stored list). Autosave of ids that are not in the paper
  {
    const w = world();
    w.attempts.push(rawAttempt('a-s5', 's5', { id: 's5', fullName: 'Cheat Boy', role: 'STUDENT', state: 'Bihar', isSuspended: false }, { startedAt: new Date(T0 - 60000), expiresAt: new Date(T0 + 3600e3), questionSnapshot: PAPER }));
    const key = { q1: 'A', q2: 'B', q3: 'C', q4: 'D', q5: 'A', q6: 'A', q7: 'A' };
    const sv = (await ask(() => w.svc.saveAnswers('s5', 'a-s5', { answers: Object.entries(key).map(([questionId, selectedOption]) => ({ questionId, selectedOption })) }))).v || {};
    check('G2 autosave: only the 4 questions of the paper are stored, the 3 foreign ids are rejected', sv.saved === 4 && sv.rejected === 3 && !w.answerRows.some((x) => ['q5', 'q6', 'q7'].includes(x.questionId)), JSON.stringify(sv));
    const r = (await ask(() => w.svc.submitAttempt('s5', 'a-s5', { answers: Object.entries(key).map(([questionId, selectedOption]) => ({ questionId, selectedOption })) }))).v || {};
    check('G2 score never exceeds the paper maximum (10): full marks = 2 + 2 + 3 + 3', r.score === 10 && r.totalCorrect === 4 && r.totalSkipped === 0, `score=${r.score} right=${r.totalCorrect} skipped=${r.totalSkipped}`);
    // submit alone (nothing autosaved before): foreign ids in the final payload are ignored
    w.attempts.push(rawAttempt('a-s5b', 's5', { id: 's5', fullName: 'Cheat Boy', role: 'STUDENT', state: 'Bihar', isSuspended: false }, { startedAt: new Date(T0 - 60000), expiresAt: new Date(T0 + 3600e3), questionSnapshot: PAPER }));
    const r2 = (await ask(() => w.svc.submitAttempt('s5', 'a-s5b', { answers: Object.entries(key).map(([questionId, selectedOption]) => ({ questionId, selectedOption })) }))).v || {};
    check('G2 submit payload with foreign ids: ignored, score stays within the paper (10)', r2.score === 10 && r2.totalCorrect === 4, `score=${r2.score} right=${r2.totalCorrect}`);
  }
  // ---- where the list comes from: startAttempt ----
  {
    const w = world();
    const snapOf = (id) => (w.attempts.find((a) => a.id === id) || {}).questionSnapshot;
    const s1 = await ask(() => w.svc.startAttempt('s3', 'T1', { questionIds: ['q1', 'q2', 'q3', 'q4', 'q1'] }));
    check('start with a composed list (year-wise test): stored without repeats, in order', !s1.err && JSON.stringify(snapOf(s1.v && s1.v.id)) === JSON.stringify(PAPER), s1.err ? s1.err.message : JSON.stringify(snapOf(s1.v && s1.v.id)));
    const again = await ask(() => w.svc.startAttempt('s3', 'T1', { questionIds: ['q5'] }));
    check('start again while running = resume: same attempt, its list is not replaced', !again.err && again.v.resumed === true && again.v.id === s1.v.id && JSON.stringify(snapOf(s1.v.id)) === JSON.stringify(PAPER));

    const w2 = world();
    const snap2 = (id) => (w2.attempts.find((a) => a.id === id) || {}).questionSnapshot;
    let paperCalls = 0;
    w2.svc.paper = async (uid, tid) => { paperCalls++; return { sections: [{ questions: [{ id: 'q1' }, { id: 'q2' }] }, { questions: [{ id: 'q3' }, { id: 'q4' }] }] }; };
    const s2 = await ask(() => w2.svc.startAttempt('s3', 'pyq-x'));
    check('start of an auto-built PYQ paper (SHIFT_WISE, pyq-...): the list is the composed paper', !s2.err && JSON.stringify(snap2(s2.v && s2.v.id)) === JSON.stringify(PAPER) && paperCalls === 1, s2.err ? s2.err.message : JSON.stringify(snap2(s2.v && s2.v.id)));
    const s3 = await ask(() => w2.svc.startAttempt('s5', 'T1'));
    check('start of any other template WITHOUT the fromPaper flag (and without the sectional flag): no list is guessed, paper() is not even asked', !s3.err && snap2(s3.v && s3.v.id) == null && paperCalls === 1, s3.err ? s3.err.message : 'snapshot=' + JSON.stringify(snap2(s3.v && s3.v.id)));
    const s3b = await ask(() => w2.svc.startAttempt('s3', 'T1', { fromPaper: true }));
    check('start of a template from the /test?template= page (fromPaper): the list is the composed paper, also for a generic mock', !s3b.err && JSON.stringify(snap2(s3b.v && s3b.v.id)) === JSON.stringify(PAPER) && paperCalls === 2, s3b.err ? s3b.err.message : JSON.stringify(snap2(s3b.v && s3b.v.id)));
    w2.svc.paper = async () => { throw new BadRequestException('Pattern needs questions for: Reasoning'); };
    const s4 = await ask(() => w2.svc.startAttempt('s2', 'pyq-x', { fromPaper: true }));
    check('start when the paper cannot be composed: the attempt still starts, without a list', !s4.err && snap2(s4.v && s4.v.id) == null, s4.err ? s4.err.message : '');
  }

  // ---- session 29 (roadmap 4.1): the CGL sectional page. The server composes the exam, stores its list, and a resume returns the same questions ----
  {
    const w = cglWorld();
    const start = await ask(() => w.svc.startAttempt('s3', 'tpl-cgl-pyq-2024', { sectionalFamily: 'cgl' }));
    const exam = start.v && start.v.exam;
    const flat = (e) => (e ? e.sections.flatMap((x) => x.questions.map((q) => q.id)) : []);
    const ids = flat(exam);
    check('CGL start: the response carries the exam, 4 sections x 25 = 100 distinct questions', !start.err && ids.length === 100 && new Set(ids).size === 100 && exam.sections.every((x) => x.questions.length === 25), start.err ? start.err.message : 'questions=' + ids.length);
    check('CGL start: no answer key and no explanation in the exam', !!exam && exam.sections.every((x) => x.questions.every((q) => !('correctAnswer' in q) && !('explanation' in q))));
    const att = w.attempts.find((a) => a.id === (start.v && start.v.id)) || {};
    check('CGL start: the exam\'s question list is stored on the attempt (100 ids, in exam order)', JSON.stringify(att.questionSnapshot) === JSON.stringify(ids), 'stored=' + (Array.isArray(att.questionSnapshot) ? att.questionSnapshot.length : att.questionSnapshot));
    check('CGL start: the response has no question list of its own besides the exam (snapshot is not leaked)', !!start.v && !('questionSnapshot' in start.v));

    // the bank changes while the student is writing (a new 2030 question would now be picked first): a refresh must give the same exam
    w.bank.push({ ...w.bank.find((q) => q.id === 'reasoning-0'), id: 'reasoning-NEW', year: 2030, questionText: 'brand new reasoning question', optionsJson: ['A', 'B', 'C', 'D'].map((k) => ({ key: k, text: 'new ' + k })) });
    const fresh = flat(await w.svc.sectionalExamForFamily('cgl'));
    check('sanity: a freshly composed exam is a DIFFERENT list now (this is why the stored list matters)', JSON.stringify(fresh) !== JSON.stringify(ids));
    const again = await ask(() => w.svc.startAttempt('s3', 'tpl-cgl-pyq-2024', { sectionalFamily: 'cgl' }));
    check('CGL resume (refresh in the middle): the SAME attempt and the SAME 100 questions in the same order', !again.err && again.v.resumed === true && again.v.id === start.v.id && JSON.stringify(flat(again.v.exam)) === JSON.stringify(ids), again.err ? again.err.message : 'resumed=' + (again.v && again.v.resumed));
    check('CGL resume: still no answer key', !!again.v && !!again.v.exam && again.v.exam.sections.every((x) => x.questions.every((q) => !('correctAnswer' in q))));
    const plain = await ask(() => w.svc.startAttempt('s3', 'tpl-cgl-pyq-2024', {}));
    check('CGL resume asked WITHOUT the sectional flag (an old client): same attempt, no exam field added', !plain.err && plain.v.id === start.v.id && !('exam' in plain.v));

    // G1 / G1b: the student answers ONE question, then leaves; the time is over
    const first = ids[0];
    w.answerRows.push({ testAttemptId: att.id, questionId: first, selectedOption: 'A', isCorrect: true, timeSpentSeconds: 9, isMarkedForReview: false });
    att.expiresAt = new Date(T0 - 5 * MIN);
    const late = ids.map((id) => ({ questionId: id, selectedOption: 'A' }));
    const sub = (await ask(() => w.svc.submitAttempt('s3', att.id, { answers: late }))).v || {};
    const total = (sub.totalCorrect || 0) + (sub.totalWrong || 0) + (sub.totalSkipped || 0);
    check('G1 CGL page, abandoned attempt: right + wrong + skipped = 100 (1 + 0 + 99)', total === 100 && sub.totalCorrect === 1 && sub.totalSkipped === 99, `right=${sub.totalCorrect} wrong=${sub.totalWrong} skipped=${sub.totalSkipped}`);
    check('G1 CGL page: the late payload is ignored, only the autosaved answer scores (+2)', sub.score === 2, 'score=' + sub.score);
    const det = (await ask(() => w.svc.attemptDetail('s3', att.id))).v || { questions: [] };
    check('G1b CGL page: the review lists all 100 questions, 99 as skipped', det.questions.length === 100 && det.questions.filter((q) => q.isSkipped).length === 99, `rows=${det.questions.length}`);

    // G2: a second attempt of another student, autosave with ids from outside the exam, then everything right
    const s2 = await ask(() => w.svc.startAttempt('s5', 'tpl-cgl-pyq-2024', { sectionalFamily: 'cgl' }));
    const ids2 = flat(s2.v && s2.v.exam);
    const foreign = w.bank.filter((q) => !ids2.includes(q.id)).slice(0, 5).map((q) => q.id);
    const sv = (await ask(() => w.svc.saveAnswers('s5', s2.v.id, { answers: [...ids2, ...foreign].map((questionId) => ({ questionId, selectedOption: 'A' })) }))).v || {};
    check('G2 CGL page: autosave stores the 100 questions of the exam and rejects the 5 foreign ids', sv.saved === 100 && sv.rejected === 5 && !w.answerRows.some((x) => x.testAttemptId === s2.v.id && foreign.includes(x.questionId)), JSON.stringify(sv));
    const full = (await ask(() => w.svc.submitAttempt('s5', s2.v.id, { answers: [...ids2, ...foreign].map((questionId) => ({ questionId, selectedOption: 'A' })) }))).v || {};
    check('G2 CGL page: a score never passes the exam maximum (100 x 2 = 200)', full.score === 200 && full.totalCorrect === 100, `score=${full.score} right=${full.totalCorrect}`);
  }

  // LEGACY (documented limit, behaviour must stay as it was): attempts that were started WITHOUT a stored list
  {
    const w = world();
    w.attempts.push(rawAttempt('a-s3', 's3', U3, {}));
    w.answerRows.push({ testAttemptId: 'a-s3', questionId: 'q1', selectedOption: 'A', isCorrect: true, timeSpentSeconds: 5, isMarkedForReview: false });
    const r = (await ask(() => w.svc.submitAttempt('s3', 'a-s3', { answers: ALL4 }))).v || {};
    const total = (r.totalCorrect || 0) + (r.totalWrong || 0) + (r.totalSkipped || 0);
    check('LEGACY attempt without a stored list (started before session 25): scored exactly as before (only the touched question counts, totals add up to 1 of 4)', total === 1 && r.score === 2, `total=${total} score=${r.score}`);
    const w2 = world();
    w2.attempts.push(rawAttempt('a-s5', 's5', { id: 's5', fullName: 'Cheat Boy', role: 'STUDENT', state: 'Bihar', isSuspended: false }, { startedAt: new Date(T0 - 60000), expiresAt: new Date(T0 + 3600e3) }));
    const key = { q1: 'A', q2: 'B', q3: 'C', q4: 'D', q5: 'A', q6: 'A', q7: 'A' };
    await ask(() => w2.svc.saveAnswers('s5', 'a-s5', { answers: Object.entries(key).map(([questionId, selectedOption]) => ({ questionId, selectedOption })) }));
    const r2 = (await ask(() => w2.svc.submitAttempt('s5', 'a-s5', { answers: [] }))).v || {};
    check('LEGACY attempt without a stored list: autosave / score behave exactly as before (7 ids stored, score 19 on a 10-mark paper: the known old limit)', r2.score === 19, `score=${r2.score}`);
    const s6 = await ask(() => w2.svc.startAttempt('s3', 'T1', {}));
    check('start WITHOUT the sectional flag keeps working exactly as before (no list, no exam in the answer)', !s6.err && !('exam' in s6.v) && (w2.attempts.find((a) => a.id === s6.v.id) || {}).questionSnapshot === undefined, s6.err ? s6.err.message : '');
  }

  // ---- session 29 (roadmap 4.2): the abandoned-attempt sweeper + AUTO_SUBMITTED counted everywhere ----
  {
    let sweeperMod = null;
    try { sweeperMod = require(path.join(backend, 'src/tests/attempt-sweeper.service.ts')); } catch (e) { sweeperMod = null; }
    check('the sweeper service exists (attempt-sweeper.service.ts)', !!sweeperMod && !!sweeperMod.AttemptSweeperService);
    if (sweeperMod) {
      const { AttemptSweeperService, sweepGraceMs, SWEEP_GRACE_MS } = sweeperMod;
      const w = world();
      const H = 3600e3;
      const U5 = { id: 's5', fullName: 'Cheat Boy', role: 'STUDENT', state: 'Bihar', isSuspended: false };
      const row = (testAttemptId, questionId, selectedOption, isCorrect) => w.answerRows.push({ testAttemptId, questionId, selectedOption, isCorrect, timeSpentSeconds: 4, isMarkedForReview: false });
      // ab1: Neha, deadline 7 h ago, autosaved q1 (right) and q3 (wrong, Reasoning -1); the paper has 4 questions
      w.attempts.push(rawAttempt('ab1', 's3', U3, { questionSnapshot: PAPER, startedAt: new Date(T0 - 8 * H), expiresAt: new Date(T0 - 7 * H) }));
      row('ab1', 'q1', 'A', true); row('ab1', 'q3', 'A', false);
      // ab2: deadline 7 h ago but NOTHING was answered (only a cleared answer row)
      w.attempts.push(rawAttempt('ab2', 's5', U5, { questionSnapshot: PAPER, startedAt: new Date(T0 - 8 * H), expiresAt: new Date(T0 - 7 * H) }));
      row('ab2', 'q1', null, false);
      // ab4: deadline only 1 h ago (inside the grace), answered
      w.attempts.push(rawAttempt('ab4', 's2', { id: 's2', fullName: 'Ravi Singh', role: 'STUDENT', state: 'Bihar', isSuspended: false }, { testTemplateId: 'T1', questionSnapshot: PAPER, startedAt: new Date(T0 - 2 * H), expiresAt: new Date(T0 - 1 * H) }));
      row('ab4', 'q1', 'A', true);
      // ab5: deadline 5 h ago (an offline student may still replay a queued submit until 6 h): answered, must not be touched
      w.attempts.push(rawAttempt('ab5', 's1', { id: 's1', fullName: 'Asha Kumari', role: 'STUDENT', state: 'Bihar', isSuspended: false }, { questionSnapshot: PAPER, startedAt: new Date(T0 - 6 * H), expiresAt: new Date(T0 - 5 * H) }));
      row('ab5', 'q2', 'B', true);
      // the fake database understands `answers: { some: ... }` for the candidate query
      const origFind = w.prisma.testAttempt.findMany;
      w.prisma.testAttempt.findMany = async (args) => {
        const { answers, ...where } = args.where || {};
        let r = await origFind({ ...args, where, take: 1e9 });
        if (answers && answers.some) r = r.filter((a) => w.answerRows.some((x) => x.testAttemptId === a.id && x.selectedOption != null));
        return r.slice(0, args.take || 1e9);
      };
      w.svc.gamification = { awardTestXp: async () => { w.stats.xp++; } };
      const sw = new AttemptSweeperService(w.prisma, w.svc);
      const snap = () => JSON.stringify([w.attempts.map((a) => [a.id, a.status, a.score, a.submittedAt && +a.submittedAt]), w.answerRows.map((x) => [x.testAttemptId, x.questionId, x.selectedOption])]);
      const before = w.attempts.find((a) => a.id === 'ab1');
      check('before the sweep: ab1 is IN_PROGRESS with no result', before.status === 'IN_PROGRESS' && before.score === 0);
      const xp0 = w.stats.xp;
      const run1 = await sw.run(new Date(T0));
      const ab1 = w.attempts.find((a) => a.id === 'ab1');
      check('sweep: the abandoned attempt with answers is auto-submitted (1 submitted)', run1.submitted === 1 && ab1.status === 'AUTO_SUBMITTED', JSON.stringify(run1) + ' status=' + ab1.status);
      check('sweep: scored from the autosaved answers only: q1 right +2, q3 wrong -1 => 1; 1 right, 1 wrong, 2 skipped', ab1.score === 1 && ab1.totalCorrect === 1 && ab1.totalWrong === 1 && ab1.totalSkipped === 2, `score=${ab1.score} r/w/s=${ab1.totalCorrect}/${ab1.totalWrong}/${ab1.totalSkipped}`);
      check('sweep: submittedAt = the deadline (not the sweep time), so rank ties use the real test window', +ab1.submittedAt === T0 - 7 * H, String(ab1.submittedAt));
      check('sweep: untouched questions are stored as skipped rows (4 rows in all)', w.answerRows.filter((x) => x.testAttemptId === 'ab1').length === 4);
      check('sweep: no XP is given for an attempt the student did not submit', w.stats.xp === xp0);
      check('sweep: an attempt with NO answer stays IN_PROGRESS (nothing to score)', w.attempts.find((a) => a.id === 'ab2').status === 'IN_PROGRESS');
      check('sweep: an attempt still inside the 6 h offline grace (deadline 1 h / 5 h ago) is NOT touched', w.attempts.find((a) => a.id === 'ab4').status === 'IN_PROGRESS' && w.attempts.find((a) => a.id === 'ab5').status === 'IN_PROGRESS');
      check('sweep: a running attempt whose deadline is in the future is not touched', w.attempts.find((a) => a.id === 'a-s1').status === 'IN_PROGRESS');
      check('the grace can only be made longer, never shorter than the 6 h offline replay window', sweepGraceMs({ ATTEMPT_SWEEP_GRACE_MIN: '30' }) === SWEEP_GRACE_MS && sweepGraceMs({ ATTEMPT_SWEEP_GRACE_MIN: '900' }) === 900 * 60000 && sweepGraceMs({}) === SWEEP_GRACE_MS);

      // idempotent: run again, and two containers at the same time
      const s1 = snap();
      const run2 = await sw.run(new Date(T0));
      check('sweep again: nothing changes (0 submitted, database identical)', run2.submitted === 0 && snap() === s1, JSON.stringify(run2));
      // a second abandoned attempt, swept by two containers at the same moment
      w.attempts.push(rawAttempt('ab6', 's5', U5, { questionSnapshot: PAPER, startedAt: new Date(T0 - 9 * H), expiresAt: new Date(T0 - 8 * H) }));
      row('ab6', 'q2', 'B', true);
      const swA = new AttemptSweeperService(w.prisma, w.svc);
      const swB = new AttemptSweeperService(w.prisma, w.svc);
      await Promise.all([swA.run(new Date(T0)), swB.run(new Date(T0))]);
      const ab6 = w.attempts.find((a) => a.id === 'ab6');
      check('two sweepers at the same time: scored once (AUTO_SUBMITTED, score 2), answer rows written once (4 rows)', ab6.status === 'AUTO_SUBMITTED' && ab6.score === 2 && w.answerRows.filter((x) => x.testAttemptId === 'ab6').length === 4, `status=${ab6.status} score=${ab6.score} rows=${w.answerRows.filter((x) => x.testAttemptId === 'ab6').length}`);
      const cap = new AttemptSweeperService(w.prisma, w.svc);
      for (let i = 0; i < 5; i++) { w.attempts.push(rawAttempt('bulk' + i, 's5', U5, { testTemplateId: 'T1', questionSnapshot: PAPER, startedAt: new Date(T0 - 20 * H), expiresAt: new Date(T0 - (19 - i) * H) })); row('bulk' + i, 'q1', 'A', true); }
      const capped = await cap.run(new Date(T0), 2);
      check('one run does at most `max` attempts (2 of 5), the oldest deadline first', capped.submitted === 2 && w.attempts.find((a) => a.id === 'bulk0').status === 'AUTO_SUBMITTED' && w.attempts.find((a) => a.id === 'bulk1').status === 'AUTO_SUBMITTED' && w.attempts.find((a) => a.id === 'bulk2').status === 'IN_PROGRESS', JSON.stringify(capped));

      // the student's late own submit after the sweep: same finished result, nothing re-scored
      const late = await ask(() => w.svc.submitAttempt('s3', 'ab1', { answers: ALL4 }));
      check('a late manual submit after the sweep returns the finished result unchanged (alreadySubmitted)', !late.err && late.v.alreadySubmitted === true && late.v.score === 1 && w.attempts.find((a) => a.id === 'ab1').status === 'AUTO_SUBMITTED', late.err ? late.err.message : 'score=' + (late.v && late.v.score));

      // AUTO_SUBMITTED is a finished attempt everywhere
      const det = await ask(() => w.svc.attemptDetail('s3', 'ab1'));
      check('review (attemptDetail) of an AUTO_SUBMITTED attempt works: 4 rows, 2 skipped', !det.err && det.v.questions.length === 4 && det.v.questions.filter((q) => q.isSkipped).length === 2, det.err ? det.err.message : '');
      const hist = await ask(() => w.svc.myAttempts('s3'));
      check('history (myAttempts) lists the AUTO_SUBMITTED attempt and counts it in the stats', !hist.err && hist.v.attempts.some((a) => a.id === 'ab1') && hist.v.stats.totalAttempts >= 1, hist.err ? hist.err.message : '');
      const card = await ask(() => w.rank.forAttempt('s3', 'ab1'));
      const lb = await ask(() => w.rank.leaderboard('s3', 'T1'));
      const mine = ((lb.v && lb.v.rows) || []).filter((r) => r.isMe);
      check('rank: the AUTO_SUBMITTED attempt counts once in the rank list, and the rank card agrees with the leaderboard', !card.err && card.v.countsForRank === true && mine.length === 1 && mine[0].rank === card.v.overall.rank, card.err ? card.err.message : JSON.stringify({ card: card.v && card.v.overall, mine }));
    }
  }

  // G4 (closed in session 29). POST /tests/attempts (saveAttempt) makes an instantly SUBMITTED attempt from client-sent answers: it stays in
  // the history, but it has no server-timed start (no expiresAt), so it must never rank.
  {
    const w = world();
    const full = [{ questionId: 'q1', selectedOption: 'A' }, { questionId: 'q2', selectedOption: 'B' }, { questionId: 'q3', selectedOption: 'C' }, { questionId: 'q4', selectedOption: 'D' }];
    const rankBefore = (await ask(() => w.rank.forAttempt('s2', 'a-s2'))).v;
    const out = await ask(() => w.svc.saveAttempt('s5', { testTemplateId: 'T1', answers: full }));
    const card = out.v ? (await ask(() => w.rank.forAttempt('s5', out.v.id))).v : null;
    check('G4 a practice attempt (saveAttempt, full marks in 0 s) does NOT count for rank; the card says "practice"', !!card && card.countsForRank === false && card.practice === true, out.v ? `countsForRank=${card && card.countsForRank} practice=${card && card.practice} rank=#${card && card.overall.rank}` : String(out.err));
    check('G4 the practice attempt is still saved: history lists it, the review opens', !!out.v && (await ask(() => w.svc.attemptDetail('s5', out.v.id))).v.questions.length === 4 && (await ask(() => w.svc.myAttempts('s5'))).v.attempts.some((a) => a.id === out.v.id));
    const rankAfter = (await ask(() => w.rank.forAttempt('s2', 'a-s2'))).v;
    check('G4 nobody else is pushed down: Ravi\'s rank and the crowd size are unchanged', JSON.stringify(rankBefore.overall) === JSON.stringify(rankAfter.overall) && rankBefore.attempts === rankAfter.attempts, JSON.stringify([rankBefore.overall, rankAfter.overall]));
    const lb = (await ask(() => w.rank.leaderboard('s2', 'T1'))).v;
    check('G4 leaderboard, topper and average ignore it (Cheat Boy is not listed, the best score is still 5)', lb.rows.every((r) => !/Cheat/.test(r.name)) && (await ask(() => w.stats.getStats('T1', 's2'))).v.toppers[0].score === 5);
    // a real timed attempt of the same student is the one that ranks
    const st = await ask(() => w.svc.startAttempt('s5', 'T1', {}));
    const sub = await ask(() => w.svc.submitAttempt('s5', st.v.id, { answers: [{ questionId: 'q1', selectedOption: 'A' }] }));
    const card2 = await ask(() => w.rank.forAttempt('s5', st.v.id));
    check('G4 the same student\'s TIMED attempt does rank (their first rankable attempt)', !st.err && !sub.err && card2.v && card2.v.countsForRank === true && card2.v.practice === false, st.err ? st.err.message : JSON.stringify(card2.v && card2.v.overall));
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

  // =====================================================================================================================
  // 5. session 27: skipped questions of a finished practice test can show their right option; the same question is not served twice
  // =====================================================================================================================
  {
    const w = world();
    // a finished practice test: q1 answered, q2 skipped (saved without an answer), q3 never part of it
    const spy = { calls: [] };
    w.svc.weakTopics = { recordAnswers: async (u, a, rows) => { spy.calls.push(rows); } };
    const out = await ask(() => w.svc.saveAttempt('s3', { testTemplateId: 'T1', answers: [{ questionId: 'q1', selectedOption: 'A', timeSpentSeconds: 4 }, { questionId: 'q2', selectedOption: null, timeSpentSeconds: 0 }] }));
    const at = out.v || {};
    check('practice test save: 1 right, 0 wrong, 1 skipped; the skipped question is stored as a row without an answer', !out.err && at.totalCorrect === 1 && at.totalSkipped === 1 && w.answerRows.some((r) => r.questionId === 'q2' && r.selectedOption === null && r.isCorrect === false), out.err ? out.err.message : JSON.stringify([at.totalCorrect, at.totalWrong, at.totalSkipped]));
    check('practice test save: weak topics are fed with the answered question only (as before)', spy.calls.length === 1 && spy.calls[0].length === 1 && spy.calls[0][0].questionId === 'q1', JSON.stringify(spy.calls.map((c) => c.map((r) => r.questionId))));

    const ex = new ExplanationsService(w.prisma);
    w.prisma.questionBankSet = { findMany: async () => [] };
    w.prisma.question.findUnique = async ({ where }) => { const q = w.questions.find((x) => x.id === where.id); return q ? { ...q } : null; };
    w.prisma.attemptAnswer.findFirst = async ({ where }) => { const r = (await w.prisma.attemptAnswer.findMany({ where })).find(() => true); return r || null; };
    const keys = await ask(() => ex.getAnswerKeys('s3', 'STUDENT', ['q1', 'q2', 'q3']));
    check('answer keys: the skipped question q2 (and answered q1) of a finished test come back, q3 (never attempted) does not', !keys.err && JSON.stringify(keys.v) === JSON.stringify({ q1: 'A', q2: 'B' }), keys.err ? keys.err.message : JSON.stringify(keys.v));
    const other = await ask(() => ex.getAnswerKeys('s2', 'STUDENT', ['q1', 'q2', 'q3']));
    check("answer keys: another student's attempts unlock nothing for you", !other.err && Object.keys(other.v).length === 0, JSON.stringify(other.v));
    // a RUNNING attempt must not unlock anything (autosave accepts any question id)
    w.attempts.push({ id: 'a-run', userId: 's5', testTemplateId: 'T1', status: 'IN_PROGRESS', score: 0, startedAt: new Date(), expiresAt: new Date(T0 + 3600e3), user: { id: 's5', role: 'STUDENT' } });
    w.answerRows.push({ testAttemptId: 'a-run', questionId: 'q3', selectedOption: 'A', isCorrect: false, timeSpentSeconds: 0 });
    const run = await ask(() => ex.getAnswerKeys('s5', 'STUDENT', ['q3']));
    check('answer keys: autosaved rows of a RUNNING attempt unlock nothing', !run.err && Object.keys(run.v).length === 0, JSON.stringify(run.v));
    const run2 = await ask(() => ex.getExplanation('q3', 's5', 'STUDENT'));
    check('explanation of a question: a RUNNING attempt does not unlock it either', !!run2.err && /Attempt this question first/.test(run2.err.message), run2.err ? run2.err.message : 'it returned the explanation!');
    const adm = await ask(() => ex.getAnswerKeys('admin', 'ADMIN', ['q1', 'q2', 'q3']));
    check('answer keys: an admin gets every key', !adm.err && Object.keys(adm.v).length === 3, JSON.stringify(adm.v));
    const many = await ask(() => ex.getAnswerKeys('admin', 'ADMIN', Array.from({ length: 500 }, (_, i) => 'x' + i)));
    check('answer keys: at most 200 ids are looked at, junk input is harmless', !many.err, many.err ? many.err.message : '');
    const none = await ask(() => ex.getAnswerKeys('s3', 'STUDENT', [null, 5, '']));
    check('answer keys: empty / junk list gives {}', !none.err && Object.keys(none.v).length === 0);
    // the explanation response carries the right option (behind the same gate)
    w.questions.find((q) => q.id === 'q1').explanation = 'because 1';
    const gx = await ask(() => ex.getExplanation('q1', 's3', 'STUDENT'));
    check('explanation of an attempted question also carries the right option', !gx.err && gx.v.correctAnswer === 'A', gx.err ? gx.err.message : JSON.stringify(gx.v && gx.v.correctAnswer));
  }
  {
    // the same question twice in the bank (another row, same text + options in another order) is served once
    const mkRow = (id, year, text, opts) => ({ id, year, questionText: text, questionTextHindi: 'hi', optionsJson: opts.map((t, i) => ({ key: 'ABCD'[i], text: t })), subject: { slug: 'english' }, chapter: { name: 'c' }, exam: { name: 'e' }, correctAnswer: 'A', explanation: null, explanationHindi: null, createdAt: new Date(2026, 0, 1) });
    const rows = [mkRow('d1', 2024, 'Select the synonym of BRAVE.', ['Bold', 'Weak', 'Shy', 'Lazy']), mkRow('d2', 2023, 'select the synonym of brave', ['Lazy', 'Shy', 'Weak', 'Bold'])];
    for (let i = 0; i < 12; i++) rows.push(mkRow('u' + i, 2020 + (i % 4), 'Unique question number ' + i, ['p' + i, 'q', 'r', 's']));
    const w = world();
    w.prisma.question.findMany = async () => rows.map((r) => ({ ...r }));
    const sec = await ask(() => w.svc.sectional('subj', 10));
    const qs = (sec.v && sec.v.questions) || [];
    const brave = qs.filter((q) => /brave/i.test(q.questionText)).length;
    check('practice set (sectional): 10 questions, the same question is not in it twice', !sec.err && qs.length === 10 && brave <= 1 && new Set(qs.map((q) => q.id)).size === 10, sec.err ? sec.err.message : `count=${qs.length} copies of BRAVE=${brave}`);
    let worst = 0;
    for (let i = 0; i < 30; i++) { const g = await BankService.prototype.getSet.call({ prisma: w.prisma }, { count: 10 }); worst = Math.max(worst, g.questions.filter((q) => /brave/i.test(q.questionText)).length); }
    check('random set (bank getSet): the same question never appears twice (30 draws)', worst <= 1, 'most copies seen in one set: ' + worst);
    const tiny = rows.slice(0, 2);
    w.prisma.question.findMany = async () => tiny.map((r) => ({ ...r }));
    const sm = await ask(() => w.svc.sectional('subj', 5));
    check('a tiny bank (only the two copies) still serves a set: nothing is blocked', !sm.err && ((sm.v && sm.v.questions) || []).length >= 1, sm.err ? sm.err.message : '');
  }


  console.log('\n' + (gaps ? `${gaps} known gap(s) are still open (printed as GAP, documented in AUDIT_RESULTS_ANALYSIS_OCT2026.md)` : 'no open gaps'));
  console.log(allOk ? '\nALL OK' : '\nSOME CHECKS FAILED');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('SIM CRASHED', e); process.exit(2); });
