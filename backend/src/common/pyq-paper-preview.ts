/**
 * Preview of what an upload will do to the date-wise + tier-wise PYQ papers (26 Oct 2026).
 * Pure (no Nest / Prisma) so it is unit-tested alone. Used by the check-only (dry-run) and the real upload.
 *
 *  - papers[]  : every real paper (exam + tier + paper + date + shift) the file's rows belong to, with the row count
 *  - pending[] : rows that will join NO date-wise mock, with the reason (so the admin can fix the sheet and re-upload)
 *  - warnings[]: one Hinglish line per pending row
 */
import { buildPaperKey, effectiveTierPaper, normalizeExamTier, normalizeTierPaper, parsePaperKey, shiftForKey } from './pyq-paper-key';

export type PendingReason = 'INVALID_TIER' | 'INVALID_PAPER' | 'DATE_WITHOUT_TIER' | 'TIER_WITHOUT_DATE';

export interface PaperRowInput {
  row: number;
  examId?: string | null;
  examDate?: string | null; // already normalised (YYYY-MM-DD) or undefined
  shift?: string | null;
  rawTier?: unknown;
  rawPaper?: unknown;
}

export interface PreviewPaper {
  key: string;
  examId: string;
  examTier: string;
  tierPaper: string;
  examDate: string;
  shift: string | null;
  rows: number;
}
export interface PendingRow { row: number; reason: PendingReason; value?: string; message: string }
export interface PaperPreview { papers: PreviewPaper[]; pending: PendingRow[]; pendingTotal: number }

export const MAX_PENDING_LISTED = 200;

const MSG: Record<PendingReason, (v?: string) => string> = {
  INVALID_TIER: (v) => `examTier "${v}" is not understood (write TIER_1 or TIER_2) — this row joins no date-wise mock.`,
  INVALID_PAPER: (v) => `tierPaper "${v}" is not understood (PAPER_1 / PAPER_2 / PAPER_3) — the row will be treated as PAPER_1.`,
  DATE_WITHOUT_TIER: () => 'examDate is present but examTier (TIER_1 / TIER_2) is missing — this row joins no date-wise mock.',
  TIER_WITHOUT_DATE: () => 'examTier is present but examDate is missing — this row joins no date-wise mock.',
};

export function buildPaperPreview(inputs: PaperRowInput[]): PaperPreview {
  const papers = new Map<string, PreviewPaper>();
  const pending: PendingRow[] = [];
  let pendingTotal = 0;
  const add = (row: number, reason: PendingReason, value?: string) => {
    pendingTotal++;
    if (pending.length < MAX_PENDING_LISTED) pending.push({ row, reason, value, message: MSG[reason](value) });
  };

  for (const r of inputs) {
    const rawTier = String(r.rawTier ?? '').trim();
    const rawPaper = String(r.rawPaper ?? '').trim();
    const tier = normalizeExamTier(rawTier);
    const paper = normalizeTierPaper(rawPaper);
    const hasDate = !!r.examDate;

    if (tier.invalid) add(r.row, 'INVALID_TIER', rawTier);
    else if (hasDate && !tier.tier) add(r.row, 'DATE_WITHOUT_TIER');
    else if (!hasDate && tier.tier) add(r.row, 'TIER_WITHOUT_DATE');
    if (paper.invalid) add(r.row, 'INVALID_PAPER', rawPaper);

    const key = buildPaperKey({ examId: r.examId, examTier: tier.tier, tierPaper: paper.paper, examDate: r.examDate, shift: r.shift });
    if (!key) continue;
    const hit = papers.get(key);
    if (hit) { hit.rows++; continue; }
    const p = parsePaperKey(key);
    if (!p) continue;
    papers.set(key, {
      key, examId: p.examId, examTier: p.examTier, tierPaper: effectiveTierPaper(p.tierPaper),
      examDate: p.examDate, shift: shiftForKey(p.shift) || null, rows: 1,
    });
  }
  const list = [...papers.values()].sort((a, b) => b.examDate.localeCompare(a.examDate) || a.examTier.localeCompare(b.examTier) || (a.shift ?? '').localeCompare(b.shift ?? ''));
  return { papers: list, pending, pendingTotal };
}
