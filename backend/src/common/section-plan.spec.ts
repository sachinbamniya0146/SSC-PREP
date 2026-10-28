import {
  buildSectionPlan,
  describePlanAt,
  isSectionWritable,
  negativeUnderPlan,
  readPatternSections,
  readSectionPlan,
  scoreUnderPlan,
  sectionIndexAt,
  sectionIndexForSubject,
  wasAnsweredInsideSection,
  canAcceptLateWrite,
  SECTION_WRITE_GRACE_MS,
} from './section-plan';

const tier1 = {
  negativeMarks: 0.5,
  lockPreviousSections: true,
  scribeExtraMinutes: 5,
  sections: [
    { name: 'Reasoning', subjectSlug: 'reasoning', questions: 25, marks: 50, durationMinutes: 15 },
    { name: 'GA', subjectSlug: 'general_awareness', questions: 25, marks: 50, durationMinutes: 15 },
    { name: 'Quant', subjectSlug: 'quantitative_aptitude', questions: 25, marks: 50, durationMinutes: 15 },
    { name: 'English', subjectSlug: 'english', questions: 25, marks: 50, durationMinutes: 15 },
  ],
};
const MIN = 60_000;

describe('buildSectionPlan', () => {
  it('lays sections back to back (4 x 15 min = 60 min)', () => {
    const p = buildSectionPlan(tier1)!;
    expect(p.totalMs).toBe(60 * MIN);
    expect(p.sections.map((s) => [s.startMs / MIN, s.endMs / MIN])).toEqual([[0, 15], [15, 30], [30, 45], [45, 60]]);
    expect(p.sections[0].marksPerQuestion).toBe(2);
    expect(p.negativeMarks).toBe(0.5);
    expect(p.scribe).toBe(false);
  });

  it('adds scribe time per section (15 -> 20, total 80 min)', () => {
    const p = buildSectionPlan(tier1, { scribe: true })!;
    expect(p.scribe).toBe(true);
    expect(p.totalMs).toBe(80 * MIN);
    expect(p.sections[1].startMs).toBe(20 * MIN);
  });

  it('a section-level scribeMinutes wins over the pattern-wide extra', () => {
    const p = buildSectionPlan(
      { ...tier1, sections: [{ name: 'English', subjectSlug: 'english', questions: 45, marks: 135, durationMinutes: 40, scribeMinutes: 55 }] },
      { scribe: true },
    )!;
    expect(p.sections[0].minutes).toBe(55);
  });

  it('ignores the scribe option when the pattern offers none', () => {
    const p = buildSectionPlan({ ...tier1, scribeExtraMinutes: 0 }, { scribe: true })!;
    expect(p.scribe).toBe(false);
    expect(p.totalMs).toBe(60 * MIN);
  });

  it('returns null when the flag is off, sections are empty or a duration is missing', () => {
    expect(buildSectionPlan({ ...tier1, lockPreviousSections: false })).toBeNull();
    expect(buildSectionPlan({ ...tier1, sections: [] })).toBeNull();
    expect(buildSectionPlan({ ...tier1, sections: [{ name: 'X', questions: 1, marks: 1 }] })).toBeNull();
    expect(buildSectionPlan(null)).toBeNull();
  });
});

describe('timeline lookups', () => {
  const p = buildSectionPlan(tier1)!;
  it('sectionIndexAt', () => {
    expect(sectionIndexAt(p, -1)).toBe(-1);
    expect(sectionIndexAt(p, 0)).toBe(0);
    expect(sectionIndexAt(p, 15 * MIN - 1)).toBe(0);
    expect(sectionIndexAt(p, 15 * MIN)).toBe(1);
    expect(sectionIndexAt(p, 60 * MIN)).toBe(4);
  });

  it('isSectionWritable: only the open section, plus a short grace after it closes', () => {
    expect(isSectionWritable(p, 0, 1000)).toBe(true);
    expect(isSectionWritable(p, 1, 1000)).toBe(false); // not opened yet
    expect(isSectionWritable(p, 0, 15 * MIN + SECTION_WRITE_GRACE_MS - 1)).toBe(true); // grace
    expect(isSectionWritable(p, 0, 15 * MIN + SECTION_WRITE_GRACE_MS)).toBe(false); // locked for good
    expect(isSectionWritable(p, 1, 15 * MIN)).toBe(true);
    expect(isSectionWritable(p, 9, 0)).toBe(false);
  });

  it('describePlanAt reports remaining section and total time', () => {
    const d = describePlanAt(p, 14 * MIN);
    expect(d.currentSection).toBe(0);
    expect(d.sectionRemainingMs).toBe(MIN);
    expect(d.totalRemainingMs).toBe(46 * MIN);
    expect(describePlanAt(p, 61 * MIN).finished).toBe(true);
  });

  it('sectionIndexForSubject falls back to the last section instead of dropping the question', () => {
    expect(sectionIndexForSubject(p, 'reasoning')).toBe(0);
    expect(sectionIndexForSubject(p, 'ENGLISH')).toBe(3);
    expect(sectionIndexForSubject(p, 'hindi')).toBe(3);
    expect(sectionIndexForSubject(p, null)).toBe(3);
  });

  it('wasAnsweredInsideSection accepts only stamps inside the window (+-30 s slack)', () => {
    const start = 1_000_000;
    expect(wasAnsweredInsideSection(p, 0, start + 5 * MIN, start)).toBe(true);
    expect(wasAnsweredInsideSection(p, 0, start + 15 * MIN + 20_000, start)).toBe(true);
    expect(wasAnsweredInsideSection(p, 0, start + 16 * MIN, start)).toBe(false);
    expect(wasAnsweredInsideSection(p, 1, start + 5 * MIN, start)).toBe(false);
    expect(wasAnsweredInsideSection(p, 0, NaN, start)).toBe(false);
  });
});

describe('canAcceptLateWrite', () => {
  const p = buildSectionPlan(tier1)!;
  const start = 5_000_000;
  it('accepts a stamped late write only if the server last heard from the client before the section closed', () => {
    const stamp = start + 10 * MIN; // inside section 0
    expect(canAcceptLateWrite(p, 0, stamp, start, null)).toBe(true); // never synced
    expect(canAcceptLateWrite(p, 0, stamp, start, start + 12 * MIN)).toBe(true); // went silent mid-section
    expect(canAcceptLateWrite(p, 0, stamp, start, start + 16 * MIN)).toBe(false); // was connected after it closed
  });
  it('rejects stamps outside the section window or missing', () => {
    expect(canAcceptLateWrite(p, 0, start + 20 * MIN, start, null)).toBe(false);
    expect(canAcceptLateWrite(p, 0, NaN, start, null)).toBe(false);
  });
});

describe('scoreUnderPlan', () => {
  const p = buildSectionPlan(tier1)!;
  it('+2 correct, -0.5 wrong, 0 skipped', () => {
    expect(scoreUnderPlan(p, 0, true, true, { marks: 1 })).toBe(2);
    expect(scoreUnderPlan(p, 0, false, true, { marks: 1 })).toBe(-0.5);
    expect(scoreUnderPlan(p, 0, false, false, { marks: 1 })).toBe(0);
  });
});

describe('readSectionPlan', () => {
  it('round-trips through JSON and rejects junk', () => {
    const p = buildSectionPlan(tier1)!;
    expect(readSectionPlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(readSectionPlan(null)).toBeNull();
    expect(readSectionPlan({ v: 2 })).toBeNull();
  });
});

describe('per-section negative marking (28 Oct 2026)', () => {
  const mtsLike = {
    negativeMarks: 1,
    lockPreviousSections: true,
    scribeExtraMinutes: 0,
    sections: [
      { name: 'S1 Maths', subjectSlug: 'quantitative_aptitude', questions: 20, marks: 60, durationMinutes: 22.5, negativeMarks: 0 },
      { name: 'S2 GA', subjectSlug: 'general_awareness', questions: 25, marks: 75, durationMinutes: 22.5, negativeMarks: 1 },
    ],
  };

  it('a section may carry its own penalty, 0 included; the plan keeps it', () => {
    const p = buildSectionPlan(mtsLike)!;
    expect(p.sections.map((x) => x.negativeMarks)).toEqual([0, 1]);
    expect(p.sections.map((x) => x.marksPerQuestion)).toEqual([3, 3]);
  });

  it('scoreUnderPlan uses the section penalty (a wrong answer in a no-negative section costs nothing)', () => {
    const p = buildSectionPlan(mtsLike)!;
    expect(scoreUnderPlan(p, 0, false, true, { marks: 2 })).toBe(0);
    expect(scoreUnderPlan(p, 1, false, true, { marks: 2 })).toBe(-1);
    expect(scoreUnderPlan(p, 0, true, true, { marks: 2 })).toBe(3);
    expect(negativeUnderPlan(p, 0)).toBe(0);
    expect(negativeUnderPlan(p, 1)).toBe(1);
  });

  it('without a section value the pattern-wide penalty applies (all patterns saved before today)', () => {
    const p = buildSectionPlan(tier1)!;
    expect(p.sections.every((x) => x.negativeMarks === undefined)).toBe(true);
    expect(negativeUnderPlan(p, 2)).toBe(0.5);
    // a plan frozen in the DB before this change is read back unchanged
    expect(scoreUnderPlan(readSectionPlan(JSON.parse(JSON.stringify(p)))!, 1, false, true, { marks: 2 })).toBe(-0.5);
  });

  it('junk values are ignored, not trusted', () => {
    const rows = readPatternSections([{ name: 'A', questions: 1, marks: 1, negativeMarks: 'abc' }, { name: 'B', questions: 1, marks: 1, negativeMarks: -3 }, { name: 'C', questions: 1, marks: 1, negativeMarks: '0.25' }]);
    expect(rows.map((r) => r.negativeMarks)).toEqual([undefined, 0, 0.25]);
  });
});
