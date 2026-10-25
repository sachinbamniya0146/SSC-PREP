/**
 * Client mirror of backend/src/common/section-plan.ts (strict sectional timers).
 *
 * The server owns the timeline: /tests/attempts/start (and /remaining) return the frozen `plan` plus `serverNow`.
 * The client only DISPLAYS it — it derives "which section is open and how long is left" from
 * (serverNow - clientNow skew, attempt start, plan offsets). It never decides anything the server will not re-check.
 */

export type PlanSection = {
  index: number;
  name: string;
  subjectSlug: string | null;
  startMs: number;
  endMs: number;
  minutes: number;
  questions: number;
  marksPerQuestion: number;
};

export type SectionPlan = {
  v: 1;
  lock: true;
  scribe: boolean;
  negativeMarks: number;
  totalMs: number;
  sections: PlanSection[];
};

/** What /tests/pattern/:templateId and the paper response describe before an attempt exists. */
export type PatternMeta = {
  id: string;
  name: string;
  lockSections: boolean;
  negativeMarks: number;
  scribeAvailable: boolean;
  sourceNote: string | null;
  sections: { name: string; subjectSlug: string | null; questions: number; minutes: number; scribeMinutes: number; marksPerQuestion: number }[];
};

/** Open section at `elapsedMs` since the attempt started: -1 before start, plan.sections.length once over. */
export function sectionIndexAt(plan: SectionPlan, elapsedMs: number): number {
  if (elapsedMs < 0) return -1;
  for (const s of plan.sections) if (elapsedMs < s.endMs) return s.index;
  return plan.sections.length;
}

/** Whole seconds left in the open section (0 when over). */
export function sectionRemainingSec(plan: SectionPlan, elapsedMs: number): number {
  const i = sectionIndexAt(plan, elapsedMs);
  const s = plan.sections[i];
  return s ? Math.max(0, Math.ceil((s.endMs - elapsedMs) / 1000)) : 0;
}

export function totalMinutes(sections: { minutes: number }[]): number {
  return Math.round(sections.reduce((a, s) => a + s.minutes, 0) * 100) / 100;
}
