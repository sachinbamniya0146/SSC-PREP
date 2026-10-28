import { dropDuplicateQuestions, normText, questionFingerprint, rememberQuestions, uniquePool } from './question-fingerprint';

const opt = (...t: string[]) => t.map((text, i) => ({ key: 'ABCD'[i], text }));
const q = (id: string, questionText: string, options = opt('a', 'b', 'c', 'd'), extra: object = {}) => ({ id, questionText, optionsJson: options, ...extra });

describe('same question twice', () => {
  it('normalises case, spaces, zero-width characters, full-width forms and a trailing full stop', () => {
    expect(normText('  Hello   World. ')).toBe('hello world');
    expect(normText('He​llo')).toBe('hello');
    expect(normText('ＡＢＣ')).toBe('abc');
    expect(normText('यह क्या है।')).toBe('यह क्या है');
  });

  it('same stem + same options is the same question, whatever the id, spacing or option order', () => {
    const a = q('1', 'Select the synonym of  BRAVE.', opt('Bold', 'Weak', 'Shy', 'Lazy'));
    const b = q('2', 'select the synonym of brave', opt('Lazy', 'Shy', 'Weak', 'Bold'));
    expect(questionFingerprint(a)).toBe(questionFingerprint(b));
  });

  it('same stem but other options is a different question (generic stems are common)', () => {
    const a = q('1', 'Select the odd one out.', opt('Apple', 'Mango', 'Car', 'Banana'));
    const b = q('2', 'Select the odd one out.', opt('Dog', 'Cat', 'Rose', 'Cow'));
    expect(questionFingerprint(a)).not.toBe(questionFingerprint(b));
  });

  it('figure questions with the same words but another picture are different', () => {
    const a = q('1', 'Which figure completes the pattern?', opt('', '', '', ''), { questionImageUrl: '/img/a.png' });
    const b = q('2', 'Which figure completes the pattern?', opt('', '', '', ''), { questionImageUrl: '/img/b.png' });
    expect(questionFingerprint(a)).not.toBe(questionFingerprint(b));
    const c = q('3', 'Pick', [{ imageUrl: '/o1.png' }, { imageUrl: '/o2.png' }, { imageUrl: '/o3.png' }, { imageUrl: '/o4.png' }]);
    const d = q('4', 'Pick', [{ imageUrl: '/p1.png' }, { imageUrl: '/p2.png' }, { imageUrl: '/p3.png' }, { imageUrl: '/p4.png' }]);
    expect(questionFingerprint(c)).not.toBe(questionFingerprint(d));
  });

  it('a row with no content is never merged with another', () => {
    expect(questionFingerprint({ id: 'x', questionText: '', optionsJson: [] })).not.toBe(questionFingerprint({ id: 'y', questionText: '', optionsJson: [] }));
  });

  it('keeps the first copy and the order of the rest', () => {
    const rows = [q('1', 'A?'), q('2', 'B?'), q('3', 'a?'), q('4', 'C?')];
    expect(dropDuplicateQuestions(rows).map((r) => r.id)).toEqual(['1', '2', '4']);
  });

  it('content already used in an earlier section is skipped, when the pool is big enough', () => {
    const used = new Set<string>();
    const s1 = [q('1', 'A?'), q('2', 'B?')];
    rememberQuestions(used, s1);
    const s2 = [q('3', 'a?'), q('4', 'C?'), q('5', 'D?')];
    expect(uniquePool(s2, used, 2).map((r) => r.id)).toEqual(['4', '5']);
  });

  it('a small bank still fills the section: first "no repeats inside", then the pool as it is', () => {
    const used = new Set<string>();
    rememberQuestions(used, [q('1', 'A?')]);
    const s = [q('2', 'a?'), q('3', 'B?')];
    expect(uniquePool(s, used, 2).map((r) => r.id)).toEqual(['2', '3']); // cross-section skip would leave 1 -> falls back to inside-only
    const dup = [q('4', 'X?'), q('5', 'x?')];
    expect(uniquePool(dup, new Set(), 2).map((r) => r.id)).toEqual(['4', '5']); // only duplicates: unchanged
  });
});
