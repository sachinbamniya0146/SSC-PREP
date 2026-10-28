// Auto-publish rules for duplicate reviews (pure functions: no Nest / Prisma imports, unit-tested on their own).
//
// Sachin (28 Oct 2026): "latest PYQ wale duplicate ho to admin ko problem na aaye - 24 hour me auto latest wale
// questions publish ho jaye." A duplicate review that nobody answered for `afterHours` hours is decided by the rules
// below; every automatic decision can be undone from the Duplicates page (it is marked "Auto" there).

export type AutoAction = 'KEEP_NEW' | 'KEEP_EXISTING' | 'KEEP_BOTH';

export interface AutoPublishConfig {
  enabled: boolean;
  /** Hours a duplicate waits for a human before the rules decide. 0 = decide on the next run. */
  afterHours: number;
  /** Also decide "similar" matches whose only differences are solution / picture / paper question number. */
  includeSimilar: boolean;
}

export const AUTO_PUBLISH_KEY = 'autopublish.config';

/**
 * `autoReason` value written when an admin takes a decision back (Undo). The auto-publish job never touches a review
 * carrying it again: the admin took it back on purpose, so it waits for a person.
 */
export const AUTO_UNDONE = 'UNDONE';

export const DEFAULT_AUTO_PUBLISH: AutoPublishConfig = { enabled: true, afterHours: 24, includeSimilar: false };

export function mergeAutoPublish(raw: unknown): AutoPublishConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const h = Number(r.afterHours);
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_AUTO_PUBLISH.enabled,
    afterHours: Number.isFinite(h) && h >= 0 && h <= 168 ? Math.round(h) : DEFAULT_AUTO_PUBLISH.afterHours,
    includeSimilar: typeof r.includeSimilar === 'boolean' ? r.includeSimilar : DEFAULT_AUTO_PUBLISH.includeSimilar,
  };
}

export type AutoValidate = { ok: true; config: AutoPublishConfig } | { ok: false; error: string };

export function validateAutoPublish(current: AutoPublishConfig, input: unknown): AutoValidate {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Send the settings as a JSON object.' };
  const r = input as Record<string, unknown>;
  if (r.enabled !== undefined && typeof r.enabled !== 'boolean') return { ok: false, error: '"enabled" must be true or false.' };
  if (r.includeSimilar !== undefined && typeof r.includeSimilar !== 'boolean') return { ok: false, error: '"includeSimilar" must be true or false.' };
  if (r.afterHours !== undefined) {
    const h = Number(r.afterHours);
    if (!Number.isFinite(h) || h < 0 || h > 168) return { ok: false, error: 'Hours must be between 0 and 168 (one week).' };
  }
  return { ok: true, config: mergeAutoPublish({ ...current, ...r }) };
}

/** What the rules need to know about one side of a duplicate. */
export interface SideInfo {
  year: number | null;
  /** "YYYY-MM-DD" or null */
  examDate: string | null;
  /** visible to students right now */
  live: boolean;
  createdAt?: string | Date | null;
}

export interface AutoDecision {
  action: AutoAction;
  reason: string;
}

const PAPER_FIELDS = ['examId', 'year', 'shift', 'examDate', 'examTier', 'tierPaper', 'paperCode'];
/** Differences a human must look at: the question itself or its answer changed. */
const CONTENT_FIELDS = ['questionText', 'questionTextHindi', 'options', 'correctAnswer'];
/** Differences that are only "better information" on the new copy. */
const SAFE_FIELDS = ['explanation', 'explanationHindi', 'questionImageUrl', 'paperQuestionNo'];

/** 1 = candidate is from a newer paper, -1 = older, 0 = same / cannot tell. */
export function recency(candidate: Pick<SideInfo, 'year' | 'examDate'>, existing: Pick<SideInfo, 'year' | 'examDate'>): -1 | 0 | 1 {
  if (candidate.examDate && existing.examDate && candidate.examDate !== existing.examDate) {
    return candidate.examDate > existing.examDate ? 1 : -1;
  }
  if (candidate.year != null && existing.year != null && candidate.year !== existing.year) {
    return candidate.year > existing.year ? 1 : -1;
  }
  return 0;
}

/**
 * The decision for one pending review, or null when a human has to look at it.
 *  - same question in ANOTHER paper (shift / date / tier / year differs)  -> keep both (each paper needs its question)
 *  - nothing live to compare with (the old one was hidden / deleted)       -> keep the new one
 *  - identical copy                                                        -> keep the existing one (students' bookmarks + history stay)
 *  - similar copy, only solution / picture / paper-number differ (optional) -> keep the newer paper's copy
 *  - question text, options or the answer differ                            -> a person decides, always
 */
export function decideAuto(args: {
  matchType: string;
  differences: readonly string[];
  existing: SideInfo | null;
  candidate: SideInfo;
  includeSimilar: boolean;
}): AutoDecision | null {
  const diffs = args.differences ?? [];
  if (!args.existing || !args.existing.live) {
    return { action: 'KEEP_NEW', reason: 'the old copy is not live, so the new one is published' };
  }
  if (diffs.some((d) => PAPER_FIELDS.includes(d))) {
    // a changed answer/options on top of a changed paper is still a real conflict
    if (diffs.some((d) => d === 'correctAnswer' || d === 'options')) return null;
    return { action: 'KEEP_BOTH', reason: 'same question in a different paper - kept in both papers' };
  }
  if (args.matchType === 'EXACT' || diffs.length === 0) {
    return { action: 'KEEP_EXISTING', reason: 'identical copy - the existing question stays live' };
  }
  if (!args.includeSimilar) return null;
  if (diffs.some((d) => CONTENT_FIELDS.includes(d))) return null;
  if (diffs.every((d) => SAFE_FIELDS.includes(d))) {
    return recency(args.candidate, args.existing) >= 0
      ? { action: 'KEEP_NEW', reason: 'newer copy with a better solution / details is published' }
      : { action: 'KEEP_EXISTING', reason: 'the existing copy is from a newer paper' };
  }
  return null;
}

export interface AutoRunSummary {
  at: string;
  trigger: 'auto' | 'manual';
  keptNew: number;
  keptExisting: number;
  keptBoth: number;
  needsHuman: number;
  failed: number;
}

/** Last runs kept for the admin page (newest first, 20 max). */
export function pushRun(log: AutoRunSummary[], run: AutoRunSummary): AutoRunSummary[] {
  return [run, ...log].slice(0, 20);
}
