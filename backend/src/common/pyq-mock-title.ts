/**
 * What a STUDENT sees as the name of a real-paper (PYQ) mock (Sachin, 29 Oct 2026):
 * "date wise sirf admin ko show ho, students ko sirf mock test year or shift wise dikhe".
 *
 *   SSC CGL 2025 · Tier 1 · Shift 2 · Set 3
 *
 * The real exam DATE is never part of this name. Papers that share exam + tier + paper + year + shift
 * are told apart by "Set 1, Set 2, ..." in the order they were created (stable: a later upload of an
 * older date never renames an existing mock). The admin keeps seeing the real date: the date column of
 * the PYQ Papers page, the Date Mapping page and `titleForPaper()` in pyq-paper-key.ts.
 *
 * Pure functions only (no Nest, no Prisma): unit-tested in pyq-mock-title.spec.ts.
 */
import { shiftForKey } from './pyq-paper-key';

export interface StudentTitleParts {
  examTier?: string | null; // TIER_1 | TIER_2 | null (old papers have no tier)
  tierPaper?: string | null; // PAPER_1.. | null
  year?: number | null;
  shift?: string | null;
}

/** "SSC CGL 2025 · Tier 1 · Shift 2 · Set 3" (parts that do not exist are left out, "Paper n" only for Tier 2 / paper 2+). */
export function studentMockTitle(examName: string, p: StudentTitleParts, setNo: number): string {
  const bits: string[] = [];
  bits.push(p.year ? `${examName} ${p.year}` : examName);
  if (p.examTier === 'TIER_1' || p.examTier === 'TIER_2') {
    bits.push(p.examTier === 'TIER_2' ? 'Tier 2' : 'Tier 1');
    const paper = p.tierPaper === 'PAPER_2' || p.tierPaper === 'PAPER_3' ? p.tierPaper : 'PAPER_1';
    if (p.examTier === 'TIER_2' || paper !== 'PAPER_1') bits.push(`Paper ${paper.slice(-1)}`);
  }
  const shift = shiftForKey(p.shift);
  if (shift) bits.push(shift);
  bits.push(`Set ${Math.max(1, Math.floor(setNo) || 1)}`);
  return bits.join(' · ');
}

/** Everything that makes two mocks "the same kind": they get Set 1, Set 2 ... inside it. */
export function mockGroupKey(examId: string | null | undefined, p: StudentTitleParts): string {
  const paper = p.tierPaper === 'PAPER_2' || p.tierPaper === 'PAPER_3' ? p.tierPaper : 'PAPER_1';
  return [examId ?? '', p.examTier ?? '', p.examTier ? paper : '', p.year ?? '', shiftForKey(p.shift)].join('|');
}

export interface MockForSetNo extends StudentTitleParts {
  id: string;
  examId?: string | null;
  createdAt: Date;
}

/**
 * Set number of every mock: inside one group, oldest first (createdAt, then id). Returns id -> setNo.
 */
export function assignSetNumbers(mocks: MockForSetNo[]): Map<string, number> {
  const groups = new Map<string, MockForSetNo[]>();
  for (const m of mocks) {
    const k = mockGroupKey(m.examId, m);
    const list = groups.get(k);
    if (list) list.push(m);
    else groups.set(k, [m]);
  }
  const out = new Map<string, number>();
  for (const list of groups.values()) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    list.forEach((m, i) => out.set(m.id, i + 1));
  }
  return out;
}

/**
 * A copy of a TestTemplate row without the real exam date, for anything a student can read
 * (the mock list, the attempt / result payload). The admin screens read the template themselves.
 */
export function withoutExamDate<T extends object>(row: T): T {
  const copy: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  delete copy.examDate;
  return copy as T;
}
