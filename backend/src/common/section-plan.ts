/**
 * Strict sectional-timer plan (SSC CGL 2026 style).
 *
 * A plan is a FIXED timeline of back-to-back sections, stored as millisecond offsets from the attempt's
 * `startedAt`. Because it is a pure function of (startedAt, plan), a page refresh, a second device, an offline
 * replay and the server's own checks all land on the same answer — nothing about "which section is open now"
 * is kept in memory or trusted from the client.
 *
 * Everything here is pure (no Prisma, no Date.now()) so it is unit-testable and shared by tests.service.ts.
 */

export type PatternSectionInput = {
  name: string;
  subjectSlug?: string | null;
  questions?: number;
  marks?: number;
  durationMinutes?: number;
  scribeMinutes?: number;
  /** Optional per-section penalty (MTS Session-I has none, Session-II has 1). Absent = the pattern-wide value. */
  negativeMarks?: number;
};

export type PlanSection = {
  index: number;
  name: string;
  subjectSlug: string | null;
  startMs: number; // offset from attempt start (inclusive)
  endMs: number; // offset from attempt start (exclusive)
  minutes: number;
  questions: number;
  marksPerQuestion: number;
  /** Per-section penalty; plans frozen before 28 Oct 2026 do not have it and fall back to `plan.negativeMarks`. */
  negativeMarks?: number;
};

export type SectionPlan = {
  v: 1;
  lock: true;
  scribe: boolean;
  negativeMarks: number;
  totalMs: number;
  sections: PlanSection[];
};

export type PatternForPlan = {
  negativeMarks: number;
  lockPreviousSections: boolean;
  scribeExtraMinutes: number;
  sections: unknown;
};

/** A section can still be written for this long after its deadline, to absorb the 2.5 s autosave debounce + latency. */
export const SECTION_WRITE_GRACE_MS = 8_000;
/** Same slack the offline-replay path already uses for client clock drift. */
export const SECTION_CLOCK_SLACK_MS = 30_000;

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Normalise the `sections` JSON of an ExamPattern into typed rows (drops rows without a usable duration). */
export function readPatternSections(raw: unknown): PatternSectionInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && typeof r === 'object')
    .map((r: any) => ({
      name: String(r.name ?? '').trim(),
      subjectSlug: r.subjectSlug ? String(r.subjectSlug).trim().toLowerCase() : null,
      questions: Math.max(0, Math.floor(num(r.questions, 0))),
      marks: num(r.marks, 0),
      durationMinutes: num(r.durationMinutes, 0),
      scribeMinutes: r.scribeMinutes != null ? num(r.scribeMinutes, 0) : undefined,
      negativeMarks: r.negativeMarks != null && r.negativeMarks !== '' && Number.isFinite(Number(r.negativeMarks)) ? Math.max(0, Number(r.negativeMarks)) : undefined,
    }))
    .filter((r) => r.name.length > 0);
}

/**
 * Build the frozen plan for one attempt. Returns null when the pattern is not a strict-sectional one
 * (flag off, no sections, or any section without a positive duration) — callers then keep the legacy single clock.
 */
export function buildSectionPlan(pattern: PatternForPlan | null | undefined, opts: { scribe?: boolean } = {}): SectionPlan | null {
  if (!pattern || !pattern.lockPreviousSections) return null;
  const rows = readPatternSections(pattern.sections);
  if (rows.length === 0) return null;
  if (rows.some((r) => !(num(r.durationMinutes, 0) > 0))) return null;

  const scribe = !!opts.scribe && (pattern.scribeExtraMinutes > 0 || rows.some((r) => (r.scribeMinutes ?? 0) > 0));
  let cursor = 0;
  const sections: PlanSection[] = rows.map((r, index) => {
    const base = num(r.durationMinutes, 0);
    const minutes = scribe
      ? r.scribeMinutes && r.scribeMinutes > 0
        ? r.scribeMinutes
        : base + Math.max(0, pattern.scribeExtraMinutes)
      : base;
    const startMs = cursor;
    const endMs = cursor + Math.round(minutes * 60_000);
    cursor = endMs;
    const questions = r.questions ?? 0;
    return {
      index,
      name: r.name,
      subjectSlug: r.subjectSlug ?? null,
      startMs,
      endMs,
      minutes,
      questions,
      marksPerQuestion: questions > 0 && (r.marks ?? 0) > 0 ? Math.round(((r.marks as number) / questions) * 1000) / 1000 : 0,
      ...(r.negativeMarks != null ? { negativeMarks: r.negativeMarks } : {}),
    };
  });
  return { v: 1, lock: true, scribe, negativeMarks: Math.max(0, num(pattern.negativeMarks, 0)), totalMs: cursor, sections };
}

/** Type guard for whatever came back from the Json column. */
export function readSectionPlan(raw: unknown): SectionPlan | null {
  const p = raw as any;
  if (!p || typeof p !== 'object' || p.v !== 1 || !Array.isArray(p.sections) || p.sections.length === 0) return null;
  return p as SectionPlan;
}

/** Index of the section that is open at `elapsedMs`, or -1 before start, or sections.length once everything is over. */
export function sectionIndexAt(plan: SectionPlan, elapsedMs: number): number {
  if (elapsedMs < 0) return -1;
  for (const s of plan.sections) if (elapsedMs < s.endMs) return s.index;
  return plan.sections.length;
}

/** Which section a question belongs to: matching subject slug, otherwise the last section (never silently dropped). */
export function sectionIndexForSubject(plan: SectionPlan, subjectSlug: string | null | undefined): number {
  const slug = (subjectSlug ?? '').trim().toLowerCase();
  if (slug) {
    const hit = plan.sections.find((s) => s.subjectSlug && s.subjectSlug === slug);
    if (hit) return hit.index;
  }
  return plan.sections.length - 1;
}

/**
 * May an answer for `sectionIndex` be written at `elapsedMs` (server clock, relative to startedAt)?
 * Only the section that is currently open is writable, plus a short grace window right after it closes.
 * A section that has not opened yet is never writable.
 */
export function isSectionWritable(plan: SectionPlan, sectionIndex: number, elapsedMs: number, graceMs = SECTION_WRITE_GRACE_MS): boolean {
  const s = plan.sections[sectionIndex];
  if (!s) return false;
  return elapsedMs >= s.startMs && elapsedMs < s.endMs + graceMs;
}

/**
 * Offline replay: the client stamped when each answer was given. Accept it only if that moment lay inside the
 * question's section window (±clock slack). The caller separately limits how late a replay may arrive.
 */
export function wasAnsweredInsideSection(plan: SectionPlan, sectionIndex: number, answeredAtMs: number, startedAtMs: number): boolean {
  const s = plan.sections[sectionIndex];
  if (!s || !Number.isFinite(answeredAtMs)) return false;
  const rel = answeredAtMs - startedAtMs;
  return rel >= s.startMs - SECTION_CLOCK_SLACK_MS && rel < s.endMs + SECTION_CLOCK_SLACK_MS;
}

/**
 * A write for a section that is already CLOSED is normally refused. The one legitimate exception is a student who was
 * offline: their device kept the exam running and delivers the answers later, each stamped with the moment it was given.
 * Accept such a late write only if
 *   1. the stamp really lies inside that section's window, and
 *   2. the server had NOT heard from this attempt after that section closed (`lastSyncMs` — advanced by every
 *      autosave and heartbeat). A client that stayed connected has no reason to deliver late, so it cannot use this
 *      path to edit a closed section. (A client that deliberately stays offline can still claim stamps — the same
 *      trust the existing offline-submit replay already extends.)
 */
export function canAcceptLateWrite(
  plan: SectionPlan,
  sectionIndex: number,
  answeredAtMs: number,
  startedAtMs: number,
  lastSyncMs: number | null,
): boolean {
  const s = plan.sections[sectionIndex];
  if (!s) return false;
  if (!wasAnsweredInsideSection(plan, sectionIndex, answeredAtMs, startedAtMs)) return false;
  if (lastSyncMs == null) return true;
  return lastSyncMs - startedAtMs < s.endMs + SECTION_CLOCK_SLACK_MS;
}

/** Live status for the client (also returned by /remaining so a refresh re-syncs instantly). */
export function describePlanAt(plan: SectionPlan, elapsedMs: number) {
  const idx = sectionIndexAt(plan, elapsedMs);
  const cur = plan.sections[idx];
  return {
    currentSection: idx,
    finished: idx >= plan.sections.length,
    sectionRemainingMs: cur ? Math.max(0, cur.endMs - elapsedMs) : 0,
    totalRemainingMs: Math.max(0, plan.totalMs - Math.max(0, elapsedMs)),
  };
}

/** Penalty for one wrong answer in a section: the section's own value when the pattern sets one, else the pattern-wide value. */
export function negativeUnderPlan(plan: SectionPlan, sectionIndex: number): number {
  const s = plan.sections[sectionIndex];
  return s && typeof s.negativeMarks === 'number' && s.negativeMarks >= 0 ? s.negativeMarks : plan.negativeMarks;
}

/** Marks for one answer under a plan. Marks and (since 28 Oct 2026) the penalty can both differ per section. */
export function scoreUnderPlan(plan: SectionPlan, sectionIndex: number, correct: boolean, answered: boolean, fallback: { marks: number }): number {
  if (!answered) return 0;
  const s = plan.sections[sectionIndex];
  const per = s && s.marksPerQuestion > 0 ? s.marksPerQuestion : fallback.marks;
  const neg = negativeUnderPlan(plan, sectionIndex);
  return correct ? per : neg > 0 ? -neg : 0;
}
