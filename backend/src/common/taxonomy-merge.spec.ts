import { pickSurvivor, planDuplicateGroups, planWeakTopicMerge, TaxRow, uniqueSlug, weakScopeKey, WeakRowLite } from './taxonomy-merge';

const row = (id: string, name: string, q: number, extra: Partial<TaxRow> = {}): TaxRow => ({
  id, parentId: 'ch1', name, nameHindi: null, slug: name.toLowerCase().replace(/\W+/g, '-'), questionCount: q, ...extra,
});

describe('pickSurvivor', () => {
  it('prefers the row with the most questions', () => {
    expect(pickSurvivor([row('a', 'Percentage', 3), row('b', 'Percentages', 40)]).id).toBe('b');
  });
  it('on a tie prefers the one with a Hindi name, then proper casing', () => {
    expect(pickSurvivor([row('a', 'PERCENTAGE', 5), row('b', 'Percentage', 5, { nameHindi: 'प्रतिशत' })]).id).toBe('b');
    expect(pickSurvivor([row('a', 'PERCENTAGE', 5), row('b', 'Percentage', 5)]).id).toBe('b');
  });
  it('is deterministic on a full tie', () => {
    expect(pickSurvivor([row('z', 'Same', 1, { slug: 's' }), row('m', 'Same', 1, { slug: 's' })]).id).toBe('m');
  });
});

describe('planDuplicateGroups', () => {
  it('groups exact duplicates inside one chapter and never across chapters', () => {
    const m = new Map<string, TaxRow[]>([
      ['ch1', [row('a', 'Percentage', 10), row('b', 'Percentages', 2), row('c', 'percentage ', 1), row('d', 'Average', 7)]],
      ['ch2', [row('e', 'Percentage', 4)]],
    ]);
    const groups = planDuplicateGroups('TOPIC', m);
    expect(groups).toHaveLength(1);
    expect(groups[0].survivorId).toBe('a');
    expect(groups[0].loserIds.sort()).toEqual(['b', 'c']);
    expect(groups[0].totalQuestions).toBe(13);
    expect(groups[0].reason).toBe('same-name');
  });

  it('links English and Hindi-only variants through nameHindi and fills the survivor Hindi name', () => {
    const m = new Map<string, TaxRow[]>([
      ['ch1', [row('a', 'Percentage', 10, { nameHindi: 'प्रतिशत' }), row('b', 'प्रतिशत', 3), row('c', 'Percent', 1, { nameHindi: 'प्रतिशत' })]],
    ]);
    const [g] = planDuplicateGroups('TOPIC', m);
    expect(g.survivorId).toBe('a');
    expect(g.mergedNameHindi).toBe('प्रतिशत');
    expect(g.reason).toBe('same-hindi');
    expect(g.loserIds.sort()).toEqual(['b', 'c']);
  });

  it('lists fuzzy matches as report-only "similar" groups', () => {
    const m = new Map<string, TaxRow[]>([['ch1', [row('a', 'Simple Interest', 5), row('b', 'Simple Intrest', 1)]]]);
    const groups = planDuplicateGroups('SUBTOPIC', m);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe('similar');
  });

  it('finds the same sub-topic under two sibling topics of one chapter (scope = chapter)', () => {
    const m = new Map<string, TaxRow[]>([
      ['ch1', [row('s1', 'Fractions', 4, { parentId: 'topicA' }), row('s2', 'Fractions', 9, { parentId: 'topicB' })]],
    ]);
    const [g] = planDuplicateGroups('SUBTOPIC', m);
    expect(g.survivorId).toBe('s2');
    expect(g.loserIds).toEqual(['s1']);
  });

  it('returns nothing for a clean chapter', () => {
    expect(planDuplicateGroups('TOPIC', new Map([['ch1', [row('a', 'Average', 1), row('b', 'Ratio', 1)]]]))).toHaveLength(0);
  });
});

const weak = (id: string, userId: string, topicId: string | null, extra: Partial<WeakRowLite> = {}): WeakRowLite => ({
  id, userId, chapterId: 'ch1', topicId, subTopicId: null, scopeKey: weakScopeKey({ chapterId: 'ch1', topicId }),
  status: 'WEAK', wrongCount: 1, attemptedCount: 2, practiceSetsDone: 0, practiceCorrect: 0, practiceTotal: 0,
  firstDetectedAt: new Date('2026-01-02'), lastDetectedAt: new Date('2026-02-02'), ...extra,
});

describe('planWeakTopicMerge', () => {
  const remap = { topic: new Map([['old', 'new']]), subTopic: new Map<string, string>() };

  it('re-keys a row that has no clash', () => {
    const plan = planWeakTopicMerge([weak('w1', 'u1', 'old')], [], remap);
    expect(plan.fold).toHaveLength(0);
    expect(plan.rekey).toEqual([{ id: 'w1', topicId: 'new', subTopicId: null, scopeKey: 'ch1|new|' }]);
  });

  it('folds into the survivor row when the same user already has it (counts add up, WEAK wins)', () => {
    const moving = [weak('w1', 'u1', 'old', { wrongCount: 3, attemptedCount: 5 })];
    const existing = [weak('w2', 'u1', 'new', { status: 'STRENGTHENED', wrongCount: 2, attemptedCount: 4 })];
    const plan = planWeakTopicMerge(moving, existing, remap);
    expect(plan.rekey).toHaveLength(0);
    expect(plan.fold).toHaveLength(1);
    expect(plan.fold[0].intoId).toBe('w2');
    expect(plan.fold[0].data.wrongCount).toBe(5);
    expect(plan.fold[0].data.attemptedCount).toBe(9);
    expect(plan.fold[0].data.status).toBe('WEAK');
  });

  it('two loser rows of one user collapse into one', () => {
    const r2 = { topic: new Map([['old1', 'new'], ['old2', 'new']]), subTopic: new Map<string, string>() };
    const moving = [weak('w1', 'u1', 'old1'), weak('w2', 'u1', 'old2', { wrongCount: 4 })];
    const plan = planWeakTopicMerge(moving, [], r2);
    expect(plan.rekey).toHaveLength(1);
    expect(plan.fold).toHaveLength(1);
    expect(plan.fold[0].data.wrongCount).toBe(5);
  });

  it('never mixes users', () => {
    const moving = [weak('w1', 'u1', 'old')];
    const existing = [weak('w2', 'u2', 'new')];
    expect(planWeakTopicMerge(moving, existing, remap).fold).toHaveLength(0);
  });
});

describe('uniqueSlug', () => {
  it('adds a numeric suffix on clash', () => {
    expect(uniqueSlug('a', new Set(['a', 'a-2']))).toBe('a-3');
    expect(uniqueSlug('b', new Set(['a']))).toBe('b');
  });
});
