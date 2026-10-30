import { normKey, scoreBatchAnswers } from './attempt-batch';

const rows = [
  { id: 'q1', correctAnswer: 'B', explanation: 'e1' },
  { id: 'q2', correctAnswer: ' c ', explanation: null }, // legacy dirty value
  { id: 'q3', correctAnswer: 'a' }, // legacy lowercase
  { id: 'q4', correctAnswer: '' }, // broken key: nothing can be right
];
const rule = () => ({ marks: 2, negative: 0.5 });

describe('batch practice scoring (S47)', () => {
  it('a right answer is right whatever the case / spaces of the stored key or of the choice', () => {
    const r = scoreBatchAnswers([{ questionId: 'q1', selectedOption: 'b' }, { questionId: 'q2', selectedOption: 'C' }, { questionId: 'q3', selectedOption: ' A ' }], rows, rule);
    expect(r.correct).toBe(3);
    expect(r.wrong).toBe(0);
    expect(r.score).toBe(6);
    expect(r.results.q2.correctAnswer).toBe('C');
  });
  it('100 answers in one call: every right one is right, nothing is dropped', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `x${i}`, correctAnswer: 'ABCD'[i % 4] }));
    const r = scoreBatchAnswers(many.map((q) => ({ questionId: q.id, selectedOption: q.correctAnswer })), many, rule);
    expect(Object.keys(r.results)).toHaveLength(100);
    expect(r.correct).toBe(100);
    expect(r.wrong).toBe(0);
    expect(r.missing).toEqual([]);
  });
  it('a wrong answer costs the negative mark; a skipped one costs nothing and is not in the result', () => {
    const r = scoreBatchAnswers([{ questionId: 'q1', selectedOption: 'A' }, { questionId: 'q2', selectedOption: null }, { questionId: 'q3', selectedOption: '' }], rows, rule);
    expect(r.wrong).toBe(1);
    expect(r.score).toBe(-0.5);
    expect(Object.keys(r.results)).toEqual(['q1']);
  });
  it('an unknown / unpublished question is reported as missing, never as wrong', () => {
    const r = scoreBatchAnswers([{ questionId: 'nope', selectedOption: 'A' }, { questionId: 'q1', selectedOption: 'B' }], rows, rule);
    expect(r.missing).toEqual(['nope']);
    expect(r.wrong).toBe(0);
    expect(r.correct).toBe(1);
  });
  it('a question with an empty key can never be marked right', () => {
    const r = scoreBatchAnswers([{ questionId: 'q4', selectedOption: 'A' }], rows, rule);
    expect(r.results.q4.correct).toBe(false);
  });
  it('the same question twice counts once', () => {
    const r = scoreBatchAnswers([{ questionId: 'q1', selectedOption: 'B' }, { questionId: 'q1', selectedOption: 'A' }], rows, rule);
    expect(r.correct + r.wrong).toBe(1);
    expect(r.score).toBe(2);
  });
  it('marks come from the rule given (exam preset), 1/3-mark schemes do not leave float dust', () => {
    const r = scoreBatchAnswers([{ questionId: 'q1', selectedOption: 'A' }, { questionId: 'q2', selectedOption: 'C' }], rows, () => ({ marks: 0.3, negative: 0.1 }));
    expect(r.score).toBe(0.2);
  });
  it('normKey', () => {
    expect(normKey(' d ')).toBe('D');
    expect(normKey(null)).toBe('');
  });
});
