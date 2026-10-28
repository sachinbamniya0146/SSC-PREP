// Same question, served twice (session 27, 28 Oct 2026).
//
// The question bank can hold one question several times: the same PYQ appears in two shifts / years, or was uploaded twice. A practice set
// or a mock that picks rows by id then shows it twice. This file decides "same content": same stem, same options (in any order), same
// figure. It is used when a set is PICKED; nothing here deletes or edits a stored question.

/** lower case, one space, no zero-width characters, no accents / width variants, no trailing full stop */
export function normText(s: unknown): string {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/[​-‍﻿]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.।]+$/, '')
    .trim();
}

type OptionLike = { text?: unknown; imageUrl?: unknown; diagramType?: unknown; diagramLabels?: unknown } | null | undefined;
export type FingerprintInput = {
  id?: string;
  questionText?: unknown;
  optionsJson?: unknown;
  questionImageUrl?: unknown;
  questionDiagramType?: unknown;
  questionDiagramLabels?: unknown;
};

const media = (url: unknown, type: unknown, labels: unknown): string => {
  const u = String(url ?? '').trim();
  if (u) return 'img:' + u;
  const t = String(type ?? '').trim();
  if (!t) return '';
  return 'fig:' + t + ':' + (Array.isArray(labels) ? labels.map((l) => normText(l)).join(',') : '');
};

/**
 * Content key of a question: stem + figure + the set of options (sorted, so the same options in another order are the same question).
 * A row with no stem and no options gets its own id as the key, so unknown content is never collapsed into something else.
 */
export function questionFingerprint(q: FingerprintInput): string {
  const stem = normText(q.questionText);
  const opts = (Array.isArray(q.optionsJson) ? (q.optionsJson as OptionLike[]) : [])
    .map((o) => normText(o?.text) || media(o?.imageUrl, o?.diagramType, o?.diagramLabels))
    .sort();
  if (!stem && opts.every((o) => !o)) return 'id:' + String(q.id ?? '');
  return [stem, media(q.questionImageUrl, q.questionDiagramType, q.questionDiagramLabels), opts.join('¦')].join('||');
}

/** Keeps the first row of every content; `taken` (fingerprints already used elsewhere in the same paper) is read, not changed. */
export function dropDuplicateQuestions<T extends FingerprintInput>(rows: T[], taken?: Set<string>): T[] {
  const seen = new Set<string>(taken ?? []);
  const out: T[] = [];
  for (const r of rows) {
    const k = questionFingerprint(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/**
 * The pool a section is picked from. Preferred: no content already used in an earlier section and no repeats inside the pool. If that
 * leaves fewer than `need` (a small bank), fall back to "no repeats inside the pool", and last to the pool as it is: a short bank must
 * never block a paper, it only keeps its old behaviour.
 */
export function uniquePool<T extends FingerprintInput>(rows: T[], used: Set<string>, need: number): T[] {
  const fresh = dropDuplicateQuestions(rows, used);
  if (fresh.length >= need) return fresh;
  const own = dropDuplicateQuestions(rows);
  if (own.length >= need) return own;
  return rows;
}

export function rememberQuestions<T extends FingerprintInput>(used: Set<string>, rows: T[]): void {
  for (const r of rows) used.add(questionFingerprint(r));
}
