// Pure logic of the central AI job engine (NEW Oct 15 2026): JSON extraction, strict schema validation,
// vote / consensus, ETA. No Nest, no Prisma — unit-tested on its own (ai-job.logic.spec.ts).

export const JOB_TYPES = ['PYQ_DATE_SHIFT', 'SOLUTION_GENERATE', 'HINDI_TRANSLATE', 'CHAPTER_TOPIC_CLASSIFY', 'ANSWER_KEY_VERIFY'] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_LABEL: Record<JobType, string> = {
  PYQ_DATE_SHIFT: 'PYQ date + shift',
  SOLUTION_GENERATE: 'Solution (Eng/Hindi)',
  HINDI_TRANSLATE: 'Hindi translation',
  CHAPTER_TOPIC_CLASSIFY: 'Chapter / topic',
  ANSWER_KEY_VERIFY: 'Answer key check',
};

/** value stored in AiUsageLog.feature for each job type (what the admin sees per key) */
export const JOB_FEATURE: Record<JobType, string> = {
  PYQ_DATE_SHIFT: 'PYQ_DATE_MAPPING',
  SOLUTION_GENERATE: 'JOB_SOLUTION_GENERATE',
  HINDI_TRANSLATE: 'JOB_HINDI_TRANSLATE',
  CHAPTER_TOPIC_CLASSIFY: 'JOB_CHAPTER_TOPIC',
  ANSWER_KEY_VERIFY: 'JOB_ANSWER_KEY',
};

export function isJobType(x: unknown): x is JobType {
  return typeof x === 'string' && (JOB_TYPES as readonly string[]).includes(x);
}

// ------------------------------------------------------------------ text helpers

/** the DB stores '' (not NULL) for a missing Hindi text / solution: both count as empty */
export function isEmptyText(s: unknown): boolean {
  return s === null || s === undefined || (typeof s === 'string' && s.trim() === '');
}

/** "a", "(B)", "Option c", "d." -> 'A'..'D'; 1-4 -> A-D; anything else -> null */
export function normalizeLetter(raw: unknown): 'A' | 'B' | 'C' | 'D' | null {
  const t = String(raw ?? '').trim().toUpperCase().replace(/^OPTION\s*/, '').replace(/[().\s:]/g, '');
  if (/^[A-D]$/.test(t)) return t as 'A' | 'B' | 'C' | 'D';
  if (/^[1-4]$/.test(t)) return (['A', 'B', 'C', 'D'] as const)[Number(t) - 1];
  return null;
}

/** First JSON object in a model answer (plain, fenced in ```json, or surrounded by chatter). null when none parses. */
export function extractJson(raw: string): unknown | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const tries: string[] = [text];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) tries.push(fence[1].trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) tries.push(text.slice(first, last + 1));
  for (const t of tries) {
    try {
      const v = JSON.parse(t);
      if (v && typeof v === 'object') return v;
    } catch {
      /* next */
    }
  }
  return null;
}

const DEVANAGARI = /[\u0900-\u097F]/g;
/** share of letters that are Devanagari (0..1) */
export function hindiRatio(s: string): number {
  const letters = (s.match(/\p{L}/gu) ?? []).length;
  if (!letters) return 0;
  return (s.match(DEVANAGARI) ?? []).length / letters;
}

/** every number written in the English text must still be there in the Hindi text (a classic translation slip) */
export function digitsPreserved(en: string, hi: string): boolean {
  const toAscii = (t: string) => t.replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - 0x0966));
  const nums = (t: string) => (toAscii(t).match(/\d+(?:\.\d+)?/g) ?? []).map((n) => n.replace(/^0+(?=\d)/, ''));
  const have = new Set(nums(hi));
  return nums(en).every((n) => have.has(n));
}

// ------------------------------------------------------------------ strict JSON-schema (tiny, enough for our prompts)

export type Schema =
  | { type: 'string'; minLen?: number; maxLen?: number; pattern?: RegExp; optional?: boolean }
  | { type: 'enum'; values: readonly string[]; optional?: boolean }
  | { type: 'number'; min?: number; max?: number; integer?: boolean; optional?: boolean }
  | { type: 'boolean'; optional?: boolean }
  | { type: 'array'; items: Schema; minItems?: number; maxItems?: number; optional?: boolean }
  | { type: 'object'; props: Record<string, Schema>; optional?: boolean };

export interface ValidateResult<T = unknown> {
  ok: boolean;
  value?: T;
  errors: string[];
}

function check(schema: Schema, v: unknown, path: string, errors: string[]): void {
  if (v === undefined || v === null) {
    if (!(schema as { optional?: boolean }).optional) errors.push(`${path}: missing`);
    return;
  }
  switch (schema.type) {
    case 'string': {
      if (typeof v !== 'string') return void errors.push(`${path}: not a string`);
      if (schema.minLen !== undefined && v.trim().length < schema.minLen) errors.push(`${path}: too short`);
      if (schema.maxLen !== undefined && v.length > schema.maxLen) errors.push(`${path}: too long`);
      if (schema.pattern && !schema.pattern.test(v)) errors.push(`${path}: bad format`);
      return;
    }
    case 'enum': {
      if (typeof v !== 'string' || !schema.values.includes(v)) errors.push(`${path}: not one of ${schema.values.join('/')}`);
      return;
    }
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return void errors.push(`${path}: not a number`);
      if (schema.integer && !Number.isInteger(v)) errors.push(`${path}: not an integer`);
      if (schema.min !== undefined && v < schema.min) errors.push(`${path}: below ${schema.min}`);
      if (schema.max !== undefined && v > schema.max) errors.push(`${path}: above ${schema.max}`);
      return;
    }
    case 'boolean': {
      if (typeof v !== 'boolean') errors.push(`${path}: not a boolean`);
      return;
    }
    case 'array': {
      if (!Array.isArray(v)) return void errors.push(`${path}: not an array`);
      if (schema.minItems !== undefined && v.length < schema.minItems) errors.push(`${path}: too few items`);
      if (schema.maxItems !== undefined && v.length > schema.maxItems) errors.push(`${path}: too many items`);
      v.forEach((it, i) => check(schema.items, it, `${path}[${i}]`, errors));
      return;
    }
    case 'object': {
      if (typeof v !== 'object' || Array.isArray(v)) return void errors.push(`${path}: not an object`);
      for (const [k, s] of Object.entries(schema.props)) check(s, (v as Record<string, unknown>)[k], `${path}.${k}`, errors);
      return;
    }
  }
}

export function validate<T = unknown>(schema: Schema, value: unknown): ValidateResult<T> {
  const errors: string[] = [];
  check(schema, value, '$', errors);
  return errors.length ? { ok: false, errors } : { ok: true, value: value as T, errors };
}

// Schemas of the AI answers (invalid answer = that pass failed)
export const LETTER_ENUM = ['A', 'B', 'C', 'D'] as const;

export const SOLUTION_SCHEMA: Schema = {
  type: 'object',
  props: {
    answer: { type: 'enum', values: LETTER_ENUM },
    solution: { type: 'string', minLen: 20, maxLen: 4000 },
    solutionHindi: { type: 'string', maxLen: 4000, optional: true },
  },
};
export const ANSWER_SCHEMA: Schema = {
  type: 'object',
  props: {
    answer: { type: 'enum', values: LETTER_ENUM },
    reason: { type: 'string', maxLen: 1500, optional: true },
  },
};
export const HINDI_SCHEMA: Schema = {
  type: 'object',
  props: {
    questionHi: { type: 'string', minLen: 3, maxLen: 3000, optional: true },
    optionsHi: { type: 'array', items: { type: 'string', minLen: 1, maxLen: 600 }, minItems: 4, maxItems: 4, optional: true },
    solutionHi: { type: 'string', minLen: 5, maxLen: 4000, optional: true },
  },
};
export const VERIFY_SCHEMA: Schema = {
  type: 'object',
  props: { faithful: { type: 'boolean' }, problem: { type: 'string', maxLen: 400, optional: true } },
};
export function classifySchema(): Schema {
  return {
    type: 'object',
    props: {
      chapterId: { type: 'string', minLen: 1, maxLen: 80 },
      topicId: { type: 'string', maxLen: 80, optional: true },
      confidence: { type: 'number', min: 0, max: 1, optional: true },
    },
  };
}

/** extract + validate in one step: null when the pass has to be counted as failed */
export function parseAnswer<T = unknown>(raw: string, schema: Schema): { value: T | null; errors: string[] } {
  const json = extractJson(raw);
  if (json === null) return { value: null, errors: ['no JSON object in answer'] };
  const r = validate<T>(schema, json);
  return r.ok ? { value: r.value as T, errors: [] } : { value: null, errors: r.errors };
}

// ------------------------------------------------------------------ votes

export interface Tally {
  winner: string | null;
  count: number;
  total: number;        // valid votes
  invalid: number;      // passes that produced nothing usable
  accepted: boolean;    // winner reached minAgree
  counts: Record<string, number>;
}

/** votes: one entry per pass, `null` = invalid / failed pass. Ties never win (first to reach the count wins only if strictly ahead). */
export function tally(votes: Array<string | null>, minAgree: number): Tally {
  const counts: Record<string, number> = {};
  let invalid = 0;
  for (const v of votes) {
    if (v === null || v === undefined || v === '') invalid++;
    else counts[v] = (counts[v] ?? 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = entries[0];
  const second = entries[1];
  const tie = !!top && !!second && top[1] === second[1];
  const winner = top && !tie ? top[0] : null;
  const count = winner ? top[1] : top ? top[1] : 0;
  return { winner, count, total: votes.length - invalid, invalid, accepted: !!winner && count >= minAgree, counts };
}

/** minimum agreement for N passes: 3/5, 2/3, 2/2 ... (strict majority, at least 2 when N>=2) */
export function minAgreeFor(passes: number): number {
  if (passes <= 1) return 1;
  return Math.max(2, Math.floor(passes / 2) + 1);
}

/**
 * Can we stop asking more passes? Safe because it never changes the decision:
 *  - the leader already has minAgree votes (nobody can overtake: the rest hold < minAgree when minAgree > passes/2), or
 *  - even if every remaining pass agreed with the current leader, minAgree can no longer be reached.
 */
export function canStopEarly(votes: Array<string | null>, passes: number, minAgree: number): { stop: boolean; reason: 'agreed' | 'impossible' | null } {
  const t = tally(votes, minAgree);
  const remaining = Math.max(0, passes - votes.length);
  const best = Math.max(0, ...Object.values(t.counts));
  if (best >= minAgree && minAgree > passes / 2) return { stop: true, reason: 'agreed' };
  if (best + remaining < minAgree) return { stop: true, reason: 'impossible' };
  return { stop: false, reason: null };
}

// ------------------------------------------------------------------ estimate / ETA

export function estimateCalls(items: number, passes: number, type: JobType): number {
  if (type === 'PYQ_DATE_SHIFT') return items * passes; // + web searches
  return items * passes; // upper bound; early stop usually saves 20-40 %
}

/** seconds until done; null when there is no timing yet */
export function etaSeconds(remainingItems: number, avgSecPerItem: number | null, concurrency: number): number | null {
  if (!avgSecPerItem || avgSecPerItem <= 0) return null;
  return Math.ceil((remainingItems * avgSecPerItem) / Math.max(1, concurrency));
}

export function fmtDuration(sec: number | null): string {
  if (sec === null) return '—';
  if (sec < 90) return `${sec}s`;
  const m = Math.round(sec / 60);
  if (m < 90) return `${m} min`;
  return `${(m / 60).toFixed(1)} ghante`;
}
