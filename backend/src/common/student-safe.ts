/**
 * Fields a STUDENT must never receive (Sachin, 29 Oct 2026: "date wise sirf admin ko show ho").
 * The paper code (e.g. SSC-CGL-T-I-12-Sep-2025-S2) is built from the real exam date, so it is as revealing as the date itself.
 * Pure functions, used by the public search and unit-tested in student-safe.spec.ts.
 */
export const ADMIN_ONLY_QUESTION_FIELDS = ['examDate', 'paperCode'] as const;

/** A copy of a search hit (and its highlighted copy `_formatted`) without the admin-only paper fields. */
export function stripAdminOnlyFields<T extends object>(hit: T): T {
  const copy: Record<string, unknown> = { ...(hit as Record<string, unknown>) };
  for (const f of ADMIN_ONLY_QUESTION_FIELDS) delete copy[f];
  const fm = copy._formatted;
  if (fm && typeof fm === 'object') {
    const f2: Record<string, unknown> = { ...(fm as Record<string, unknown>) };
    for (const f of ADMIN_ONLY_QUESTION_FIELDS) delete f2[f];
    copy._formatted = f2;
  }
  return copy as T;
}
