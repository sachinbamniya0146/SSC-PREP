import { pickQuestionsSheetName } from './excel-sheet';

const heads = (m: Record<string, unknown[]>) => (n: string) => m[n] ?? [];

describe('pickQuestionsSheetName', () => {
  it('v3 template: skips README and takes "Questions"', () => {
    const names = ['README', 'Questions', 'Example rows', 'Columns guide'];
    expect(pickQuestionsSheetName(names, heads({ README: ['Welcome'], Questions: ['examId*', 'questionText*'] }))).toBe('Questions');
  });
  it('"Questions Import" wins over "Questions"', () => {
    expect(pickQuestionsSheetName(['Complete Source Set', 'Questions', 'Questions Import'], heads({}))).toBe('Questions Import');
    expect(pickQuestionsSheetName(['questions_import'], heads({}))).toBe('questions_import');
  });
  it('falls back to header sniffing, ignoring trailing *', () => {
    const names = ['Info', 'Data'];
    expect(pickQuestionsSheetName(names, heads({ Info: ['a'], Data: ['examId *', 'questionText'] }))).toBe('Data');
  });
  it('single-sheet / unknown files keep the old behaviour (first sheet)', () => {
    expect(pickQuestionsSheetName(['Sheet1'], heads({ Sheet1: ['x'] }))).toBe('Sheet1');
    expect(pickQuestionsSheetName(['A', 'B'], heads({}))).toBe('A');
  });
  it('empty workbook', () => {
    expect(pickQuestionsSheetName([], heads({}))).toBeUndefined();
  });
  it('is self-contained so it survives Function#toString into the worker thread', () => {
    const src = pickQuestionsSheetName.toString();
    // eslint-disable-next-line no-new-func
    const standalone = new Function(`return (${src});`)() as typeof pickQuestionsSheetName;
    expect(standalone(['README', 'Questions'], () => [])).toBe('Questions');
  });
});
