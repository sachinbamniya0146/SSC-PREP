// The per-question AI work of every job type (NEW Oct 15 2026).
// Pure: the model is reached ONLY through the injected `ask` callback, so the same code runs against the real
// provider in production and against a mock OpenRouter server in the tests.
import {
  ANSWER_SCHEMA,
  HINDI_SCHEMA,
  JobType,
  SOLUTION_SCHEMA,
  VERIFY_SCHEMA,
  canStopEarly,
  classifySchema,
  digitsPreserved,
  hindiRatio,
  isEmptyText,
  minAgreeFor,
  normalizeLetter,
  parseAnswer,
  tally,
} from './ai-job.logic';

/** Thrown by `ask` when NO key can take the call right now (all busy / none added). The item goes back to the queue. */
export class ProviderBusyError extends Error {
  constructor(message = 'AI keys busy') {
    super(message);
    this.name = 'ProviderBusyError';
  }
}

export interface QOption {
  key: string;
  text: string;
  textHi?: string;
}
export interface TaxonomyChapter {
  id: string;
  name: string;
  topics: Array<{ id: string; name: string }>;
}
export interface QuestionCtx {
  id: string;
  questionNo: number | null;
  questionText: string;
  questionTextHindi: string | null;
  options: QOption[];
  correctAnswer: string;
  explanation: string | null;
  explanationHindi: string | null;
  subjectName: string;
  chapterId: string | null;
  chapterName: string | null;
  topicId: string | null;
  hindiExempt: boolean;
  chapters?: TaxonomyChapter[];
}

export type Ask = (prompt: string, o: { passIndex: number; maxTokens: number; stage: string }) => Promise<string>;

export interface PassRec {
  i: number;
  stage: string;
  ok: boolean;
  vote: string | null;
  error?: string;
  extra?: Record<string, unknown>;
}

export type RunStatus = 'DONE' | 'NEEDS_REVIEW' | 'FAILED' | 'SKIPPED';
export interface RunResult {
  status: RunStatus;
  note: string;
  proposal: Record<string, unknown> | null;
  passes: PassRec[];
  agree: number;
}

export interface RunOpts {
  passes: number;
  minAgree: number;
  onStage?: (stage: string, pass: number, passes: number) => void;
  isCancelled?: () => boolean;
}

const PHRASINGS = [
  'Solve the following SSC exam multiple-choice question step by step.',
  'You are a strict examiner. Work out the correct option independently, then justify it.',
  'Answer this competitive-exam question. Verify your calculation or reasoning twice before answering.',
  'As a subject expert, decide which option is correct by eliminating the wrong options.',
  'Re-derive the answer from scratch. Do not guess and do not assume any answer key.',
];

function fmtQuestion(q: QuestionCtx, withKey: boolean): string {
  const opts = q.options.map((o) => `${o.key}) ${o.text}`).join('\n');
  return `Subject: ${q.subjectName}${q.chapterName ? ` / ${q.chapterName}` : ''}\nQuestion: ${q.questionText}\nOptions:\n${opts}${withKey ? `\nStored answer key: ${q.correctAnswer}` : ''}`;
}

/** run `fn` for pass 0..n-1 with early stop; returns the pass records and the votes */
async function votePasses(
  stage: string,
  opts: RunOpts,
  once: (i: number) => Promise<{ vote: string | null; error?: string; extra?: Record<string, unknown> }>,
): Promise<{ passes: PassRec[]; votes: Array<string | null> }> {
  const passes: PassRec[] = [];
  const votes: Array<string | null> = [];
  for (let i = 0; i < opts.passes; i++) {
    if (opts.isCancelled?.()) break;
    opts.onStage?.(stage, i + 1, opts.passes);
    const r = await once(i); // ProviderBusyError propagates: the whole item is retried later
    votes.push(r.vote);
    passes.push({ i, stage, ok: r.vote !== null, vote: r.vote, error: r.error, extra: r.extra });
    if (canStopEarly(votes, opts.passes, opts.minAgree).stop) break;
  }
  return { passes, votes };
}

/** one model call -> validated answer; a bad / failed call only costs that pass (never the item), busy keys abort */
async function askParsed<T>(ask: Ask, prompt: string, schema: Parameters<typeof parseAnswer>[1], passIndex: number, maxTokens: number, stage: string): Promise<{ value: T | null; error?: string }> {
  let raw: string;
  try {
    raw = await ask(prompt, { passIndex, maxTokens, stage });
  } catch (e) {
    if (e instanceof ProviderBusyError) throw e;
    return { value: null, error: (e as Error)?.message?.slice(0, 160) || 'ask failed' };
  }
  const p = parseAnswer<T>(raw, schema);
  return p.value ? { value: p.value } : { value: null, error: `invalid answer: ${p.errors.slice(0, 2).join('; ')}` };
}

// ------------------------------------------------------------------ SOLUTION_GENERATE

async function solutionGenerate(q: QuestionCtx, ask: Ask, opts: RunOpts): Promise<RunResult> {
  if (!isEmptyText(q.explanation)) return { status: 'SKIPPED', note: 'solution pehle se maujood hai (admin ki value overwrite nahi hoti)', proposal: null, passes: [], agree: 0 };
  const needHindi = !q.hindiExempt && isEmptyText(q.explanationHindi);
  const sols: Array<{ answer: string; solution: string; solutionHindi?: string }> = [];
  const { passes, votes } = await votePasses('solution', opts, async (i) => {
    const prompt = [
      PHRASINGS[i % PHRASINGS.length],
      fmtQuestion(q, false),
      'Reply with ONLY this JSON (no markdown):',
      needHindi
        ? '{"answer":"A|B|C|D","solution":"clear English explanation, 3-8 short lines","solutionHindi":"same explanation in Hindi (Devanagari)"}'
        : '{"answer":"A|B|C|D","solution":"clear English explanation, 3-8 short lines"}',
    ].join('\n');
    const r = await askParsed<{ answer: string; solution: string; solutionHindi?: string }>(ask, prompt, SOLUTION_SCHEMA, i, needHindi ? 1800 : 1200, 'solution');
    if (!r.value) return { vote: null, error: r.error };
    sols.push(r.value);
    return { vote: r.value.answer };
  });
  const t = tally(votes, opts.minAgree);
  if (t.total === 0) return { status: 'FAILED', note: 'koi bhi pass valid JSON nahi de paya', proposal: null, passes, agree: 0 };
  if (!t.accepted || !t.winner) return { status: 'NEEDS_REVIEW', note: `passes agree nahi hue (${JSON.stringify(t.counts)}) — answer key ya question check karein`, proposal: { kind: 'PASSES_DISAGREE', counts: t.counts, storedAnswer: q.correctAnswer }, passes, agree: t.count };
  if (t.winner !== q.correctAnswer) {
    return { status: 'NEEDS_REVIEW', note: `AI ${t.count}/${passes.length} ne answer ${t.winner} diya, stored key ${q.correctAnswer} hai — solution tabhi lagega jab key sahi ho`, proposal: { kind: 'ANSWER_CONFLICT', aiAnswer: t.winner, storedAnswer: q.correctAnswer }, passes, agree: t.count };
  }
  const agreeing = sols.filter((s) => s.answer === t.winner);
  // prefer an agreeing pass that also has a Hindi solution; else the first agreeing one
  const best = (needHindi ? agreeing.find((s) => !isEmptyText(s.solutionHindi) && hindiRatio(s.solutionHindi as string) >= 0.4) : undefined) ?? agreeing[0];
  const proposal: Record<string, unknown> = { explanation: best.solution.trim(), answer: t.winner };
  let note = `${t.count}/${passes.length} pass agree (answer ${t.winner})`;
  if (needHindi) {
    if (best.solutionHindi && hindiRatio(best.solutionHindi) >= 0.4) proposal.explanationHindi = best.solutionHindi.trim();
    else note += ' · Hindi solution nahi aaya — HINDI_TRANSLATE job chalayein';
  }
  return { status: 'DONE', note, proposal, passes, agree: t.count };
}

// ------------------------------------------------------------------ ANSWER_KEY_VERIFY

async function answerKeyVerify(q: QuestionCtx, ask: Ask, opts: RunOpts): Promise<RunResult> {
  const { passes, votes } = await votePasses('answer', opts, async (i) => {
    const prompt = [
      PHRASINGS[i % PHRASINGS.length],
      fmtQuestion(q, false),
      'Reply with ONLY this JSON (no markdown): {"answer":"A|B|C|D","reason":"one or two lines"}',
    ].join('\n');
    const r = await askParsed<{ answer: string }>(ask, prompt, ANSWER_SCHEMA, i, 500, 'answer');
    return r.value ? { vote: r.value.answer } : { vote: null, error: r.error };
  });
  const t = tally(votes, opts.minAgree);
  if (t.total === 0) return { status: 'FAILED', note: 'koi bhi pass valid JSON nahi de paya', proposal: null, passes, agree: 0 };
  if (!t.accepted || !t.winner) return { status: 'NEEDS_REVIEW', note: `passes agree nahi hue (${JSON.stringify(t.counts)})`, proposal: { kind: 'PASSES_DISAGREE', counts: t.counts, storedAnswer: q.correctAnswer }, passes, agree: t.count };
  if (t.winner === q.correctAnswer) return { status: 'DONE', note: `answer key sahi: ${t.count}/${passes.length} independent pass ne ${t.winner} diya`, proposal: { kind: 'KEY_OK', answer: t.winner, agree: t.count, of: passes.length }, passes, agree: t.count };
  return { status: 'NEEDS_REVIEW', note: `answer key galat ho sakti hai: AI ${t.count}/${passes.length} = ${t.winner}, stored = ${q.correctAnswer}`, proposal: { kind: 'ANSWER_CHANGE', from: q.correctAnswer, to: t.winner, agree: t.count, of: passes.length }, passes, agree: t.count };
}

// ------------------------------------------------------------------ HINDI_TRANSLATE

interface HindiGen {
  questionHi?: string;
  optionsHi?: string[];
  solutionHi?: string;
}

/** "text has letters" -> must be mostly Devanagari; pure numbers / symbols may stay as they are */
function looksHindi(en: string, hi: string, minRatio: number): boolean {
  if (!/\p{L}/u.test(en)) return hi.trim().length > 0;
  return hindiRatio(hi) >= minRatio && digitsPreserved(en, hi);
}

export function validateHindiGen(q: QuestionCtx, g: HindiGen, need: { question: boolean; options: boolean; solution: boolean }): string | null {
  if (need.question) {
    if (!g.questionHi) return 'questionHi missing';
    if (!looksHindi(q.questionText, g.questionHi, 0.45)) return 'questionHi not Hindi / numbers changed';
  }
  if (need.options) {
    if (!g.optionsHi || g.optionsHi.length !== q.options.length) return 'optionsHi count mismatch';
    for (let i = 0; i < q.options.length; i++) if (!looksHindi(q.options[i].text, g.optionsHi[i], 0.3)) return `option ${q.options[i].key} not Hindi / numbers changed`;
  }
  if (need.solution) {
    if (!g.solutionHi) return 'solutionHi missing';
    if (!looksHindi(q.explanation ?? '', g.solutionHi, 0.4)) return 'solutionHi not Hindi / numbers changed';
  }
  return null;
}

async function hindiTranslate(q: QuestionCtx, ask: Ask, opts: RunOpts): Promise<RunResult> {
  if (q.hindiExempt) return { status: 'SKIPPED', note: 'is subject ko Hindi ki zarurat nahi (exempt)', proposal: null, passes: [], agree: 0 };
  const need = {
    question: isEmptyText(q.questionTextHindi),
    options: q.options.some((o) => isEmptyText(o.textHi)),
    solution: isEmptyText(q.explanationHindi) && !isEmptyText(q.explanation),
  };
  if (!need.question && !need.options && !need.solution) return { status: 'SKIPPED', note: 'Hindi pehle se poori hai', proposal: null, passes: [], agree: 0 };

  const passes: PassRec[] = [];
  const want: string[] = [];
  if (need.question) want.push('"questionHi": "<Hindi of the question>"');
  if (need.options) want.push(`"optionsHi": [${q.options.map(() => '"<Hindi>"').join(', ')}]`);
  if (need.solution) want.push('"solutionHi": "<Hindi of the solution>"');
  const source = [
    need.question ? `Question: ${q.questionText}` : '',
    need.options ? `Options:\n${q.options.map((o) => `${o.key}) ${o.text}`).join('\n')}` : '',
    need.solution ? `Solution: ${q.explanation}` : '',
  ].filter(Boolean).join('\n');

  // pass 1..2: translate (a rejected translation may be retried once)
  let gen: HindiGen | null = null;
  const genTries = Math.min(2, Math.max(1, opts.passes - 2));
  for (let g = 0; g < genTries && !gen; g++) {
    opts.onStage?.('translate', g + 1, opts.passes);
    const prompt = ['Translate the following SSC exam content into simple, exam-standard Hindi (Devanagari). Keep every number, unit, formula and proper noun exactly as it is.', source, 'Reply with ONLY this JSON (no markdown):', `{${want.join(', ')}}`].join('\n');
    const r = await askParsed<HindiGen>(ask, prompt, HINDI_SCHEMA, g, 1800, 'translate');
    if (!r.value) {
      passes.push({ i: passes.length, stage: 'translate', ok: false, vote: null, error: r.error });
      continue;
    }
    const bad = validateHindiGen(q, r.value, need);
    passes.push({ i: passes.length, stage: 'translate', ok: !bad, vote: null, error: bad ?? undefined });
    if (!bad) gen = r.value;
  }
  if (!gen) return { status: 'FAILED', note: 'valid Hindi translation nahi bana (format / Devanagari / numbers check fail)', proposal: null, passes, agree: 0 };

  // remaining passes: independent faithfulness checks (a different model each, via passIndex)
  const verifiers = Math.max(1, opts.passes - passes.length);
  const minAgree = Math.min(opts.minAgree, verifiers);
  const vOpts: RunOpts = { ...opts, passes: verifiers, minAgree };
  const shown = [
    need.question ? `English question: ${q.questionText}\nHindi question: ${gen.questionHi}` : '',
    need.options ? `English options: ${q.options.map((o) => `${o.key}) ${o.text}`).join(' | ')}\nHindi options: ${(gen.optionsHi ?? []).map((t, i) => `${q.options[i]?.key}) ${t}`).join(' | ')}` : '',
    need.solution ? `English solution: ${q.explanation}\nHindi solution: ${gen.solutionHi}` : '',
  ].filter(Boolean).join('\n');
  const { passes: vp, votes } = await votePasses('verify', vOpts, async (i) => {
    const prompt = ['You are a bilingual (English/Hindi) proof-reader. Is the Hindi a faithful, correct translation of the English (meaning, numbers, units unchanged)?', shown, 'Reply with ONLY this JSON (no markdown): {"faithful": true|false, "problem": "short reason if false"}'].join('\n');
    const r = await askParsed<{ faithful: boolean; problem?: string }>(ask, prompt, VERIFY_SCHEMA, i + 2, 300, 'verify');
    return r.value ? { vote: r.value.faithful ? 'ok' : 'bad', extra: r.value.problem ? { problem: r.value.problem } : undefined } : { vote: null, error: r.error };
  });
  for (const p of vp) passes.push({ ...p, i: passes.length });
  const t = tally(votes, minAgree);
  const proposal: Record<string, unknown> = {};
  if (need.question) proposal.questionTextHindi = gen.questionHi!.trim();
  if (need.options) proposal.optionsHi = gen.optionsHi!.map((x) => x.trim());
  if (need.solution) proposal.explanationHindi = gen.solutionHi!.trim();
  if (t.accepted && t.winner === 'ok') return { status: 'DONE', note: `${t.count}/${vp.length} proof-reader pass ne translation sahi maani`, proposal, passes, agree: t.count };
  if (t.total === 0) return { status: 'FAILED', note: 'verification pass valid jawab nahi de paye', proposal: null, passes, agree: 0 };
  return { status: 'NEEDS_REVIEW', note: `translation par pass agree nahi hue (${JSON.stringify(t.counts)})`, proposal, passes, agree: t.count };
}

// ------------------------------------------------------------------ CHAPTER_TOPIC_CLASSIFY

function taxonomyText(chapters: TaxonomyChapter[]): string {
  let withTopics = chapters.map((c) => `- ${c.id} | ${c.name}${c.topics.length ? ` | topics: ${c.topics.map((t) => `${t.id}=${t.name}`).join('; ')}` : ''}`).join('\n');
  if (withTopics.length > 7000) withTopics = chapters.map((c) => `- ${c.id} | ${c.name}`).join('\n'); // too long: chapters only
  return withTopics;
}

async function classify(q: QuestionCtx, ask: Ask, opts: RunOpts): Promise<RunResult> {
  const chapters = q.chapters ?? [];
  if (!chapters.length) return { status: 'FAILED', note: 'is subject me koi chapter nahi mila', proposal: null, passes: [], agree: 0 };
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const answers: Array<{ chapterId: string; topicId: string | null }> = [];
  const { passes, votes } = await votePasses('chapter', opts, async (i) => {
    const prompt = [
      PHRASINGS[i % PHRASINGS.length].replace(/Solve|Answer|Work out|Re-derive/, 'Classify'),
      'Decide which chapter (and topic, if any) of this subject the question below belongs to. Use ONLY the ids from the list.',
      `Chapters:\n${taxonomyText(chapters)}`,
      fmtQuestion({ ...q, chapterName: null }, false),
      'Reply with ONLY this JSON (no markdown): {"chapterId":"<id from list>","topicId":"<id from that chapter or empty>","confidence":0.0-1.0}',
    ].join('\n');
    const r = await askParsed<{ chapterId: string; topicId?: string }>(ask, prompt, classifySchema(), i, 300, 'chapter');
    if (!r.value) return { vote: null, error: r.error };
    const v = r.value;
    const ch = byId.get(v.chapterId);
    if (!ch) return { vote: null, error: 'chapterId not in the list' }; // hallucinated id = failed pass
    const topicOk = v.topicId && ch.topics.some((t) => t.id === v.topicId) ? v.topicId : null;
    answers.push({ chapterId: ch.id, topicId: topicOk });
    return { vote: ch.id, extra: { topicId: topicOk } };
  });
  const t = tally(votes, opts.minAgree);
  if (t.total === 0) return { status: 'FAILED', note: 'koi pass valid chapter nahi de paya', proposal: null, passes, agree: 0 };
  if (!t.accepted || !t.winner) return { status: 'FAILED', note: `AI sure nahi (${JSON.stringify(t.counts)}) — manually dekhein`, proposal: null, passes, agree: t.count };
  const ch = byId.get(t.winner)!;
  const tv = tally(answers.filter((a) => a.chapterId === ch.id).map((a) => a.topicId), opts.minAgree);
  const topicId = tv.accepted ? tv.winner : null;
  const topicName = topicId ? ch.topics.find((x) => x.id === topicId)?.name ?? null : null;
  const sameChapter = q.chapterId === ch.id;
  const sameTopic = !topicId || q.topicId === topicId;
  if (sameChapter && sameTopic) return { status: 'DONE', note: `chapter/topic sahi hai (${t.count}/${passes.length} pass)`, proposal: { kind: 'CLASSIFY_OK', chapterId: ch.id }, passes, agree: t.count };
  return {
    status: 'NEEDS_REVIEW', // classification is NEVER auto-applied
    note: `AI suggestion: ${ch.name}${topicName ? ` › ${topicName}` : ''} (${t.count}/${passes.length} pass)`,
    proposal: { kind: 'CLASSIFY_CHANGE', chapterId: ch.id, chapterName: ch.name, topicId, topicName, from: { chapterId: q.chapterId, chapterName: q.chapterName, topicId: q.topicId } },
    passes,
    agree: t.count,
  };
}

// ------------------------------------------------------------------ entry

export async function runItem(type: JobType, q: QuestionCtx, ask: Ask, opts: RunOpts): Promise<RunResult> {
  if (!q.options.length || !normalizeLetter(q.correctAnswer)) return { status: 'SKIPPED', note: 'question me options / correct answer sahi nahi — pehle usse theek karein', proposal: null, passes: [], agree: 0 };
  const o: RunOpts = { ...opts, minAgree: Math.max(1, Math.min(opts.minAgree || minAgreeFor(opts.passes), opts.passes)) };
  switch (type) {
    case 'SOLUTION_GENERATE': return solutionGenerate(q, ask, o);
    case 'ANSWER_KEY_VERIFY': return answerKeyVerify(q, ask, o);
    case 'HINDI_TRANSLATE': return hindiTranslate(q, ask, o);
    case 'CHAPTER_TOPIC_CLASSIFY': return classify(q, ask, o);
    default: return { status: 'FAILED', note: `${type} is runner se nahi chalta`, proposal: null, passes: [], agree: 0 };
  }
}
