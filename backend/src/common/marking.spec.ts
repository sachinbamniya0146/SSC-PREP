/* eslint-disable @typescript-eslint/no-explicit-any */
import { EXAM_PRESETS } from './exam-presets';
import { buildMarkingScheme, resolveMarking, schemeMaxMarks, scoreAnswer, totalMarksFor } from './marking';
import { buildSectionPlan } from './section-plan';

const presetByKey = (key: string) => {
  const p = EXAM_PRESETS.find((x) => x.key === key);
  if (!p) throw new Error(`no preset ${key}`);
  return p;
};
const schemeOf = (key: string) => {
  const p = presetByKey(key);
  const s = buildMarkingScheme({ name: p.name, negativeMarks: p.negativeMarks, sections: p.sections });
  if (!s) throw new Error(`no scheme for ${key}`);
  return s;
};

// What the OFFICIAL notices say, written down independently of exam-presets.ts so that a typo there is caught here.
// [preset key, subject slug, marks per question, penalty per wrong answer, questions in the paper, total marks]
const OFFICIAL: [string, string | null, number, number, number, number][] = [
  ['cgl-t1', 'reasoning', 2, 0.5, 100, 200],
  ['cgl-t1', 'general_awareness', 2, 0.5, 100, 200],
  ['cgl-t1', 'quantitative_aptitude', 2, 0.5, 100, 200],
  ['cgl-t1', 'english', 2, 0.5, 100, 200],
  ['cgl-t2-p1', 'quantitative_aptitude', 3, 1, 150, 450],
  ['cgl-t2-p1', 'reasoning', 3, 1, 150, 450],
  ['cgl-t2-p1', 'english', 3, 1, 150, 450],
  ['cgl-t2-p1', 'general_awareness', 3, 1, 150, 450],
  ['cgl-t2-p1', 'computer', 3, 1, 150, 450],
  ['cgl-t2-p2', 'statistics', 2, 0.5, 100, 200],
  ['chsl-t1', 'english', 2, 0.5, 100, 200],
  ['chsl-t1', 'reasoning', 2, 0.5, 100, 200],
  ['chsl-t2', 'quantitative_aptitude', 3, 1, 135, 405],
  ['chsl-t2', 'english', 3, 1, 135, 405],
  ['chsl-t2', 'computer', 3, 1, 135, 405],
  ['mts', 'quantitative_aptitude', 3, 0, 90, 270], // Session I: no negative marking
  ['mts', 'reasoning', 3, 0, 90, 270],
  ['mts', 'general_awareness', 3, 1, 90, 270], // Session II: -1 per wrong answer
  ['mts', 'english', 3, 1, 90, 270],
  ['cpo-p1', 'reasoning', 1, 0.25, 200, 200],
  ['cpo-p1', 'quantitative_aptitude', 1, 0.25, 200, 200],
  ['cpo-p2', 'english', 1, 0.25, 200, 200],
  ['gd', 'reasoning', 2, 0.25, 80, 160],
  ['gd', 'english', 2, 0.25, 80, 160],
  ['steno', 'english', 1, 0.25, 200, 200],
  ['steno', 'reasoning', 1, 0.25, 200, 200],
  ['je-p1', 'general_engineering', 1, 0.25, 200, 200],
  ['je-p2', 'civil', 3, 1, 100, 300],
  ['selection-post', 'general_awareness', 2, 0.5, 100, 200],
];

describe('exam presets score like the official notices', () => {
  it.each(OFFICIAL)('%s · %s -> +%s / -%s', (key, slug, marks, negative, totalQ, totalMarks) => {
    const scheme = schemeOf(key);
    const rule = resolveMarking({ scheme, subjectSlug: slug, question: { marks: 99, negativeMarks: 99 } });
    expect(rule).toEqual({ marks, negative, source: 'pattern' });
    expect(scheme.totalQuestions).toBe(totalQ);
    expect(scheme.totalMarks).toBe(totalMarks);
  });

  it('every preset is covered by at least one row of the table above', () => {
    const covered = new Set(OFFICIAL.map((r) => r[0]));
    for (const p of EXAM_PRESETS) expect(covered.has(p.key)).toBe(true);
  });

  it('a perfect paper scores exactly the total marks of every preset', () => {
    for (const p of EXAM_PRESETS) {
      const scheme = schemeOf(p.key);
      const perfect = scheme.sections.reduce((a, s) => a + s.questions * s.marksPerQuestion, 0);
      expect(Math.round(perfect * 100) / 100).toBe(p.totalMarks);
    }
  });
});

describe('resolveMarking order of authority', () => {
  const q = { marks: 2, negativeMarks: 0.5 };

  it('question columns are only the last resort (no plan, no preset)', () => {
    expect(resolveMarking({ question: { marks: 4, negativeMarks: 1 } })).toEqual({ marks: 4, negative: 1, source: 'question' });
    expect(resolveMarking({ question: {} })).toEqual({ marks: 2, negative: 0.5, source: 'question' });
    expect(resolveMarking({})).toEqual({ marks: 2, negative: 0.5, source: 'question' });
  });

  it('the preset beats the question columns (CPO: 1 / -0.25, not the column default 2 / -0.5)', () => {
    expect(resolveMarking({ scheme: schemeOf('cpo-p1'), subjectSlug: 'english', question: q })).toEqual({ marks: 1, negative: 0.25, source: 'pattern' });
  });

  it('a subject the mixed-rate preset does not name falls back to the question, not to a wrong section', () => {
    expect(resolveMarking({ scheme: schemeOf('mts'), subjectSlug: 'computer', question: q })).toEqual({ marks: 2, negative: 0.5, source: 'question' });
    expect(resolveMarking({ scheme: schemeOf('mts'), subjectSlug: null, question: q }).source).toBe('question');
  });

  it('a uniform preset also scores subjects it does not name (JE engineering branches, statistics)', () => {
    expect(resolveMarking({ scheme: schemeOf('je-p1'), subjectSlug: 'civil', question: q })).toEqual({ marks: 1, negative: 0.25, source: 'pattern' });
  });

  it('a frozen section plan beats the preset, per-section penalty included', () => {
    const mts = presetByKey('mts');
    const plan = buildSectionPlan({
      negativeMarks: mts.negativeMarks,
      lockPreviousSections: true,
      scribeExtraMinutes: 0,
      sections: mts.sections.map((s) => ({ ...s, durationMinutes: 22.5 })),
    })!;
    expect(resolveMarking({ plan, scheme: schemeOf('cpo-p1'), subjectSlug: 'quantitative_aptitude', question: q })).toEqual({ marks: 3, negative: 0, source: 'plan' });
    expect(resolveMarking({ plan, subjectSlug: 'english', question: q })).toEqual({ marks: 3, negative: 1, source: 'plan' });
  });

  it('a plan frozen BEFORE per-section penalties existed keeps its single penalty', () => {
    const plan = buildSectionPlan({
      negativeMarks: 0.5,
      lockPreviousSections: true,
      scribeExtraMinutes: 0,
      sections: [{ name: 'A', subjectSlug: 'reasoning', questions: 2, marks: 4, durationMinutes: 10 }],
    })!;
    expect(plan.sections[0].negativeMarks).toBeUndefined();
    expect(resolveMarking({ plan, subjectSlug: 'reasoning', question: q })).toEqual({ marks: 2, negative: 0.5, source: 'plan' });
  });
});

describe('scoring and totals', () => {
  it('scoreAnswer: unanswered 0, right +marks, wrong -negative', () => {
    const rule = { marks: 3, negative: 1, source: 'pattern' as const };
    expect(scoreAnswer(rule, false, false)).toBe(0);
    expect(scoreAnswer(rule, true, true)).toBe(3);
    expect(scoreAnswer(rule, true, false)).toBe(-1);
  });

  it('MTS worked example: 20 right in Session I, 10 right + 10 wrong + 5 blank in Session II', () => {
    const scheme = schemeOf('mts');
    const score = (slug: string, right: number, wrong: number) => {
      const rule = resolveMarking({ scheme, subjectSlug: slug, question: {} });
      return right * scoreAnswer(rule, true, true) + wrong * scoreAnswer(rule, true, false);
    };
    // Session I: 20 correct in maths, 15 right + 5 wrong in reasoning (wrong answers are free)
    expect(score('quantitative_aptitude', 20, 0) + score('reasoning', 15, 5)).toBe(105);
    // Session II: GA 10 right + 10 wrong (-10), English 25 right
    expect(score('general_awareness', 10, 10) + score('english', 25, 0)).toBe(30 - 10 + 75);
  });

  it('CPO worked example: 120 right, 40 wrong, 40 blank = 120 - 10 = 110 of 200', () => {
    const rule = resolveMarking({ scheme: schemeOf('cpo-p1'), subjectSlug: 'reasoning', question: {} });
    expect(120 * rule.marks - 40 * rule.negative).toBe(110);
  });

  it('totalMarksFor sums the rule of every question', () => {
    const rows = [
      { subjectSlug: 'quantitative_aptitude' },
      { subjectSlug: 'general_awareness' },
      { subjectSlug: 'english' },
    ];
    expect(totalMarksFor(schemeOf('mts'), rows)).toBe(9);
    expect(totalMarksFor(null, [{ marks: 2 }, { marks: 1 }, {}])).toBe(5);
  });

  it('schemeMaxMarks: full paper, uniform partial paper, mixed partial paper', () => {
    expect(schemeMaxMarks(schemeOf('cpo-p1'), 200)).toBe(200);
    expect(schemeMaxMarks(schemeOf('cpo-p1'), 100)).toBe(100); // a half-built / 100-question family mock
    expect(schemeMaxMarks(schemeOf('cgl-t1'), 50)).toBe(100);
    expect(schemeMaxMarks(schemeOf('mts'), 45)).toBe(135); // 270 x 45/90
  });

  it('a pattern without any usable section gives no scheme', () => {
    expect(buildMarkingScheme(null)).toBeNull();
    expect(buildMarkingScheme({ sections: [] })).toBeNull();
    expect(buildMarkingScheme({ sections: [{ name: 'x', questions: 0, marks: 10 }] })).toBeNull();
    expect(buildMarkingScheme({ sections: 'nope' })).toBeNull();
  });
});
