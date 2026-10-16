import { ProviderBusyError, QuestionCtx, runItem, validateHindiGen } from './ai-job.runner';

const base = (o: Partial<QuestionCtx> = {}): QuestionCtx => ({
  id: 'q1', questionNo: 7, questionText: 'What is 25% of 480?',
  questionTextHindi: null,
  options: [{ key: 'A', text: '100' }, { key: 'B', text: '120' }, { key: 'C', text: '140' }, { key: 'D', text: '160' }],
  correctAnswer: 'B', explanation: null, explanationHindi: null, subjectName: 'Maths', chapterId: null, chapterName: null, topicId: null, hindiExempt: true, ...o,
});
const SOL = (a: string) => JSON.stringify({ answer: a, solution: 'Step 1: 480 x 25 / 100 = 120. So the answer is option B.' });
const script = (answers: string[]) => { let i = 0; const calls: string[] = []; return { calls, ask: async (p: string) => { calls.push(p); const v = answers[Math.min(i, answers.length - 1)]; i++; if (v === 'BUSY') throw new ProviderBusyError(); if (v === 'THROW') throw new Error('boom'); return v; } }; };
const o = { passes: 5, minAgree: 3 };

describe('SOLUTION_GENERATE', () => {
  it('5/5 agree with stored key -> DONE, 3 calls only (early stop)', async () => {
    const s = script([SOL('B')]);
    const r = await runItem('SOLUTION_GENERATE', base(), s.ask, o);
    expect(r.status).toBe('DONE');
    expect(r.proposal?.explanation).toContain('120');
    expect(s.calls.length).toBe(3);
  });
  it('3/5 with 2 bad JSON passes still DONE', async () => {
    const s = script(['not json', SOL('B'), '{"answer":"Z"}', SOL('B'), SOL('B')]);
    const r = await runItem('SOLUTION_GENERATE', base(), s.ask, o);
    expect(r.status).toBe('DONE');
    expect(r.passes.filter((p) => !p.ok).length).toBe(2);
  });
  it('2/5 partial agreement -> NEEDS_REVIEW, nothing proposed to write', async () => {
    const r = await runItem('SOLUTION_GENERATE', base(), script([SOL('B'), SOL('C'), SOL('B'), SOL('C'), SOL('D')]).ask, o);
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.proposal?.explanation).toBeUndefined();
  });
  it('AI majority contradicts the stored key -> review, solution NOT written', async () => {
    const r = await runItem('SOLUTION_GENERATE', base(), script([SOL('C')]).ask, o);
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.proposal).toMatchObject({ kind: 'ANSWER_CONFLICT', aiAnswer: 'C', storedAnswer: 'B' });
  });
  it('existing admin solution is never touched', async () => {
    const s = script([SOL('B')]);
    const r = await runItem('SOLUTION_GENERATE', base({ explanation: 'admin wrote this' }), s.ask, o);
    expect(r.status).toBe('SKIPPED');
    expect(s.calls.length).toBe(0);
  });
  it('all passes invalid -> FAILED; busy keys propagate', async () => {
    expect((await runItem('SOLUTION_GENERATE', base(), script(['garbage']).ask, o)).status).toBe('FAILED');
    expect((await runItem('SOLUTION_GENERATE', base(), script(['THROW']).ask, o)).status).toBe('FAILED');
    await expect(runItem('SOLUTION_GENERATE', base(), script(['BUSY']).ask, o)).rejects.toBeInstanceOf(ProviderBusyError);
  });
  it('question with broken options / key is skipped', async () => {
    expect((await runItem('SOLUTION_GENERATE', base({ correctAnswer: '' }), script([SOL('B')]).ask, o)).status).toBe('SKIPPED');
  });
});

describe('ANSWER_KEY_VERIFY', () => {
  const A = (a: string) => JSON.stringify({ answer: a, reason: 'r' });
  it('key ok', async () => expect((await runItem('ANSWER_KEY_VERIFY', base(), script([A('B')]).ask, o)).proposal).toMatchObject({ kind: 'KEY_OK' }));
  it('key wrong -> review with change', async () => {
    const r = await runItem('ANSWER_KEY_VERIFY', base(), script([A('D')]).ask, o);
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.proposal).toMatchObject({ kind: 'ANSWER_CHANGE', from: 'B', to: 'D' });
  });
  it('prompt never leaks the stored key (independent passes)', async () => {
    const s = script([A('B')]);
    await runItem('ANSWER_KEY_VERIFY', base(), s.ask, o);
    expect(s.calls.every((p) => !/Stored answer key/.test(p))).toBe(true);
  });
});

describe('HINDI_TRANSLATE', () => {
  const ctx = () => base({ hindiExempt: false });
  const GEN = JSON.stringify({ questionHi: '480 का 25% क्या है?', optionsHi: ['100', '120', '140', '160'] });
  const OK = JSON.stringify({ faithful: true });
  it('valid translation + verifiers agree -> DONE', async () => {
    const r = await runItem('HINDI_TRANSLATE', ctx(), script([GEN, OK, OK, OK, OK]).ask, o);
    expect(r.status).toBe('DONE');
    expect(r.proposal?.questionTextHindi).toContain('480');
  });
  it('verifiers disagree -> NEEDS_REVIEW', async () => {
    const BAD = JSON.stringify({ faithful: false, problem: 'x' });
    expect((await runItem('HINDI_TRANSLATE', ctx(), script([GEN, OK, BAD, BAD, OK]).ask, o)).status).toBe('NEEDS_REVIEW');
  });
  it('changed number / English text instead of Hindi is rejected before verification', async () => {
    const q = ctx();
    expect(validateHindiGen(q, { questionHi: '480 का 52% क्या है?', optionsHi: ['100', '120', '140', '160'] }, { question: true, options: true, solution: false })).toMatch(/numbers/);
    expect(validateHindiGen(q, { questionHi: 'What is 25% of 480?', optionsHi: ['1', '2', '3', '4'] }, { question: true, options: true, solution: false })).toMatch(/not Hindi/);
    const r = await runItem('HINDI_TRANSLATE', q, script([JSON.stringify({ questionHi: 'English only 480 25%', optionsHi: ['100', '120', '140', '160'] })]).ask, o);
    expect(r.status).toBe('FAILED');
  });
  it('exempt subject (English) and already-complete Hindi are skipped', async () => {
    expect((await runItem('HINDI_TRANSLATE', base(), script([GEN]).ask, o)).status).toBe('SKIPPED');
    const full = base({ hindiExempt: false, questionTextHindi: 'x', options: base().options.map((x) => ({ ...x, textHi: 'x' })) });
    expect((await runItem('HINDI_TRANSLATE', full, script([GEN]).ask, o)).status).toBe('SKIPPED');
  });
  it('only missing parts are proposed (existing Hindi kept)', async () => {
    const q = base({ hindiExempt: false, questionTextHindi: 'पहले से है', options: base().options.map((x) => ({ ...x, textHi: undefined })) });
    const g = JSON.stringify({ optionsHi: ['100', '120', '140', '160'] });
    const r = await runItem('HINDI_TRANSLATE', q, script([g, OK, OK, OK, OK]).ask, o);
    expect(r.status).toBe('DONE');
    expect(r.proposal?.questionTextHindi).toBeUndefined();
    expect(r.proposal?.optionsHi).toBeDefined();
  });
});

describe('CHAPTER_TOPIC_CLASSIFY', () => {
  const chapters = [{ id: 'c1', name: 'Percentage', topics: [{ id: 't1', name: 'Basics' }] }, { id: 'c2', name: 'Algebra', topics: [] }];
  const C = (c: string, t = '') => JSON.stringify({ chapterId: c, topicId: t, confidence: 0.9 });
  it('majority chapter differs from current -> NEEDS_REVIEW (never auto-applied)', async () => {
    const r = await runItem('CHAPTER_TOPIC_CLASSIFY', base({ chapters, chapterId: 'c2', chapterName: 'Algebra' }), script([C('c1', 't1')]).ask, o);
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.proposal).toMatchObject({ kind: 'CLASSIFY_CHANGE', chapterId: 'c1', topicId: 't1' });
  });
  it('same as current -> DONE no change', async () => {
    const r = await runItem('CHAPTER_TOPIC_CLASSIFY', base({ chapters, chapterId: 'c1', topicId: 't1' }), script([C('c1', 't1')]).ask, o);
    expect(r.status).toBe('DONE');
    expect(r.proposal).toMatchObject({ kind: 'CLASSIFY_OK' });
  });
  it('hallucinated ids never count; split vote -> FAILED (not guessed)', async () => {
    expect((await runItem('CHAPTER_TOPIC_CLASSIFY', base({ chapters }), script([C('zzz')]).ask, o)).status).toBe('FAILED');
    expect((await runItem('CHAPTER_TOPIC_CLASSIFY', base({ chapters }), script([C('c1'), C('c2'), C('c1'), C('c2'), C('zzz')]).ask, o)).status).toBe('FAILED');
  });
});

describe('A2 quality gates in the runner', () => {
  it('solution that ends on a DIFFERENT option than the key -> NEEDS_REVIEW, never written', async () => {
    const bad = JSON.stringify({ answer: 'B', solution: 'We compute 480 x 25 / 100 = 120. Hence the correct answer is option C.' });
    const r = await runItem('SOLUTION_GENERATE', base(), script([bad]).ask, o);
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.proposal).toMatchObject({ kind: 'SOLUTION_KEY_MISMATCH', solutionSays: 'C' });
  });
  it('low confidence (below AI_MIN_CONFIDENCE) -> review instead of auto-write', async () => {
    process.env.AI_MIN_CONFIDENCE = '0.8';
    const r = await runItem('SOLUTION_GENERATE', base(), script([SOL('B'), SOL('B'), SOL('C'), SOL('B'), SOL('D')]).ask, o);
    delete process.env.AI_MIN_CONFIDENCE;
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.proposal).toMatchObject({ kind: 'LOW_CONFIDENCE' });
    expect(r.confidence).toBe(0.75); // early stop after 3 agreeing of 4 votes
  });
  it('confidence is reported on a normal DONE', async () => {
    const r = await runItem('SOLUTION_GENERATE', base(), script([SOL('B')]).ask, o);
    expect(r.status).toBe('DONE');
    expect(r.confidence).toBe(1);
  });

  const ctx = () => base({ hindiExempt: false });
  const GEN = JSON.stringify({ questionHi: '480 का 25% क्या है?', optionsHi: ['100', '120', '140', '160'] });
  const OK = JSON.stringify({ faithful: true });
  const BT = (items: string[]) => JSON.stringify({ items });
  it('Hindi back-translation that matches -> DONE', async () => {
    const r = await runItem('HINDI_TRANSLATE', ctx(), script([GEN, BT(['What is 25% of 480?', '100', '120', '140', '160']), OK, OK, OK]).ask, o);
    expect(r.status).toBe('DONE');
    expect(r.passes.some((p) => p.stage === 'back-translate' && p.ok)).toBe(true);
  });
  it('Hindi back-translation that drifted -> NEEDS_REVIEW with the proposal kept for the admin', async () => {
    const r = await runItem('HINDI_TRANSLATE', ctx(), script([GEN, BT(['The boy eats a ripe mango today', '999', '888', '777', '666']), OK, OK, OK]).ask, o);
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.proposal?.questionTextHindi).toContain('480');
    expect(r.note).toMatch(/wapas English/);
  });
});
