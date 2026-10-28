// Which TestAttempt statuses mean "finished" (session 29, 28 Oct 2026).
//
// SUBMITTED  = the student pressed Submit (or the app replayed the submit).
// AUTO_SUBMITTED = nobody pressed Submit; the abandoned-attempt sweeper scored the answers that were autosaved
//                  (tests/attempt-sweeper.service.ts). It is a finished attempt in every way: review, history, rank, analytics.
// IN_PROGRESS / EXPIRED are not finished: no review, no key, no rank.
export const ATTEMPT_DONE_STATUSES = ['SUBMITTED', 'AUTO_SUBMITTED'] as const;
export type AttemptDoneStatus = (typeof ATTEMPT_DONE_STATUSES)[number];

/** Prisma `where` fragment: `status: ATTEMPT_DONE`. NOT `as const`: Prisma's `in` wants a mutable array (CI error TS2322 in S29). */
export const ATTEMPT_DONE: { in: AttemptDoneStatus[] } = { in: [...ATTEMPT_DONE_STATUSES] };

export function isAttemptDone(status: unknown): boolean {
  return status === 'SUBMITTED' || status === 'AUTO_SUBMITTED';
}
