// S48 simulation: the REAL TestBuilderService against an in-memory fake database.
// Proves: topics the exam never asked are never used; questions follow the exam's PYQ weightage; the test half is used first;
// no question twice; empty topics are not offered; a subject the exam never asked is skipped; shortfalls are reported, not hidden.
// Run: cd backend && tsx --require ../scripts/audit/nest-stubs.cjs ../scripts/audit/builder-sim.cjs .
const path = require('path');
const Module = require('module');
const root = path.resolve(process.argv[2] || '.');
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (/(^|\/)tests\.service$/.test(req)) return { TestsService: class { async startAttempt(u, t, o) { global.__started = { u, t, o }; return { id: 'att-1', resumed: false }; } } };
  return origLoad.call(this, req, parent, ...rest);
};
const { TestBuilderService } = require(path.join(root, 'src/tests/test-builder.service.ts'));

let fails = 0;
const check = (name, ok, extra) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok || !extra ? '' : '  -> ' + extra)); if (!ok) fails++; };

// ---------------- data
const subjects = [
  { id: 's-q', slug: 'quantitative_aptitude', name: 'Quant', nameHindi: 'गणित', chapters: [] },
  { id: 's-e', slug: 'english', name: 'English', nameHindi: null, chapters: [] },
];
const chapters = [{ id: 'c-q', subjectId: 's-q', name: 'Arithmetic', nameHindi: 'अंकगणित' }, { id: 'c-e', subjectId: 's-e', name: 'Grammar', nameHindi: null }];
const topics = [
  { id: 't-pct', chapterId: 'c-q', name: 'Percentage', nameHindi: 'प्रतिशत' },
  { id: 't-ratio', chapterId: 'c-q', name: 'Ratio', nameHindi: 'अनुपात' },
  { id: 't-geo', chapterId: 'c-q', name: 'Geometry', nameHindi: 'ज्यामिति' }, // never asked by this exam
  { id: 't-empty', chapterId: 'c-q', name: 'Empty topic', nameHindi: null }, // no questions at all
  { id: 't-noun', chapterId: 'c-e', name: 'Noun', nameHindi: null },
];
const Q = [];
let no = 0;
const opts = [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }, { key: 'C', text: 'c' }, { key: 'D', text: 'd' }];
function addQ(o) { no++; Q.push({ id: 'q' + no, questionNo: no, questionText: 'Q ' + no + ' ' + o.topicId, questionTextHindi: 'हिन्दी ' + no, optionsJson: opts.map((x) => ({ ...x, text: x.text + no })), correctAnswer: 'A', marks: 2, negativeMarks: 0.5, isApproved: true, isActive: true, autoSuspended: false, testReserved: false, year: null, examId: 'gd', ...o }); }
for (let i = 0; i < 40; i++) addQ({ topicId: 't-pct', chapterId: 'c-q', subjectId: 's-q', testReserved: i % 2 === 0 });
for (let i = 0; i < 40; i++) addQ({ topicId: 't-ratio', chapterId: 'c-q', subjectId: 's-q', testReserved: i % 2 === 0 });
for (let i = 0; i < 200; i++) addQ({ topicId: 't-geo', chapterId: 'c-q', subjectId: 's-q', testReserved: i % 2 === 0 });
for (let i = 0; i < 30; i++) addQ({ topicId: 't-noun', chapterId: 'c-e', subjectId: 's-e', questionTextHindi: '' }); // English: no Hindi needed
for (let i = 0; i < 60; i++) addQ({ topicId: 't-pct', chapterId: 'c-q', subjectId: 's-q', year: 2023, shift: 'Shift 1' });
for (let i = 0; i < 30; i++) addQ({ topicId: 't-ratio', chapterId: 'c-q', subjectId: 's-q', year: 2023, shift: 'Shift 1' });

// ---------------- tiny query engine
const slugOf = (sid) => subjects.find((s) => s.id === sid)?.slug;
function match(q, where) {
  for (const [k, v] of Object.entries(where || {})) {
    if (k === 'OR') { if (!v.some((w) => match(q, w))) return false; continue; }
    if (k === 'AND') { if (!v.every((w) => match(q, w))) return false; continue; }
    if (k === 'subject') { const slug = slugOf(q.subjectId) || ''; if (!/^(english|sub-english)/.test(slug)) return false; continue; }
    const val = q[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('in' in v) { if (!v.in.includes(val)) return false; }
      else if ('not' in v) { if (val === v.not) return false; if (v.not === null && val == null) return false; }
      else return false;
    } else if (v === null) { if (val != null) return false; }
    else if (val !== v) return false;
  }
  return true;
}
const prisma = {
  subject: { findMany: async () => subjects.map((s) => ({ ...s, chapters: chapters.filter((c) => c.subjectId === s.id).map((c) => ({ ...c, topics: topics.filter((t) => t.chapterId === c.id) })) })) },
  exam: { findFirst: async ({ where }) => (where.id === 'gd' ? { id: 'gd', name: 'SSC GD' } : null) },
  examPattern: {
    findMany: async () => [{ id: 'p1', name: 'SSC GD Constable', negativeMarks: 0.25, sections: [{ name: 'Quant', subjectSlug: 'quantitative_aptitude', questions: 10, marks: 20 }, { name: 'English', subjectSlug: 'english', questions: 5, marks: 10 }] }],
    findUnique: async () => ({ durationMinutes: 60 }),
  },
  question: {
    findMany: async ({ where, take }) => Q.filter((q) => match(q, where)).slice(0, take ?? 1e9).map((q) => ({ ...q, exam: { name: 'SSC GD' }, subject: { name: 'x', slug: slugOf(q.subjectId) }, chapter: { name: 'c', nameHindi: null } })),
    count: async ({ where }) => Q.filter((q) => match(q, where)).length,
    groupBy: async ({ by, where }) => {
      const m = new Map();
      for (const q of Q.filter((x) => match(x, where))) { const key = by.map((b) => q[b] ?? '').join('|'); const e = m.get(key) || { ...Object.fromEntries(by.map((b) => [b, q[b] ?? null])), _count: { _all: 0 } }; e._count._all++; m.set(key, e); }
      return [...m.values()];
    },
  },
  attemptAnswer: { findMany: async () => [] },
  testTemplate: { create: async ({ data }) => { global.__template = data; return { id: 'tpl-1', ...data }; } },
};
const svc = new TestBuilderService(prisma, { startAttempt: async (u, t, o) => { global.__started = { u, t, o }; return { id: 'att-1', resumed: false }; } });
const byId = new Map(Q.map((q) => [q.id, q]));

(async () => {
  // ---- catalog
  const cat = await svc.catalog('gd');
  const flat = cat.subjects.flatMap((s) => s.chapters.flatMap((c) => c.topics.map((t) => t.id)));
  check('catalog: exam is based on its previous-year papers', cat.pyqBased === true);
  check('catalog: a topic this exam never asked (Geometry) is not offered', !flat.includes('t-geo'));
  check('catalog: a topic without any question is not offered', !flat.includes('t-empty'));
  check('catalog: asked topics are offered with counts and Hindi names', flat.includes('t-pct') && cat.subjects[0].chapters[0].nameHindi === 'अंकगणित' && cat.subjects[0].chapters[0].topics.find((t) => t.id === 't-pct').available === 40 + 0);
  const catAll = await svc.catalog(undefined);
  check('catalog without an exam: every topic that has questions (Geometry too)', catAll.subjects.flatMap((s) => s.chapters.flatMap((c) => c.topics.map((t) => t.id))).includes('t-geo'));

  // ---- smart mock
  const sm = await svc.start('u1', { mode: 'smart', examId: 'gd' });
  const picked = sm.questions.map((x) => byId.get(x.id));
  const quant = picked.filter((q) => q.subjectId === 's-q');
  check('smart mock: 10 quant questions follow the pattern', quant.length === 10, 'got ' + quant.length);
  check('smart mock: never uses the topic the exam never asked', picked.every((q) => q.topicId !== 't-geo'));
  const pct = quant.filter((q) => q.topicId === 't-pct').length;
  const ratio = quant.filter((q) => q.topicId === 't-ratio').length;
  check('smart mock: Percentage (60 PYQ) gets twice Ratio (30 PYQ)', pct === 7 && ratio === 3, `pct ${pct} ratio ${ratio}`);
  check('smart mock: uses the test half first (all reserved)', picked.every((q) => q.testReserved === true));
  check('smart mock: no question twice', new Set(sm.questions.map((x) => x.id)).size === sm.questions.length);
  check('smart mock: only practice questions (no PYQ)', picked.every((q) => q.year == null));
  check('smart mock: English is skipped because this exam has no English previous-year question', picked.every((q) => q.subjectId !== 's-e') && sm.summary.find((s) => s.name === 'English').got === 0);
  check('smart mock: answers are not sent', sm.questions.every((x) => !('correctAnswer' in x)));
  check('smart mock: the attempt is tied to exactly these questions', global.__started.o.questionIds.length === sm.questions.length);
  check('smart mock: time follows the exam pattern, scaled to the questions it holds', sm.durationMinutes === 40, 'got ' + sm.durationMinutes);

  // ---- custom test
  const cu = await svc.start('u1', { mode: 'custom', examId: 'gd', durationMinutes: 25, items: [{ topicId: 't-pct', count: 5 }, { chapterId: 'c-q', count: 8 }] });
  const cp = cu.questions.map((x) => byId.get(x.id));
  check('custom: 13 questions, none twice', cu.questions.length === 13 && new Set(cu.questions.map((x) => x.id)).size === 13, 'got ' + cu.questions.length);
  check('custom: a whole-chapter pick skips the topic the exam never asked', cp.every((q) => q.topicId !== 't-geo'));
  check('custom: the student\'s minutes are used', cu.durationMinutes === 25);
  const short = await svc.start('u1', { mode: 'custom', examId: 'gd', items: [{ topicId: 't-pct', count: 60 }] });
  check('custom: asking for more than exists gives what exists and says so', short.questions.length === 40 && short.shortfalls.length === 1 && short.shortfalls[0].asked === 60 && short.shortfalls[0].got === 40, JSON.stringify(short.shortfalls));
  let refused = '';
  try { await svc.start('u1', { mode: 'custom', examId: 'gd', items: [{ topicId: 't-pct', count: 101 }] }); } catch (e) { refused = e.message; }
  check('custom: more than 100 questions is refused', /at most 100/.test(refused), refused);
  refused = '';
  try { await svc.start('u1', { mode: 'custom', examId: 'gd', items: [] }); } catch (e) { refused = e.message; }
  check('custom: nothing chosen is refused', /Choose at least one/.test(refused), refused);
  refused = '';
  try { await svc.start('u1', { mode: 'custom', examId: 'nope', items: [{ topicId: 't-pct', count: 1 }] }); } catch (e) { refused = e.message; }
  check('unknown exam is refused', /not available/.test(refused), refused);
  console.log(fails ? `\n${fails} FAIL` : '\nALL OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
