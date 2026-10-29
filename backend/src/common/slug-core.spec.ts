import { chapterRefWords, examCoreKey, findExamBySlugs, isEnglishSubjectSlug, subjectCoreKey, subjectIdsFor } from './slug-core';

describe('slug core keys (both spellings mean the same exam / subject)', () => {
  it('exam: exam- prefix, case, spaces and underscores do not matter', () => {
    expect(examCoreKey('exam-cgl')).toBe('cgl');
    expect(examCoreKey(' CGL ')).toBe('cgl');
    expect(examCoreKey('EXAM_RRB_NTPC')).toBe('rrb-ntpc');
    expect(examCoreKey('rrb-ntpc')).toBe('rrb-ntpc');
    expect(examCoreKey(null)).toBe('');
  });

  it('subject: sub- prefix and hyphen vs underscore do not matter', () => {
    expect(subjectCoreKey('sub-quantitative_aptitude')).toBe('quantitative_aptitude');
    expect(subjectCoreKey('quantitative-aptitude')).toBe('quantitative_aptitude');
    expect(subjectCoreKey('sub-english')).toBe('english');
    expect(subjectCoreKey('general_awareness')).toBe('general_awareness');
    expect(subjectCoreKey('')).toBe('');
  });

  it('every subject of the same core is returned, the exact slug first', () => {
    const subs = [
      { id: 'a', slug: 'reasoning' },
      { id: 'b', slug: 'sub-reasoning' },
      { id: 'c', slug: 'sub-english' },
    ];
    expect(subjectIdsFor(subs, 'reasoning')).toEqual(['a', 'b']);
    expect(subjectIdsFor(subs, 'sub-reasoning')).toEqual(['b', 'a']);
    expect(subjectIdsFor(subs, 'english')).toEqual(['c']);
    expect(subjectIdsFor(subs, 'general_awareness')).toEqual([]);
    expect(subjectIdsFor(subs, '')).toEqual([]);
  });

  it('exam lookup: exact slug wins, otherwise the core key', () => {
    const exams = [
      { id: '1', slug: 'exam-cgl' },
      { id: '2', slug: 'chsl' },
    ];
    expect(findExamBySlugs(exams, ['cgl'])?.id).toBe('1');
    expect(findExamBySlugs(exams, ['exam-chsl'])?.id).toBe('2');
    expect(findExamBySlugs(exams, ['mts'])).toBeUndefined();
    const both = [{ id: 'x', slug: 'cgl' }, { id: 'y', slug: 'exam-cgl' }];
    expect(findExamBySlugs(both, ['exam-cgl'])?.id).toBe('y');
    expect(findExamBySlugs(both, ['cgl'])?.id).toBe('x');
  });

  it('English in every spelling is Hindi-exempt, nothing else is', () => {
    for (const s of ['english', 'sub-english', 'English_Language', 'sub-english_grammar']) expect(isEnglishSubjectSlug(s)).toBe(true);
    for (const s of ['englishx', 'sub-hindi', 'reasoning', '']) expect(isEnglishSubjectSlug(s)).toBe(false);
  });
});

describe('Master Package chapter ids (S45)', () => {
  it('"chap-<name>-<subject>" gives the chapter words', () => {
    expect(chapterRefWords('chap-percentage-quantitative_aptitude')).toBe('percentage');
    expect(chapterRefWords('chap-coding_decoding-reasoning')).toBe('coding decoding');
    expect(chapterRefWords('chap-static_gk-general_awareness')).toBe('static gk');
    expect(chapterRefWords('Chap-Physics-general_science')).toBe('physics');
    expect(chapterRefWords('percentage')).toBeNull();
    expect(chapterRefWords('')).toBeNull();
  });
});
