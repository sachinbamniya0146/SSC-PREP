import { findTaxonomyTwin, keySimilarity, makeTaxonomySlug, normalizeTaxonomyKey, sameTaxonomy } from './taxonomy-key';

describe('normalizeTaxonomyKey', () => {
  it.each([
    ['Percentage', 'percentage'],
    ['Percentages', 'percentage'],
    ['  percentage  ', 'percentage'],
    ['Percentage (प्रतिशत)', 'percentage'],
    ['Profit & Loss', 'profit and loss'],
    ['Profit and Loss', 'profit and loss'],
    ['PROFIT  &  LOSS!!', 'profit and loss'],
    ['Ratio-and-Proportion', 'ratio and proportion'],
    ['The Number System', 'number system'],
    ['Number Systems', 'number system'],
    ['Analogies', 'analogy'],
    ['प्रतिशत', 'प्रतिशत'],
    ['', ''],
  ])('%s', (input, expected) => {
    expect(normalizeTaxonomyKey(input)).toBe(expected);
  });

  it('is idempotent', () => {
    for (const n of ['Profit & Loss', 'Percentages', 'Series', 'Time and Work']) {
      expect(normalizeTaxonomyKey(normalizeTaxonomyKey(n))).toBe(normalizeTaxonomyKey(n));
    }
  });
});

describe('sameTaxonomy / findTaxonomyTwin', () => {
  const siblings = [
    { id: 'a', name: 'Percentage', nameHindi: 'प्रतिशत' },
    { id: 'b', name: 'Time and Work', nameHindi: null },
    { id: 'c', name: 'Simple Interest' },
  ];

  it('treats spelling/plural/& variants as the same', () => {
    expect(sameTaxonomy({ name: 'A & B' }, { name: 'a and b' })).toBe(true);
    expect(findTaxonomyTwin(siblings, 'Percentages')?.row.id).toBe('a');
    expect(findTaxonomyTwin(siblings, 'Percentages')?.kind).toBe('exact');
  });

  it('matches a Hindi-only name through nameHindi', () => {
    const t = findTaxonomyTwin(siblings, 'प्रतिशत');
    expect(t?.row.id).toBe('a');
    expect(t?.kind).toBe('hindi');
  });

  it('flags (never silently reuses) a close misspelling', () => {
    const t = findTaxonomyTwin(siblings, 'Simple Intrest');
    expect(t?.kind).toBe('similar');
    expect(t?.row.id).toBe('c');
  });

  it('word order is tolerated by the similarity score', () => {
    expect(findTaxonomyTwin(siblings, 'Work and Time')?.kind).toBe('similar');
  });

  it('returns null for a genuinely different topic', () => {
    expect(findTaxonomyTwin(siblings, 'Compound Interest')).toBeNull();
    expect(keySimilarity('average', 'percentage')).toBeLessThan(0.5);
  });
});

describe('makeTaxonomySlug', () => {
  it('is readable for English', () => {
    expect(makeTaxonomySlug('Profit & Loss')).toBe('profit-and-loss');
    expect(makeTaxonomySlug('Series')).toBe('series');
  });
  it('gives different slugs to different Hindi-only names (used to be "item" for all)', () => {
    const a = makeTaxonomySlug('प्रतिशत');
    const b = makeTaxonomySlug('औसत');
    expect(a).not.toBe(b);
    expect(a.startsWith('h-')).toBe(true);
    expect(makeTaxonomySlug('प्रतिशत')).toBe(a);
  });
});
