/**
 * Session 22 — Venn/figure-based diagram question taxonomy.
 *
 * Real SSC reasoning papers reuse the same handful of circle arrangements
 * over and over ("select the Venn diagram that best represents X, Y, Z").
 * Instead of storing a picture per question (which doesn't scale to bulk-
 * uploading thousands and looks blurry on small screens), we store a TYPE
 * CODE + up to 3 labels, and the frontend renders crisp SVG from it.
 *
 * This file is the single source of truth for which codes are valid, on
 * the BACKEND side (upload validation). The matching geometry (circle
 * positions/radii for each code) lives on the frontend, in
 * frontend/src/components/DiagramVenn.tsx — the two files must be kept in
 * sync if a new code is ever added. Keep descriptions here in sync with
 * that file's comments too.
 */

export interface DiagramTypeInfo {
  code: string;
  description: string;
  maxLabels: number; // how many circles this arrangement has (labels beyond this are ignored)
}

export const DIAGRAM_TYPES: DiagramTypeInfo[] = [
  { code: 'V1', description: 'Three circles, all mutually intersecting (triangle overlap)', maxLabels: 3 },
  { code: 'V2', description: 'Three circles in a chain: 1∩2 and 2∩3 overlap, 1∩3 does not', maxLabels: 3 },
  { code: 'V3', description: 'Two circles overlapping, one separate', maxLabels: 3 },
  { code: 'V4', description: 'Three circles, all separate (disjoint)', maxLabels: 3 },
  { code: 'V5', description: 'One circle fully inside another (subset), a third circle separate', maxLabels: 3 },
  { code: 'V6', description: 'Three concentric circles (same centre, different sizes)', maxLabels: 3 },
  { code: 'V7', description: 'One big circle containing two smaller separate (non-overlapping) circles', maxLabels: 3 },
  { code: 'V8', description: 'Two overlapping circles, with a small circle nested fully inside one of them', maxLabels: 3 },
];

const VALID_CODES = new Set(DIAGRAM_TYPES.map((d) => d.code));

export function isValidDiagramType(code: string | undefined | null): boolean {
  if (!code) return false;
  return VALID_CODES.has(code.trim().toUpperCase());
}

export function normalizeDiagramType(code: string | undefined | null): string | undefined {
  if (!code || !code.trim()) return undefined;
  const upper = code.trim().toUpperCase();
  if (!VALID_CODES.has(upper)) {
    throw new Error(
      `Invalid diagram type "${code}". Valid codes: ${DIAGRAM_TYPES.map((d) => d.code).join(', ')}. ` +
        `See GET /admin/help/prompts or /admin/help/formats for descriptions of each code.`,
    );
  }
  return upper;
}

// Parses a "labels" cell like "तैराकी,दौड़,खेल" into a trimmed string array.
export function parseDiagramLabels(raw: string | undefined | null): string[] | undefined {
  if (!raw || !raw.trim()) return undefined;
  const labels = raw
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);
  return labels.length ? labels : undefined;
}
