"use client";

/**
 * Session 22 — renders a Venn/figure-diagram question or option from a
 * (type code, labels) pair instead of a stored image. Codes must match
 * backend/src/bank/diagram-types.ts exactly — if a new code is ever added
 * on the backend, add its geometry here too, or it silently falls back to
 * the "unsupported" placeholder below (never a broken image icon).
 *
 * Usage:
 *   <DiagramVenn type="V2" labels={["तैराकी", "दौड़", "खेल"]} />
 *
 * `type` / `labels` normally come straight off an option or question stem:
 *   option.diagramType, option.diagramLabels
 *   question.questionDiagramType, question.questionDiagramLabels
 */

export interface DiagramVennProps {
  type: string;
  labels?: (string | null)[] | null;
  size?: number; // rendered square size in px, default 140
  className?: string;
}

type CircleSpec = { cx: number; cy: number; r: number };
type LabelPos = { x: number; y: number };

interface TypeGeometry {
  circles: CircleSpec[];
  labelPositions: LabelPos[]; // one per circle, same order
}

// viewBox is always "0 0 200 150" — keep every geometry inside that.
const GEOMETRY: Record<string, TypeGeometry> = {
  // V1 — three circles, all mutually intersecting (triangle overlap)
  V1: {
    circles: [
      { cx: 80, cy: 60, r: 45 },
      { cx: 130, cy: 60, r: 45 },
      { cx: 105, cy: 105, r: 45 },
    ],
    labelPositions: [
      { x: 45, y: 40 },
      { x: 165, y: 40 },
      { x: 105, y: 138 },
    ],
  },
  // V2 — chain: 1∩2 and 2∩3 overlap, 1∩3 does not
  V2: {
    circles: [
      { cx: 48, cy: 75, r: 40 },
      { cx: 100, cy: 75, r: 40 },
      { cx: 152, cy: 75, r: 40 },
    ],
    labelPositions: [
      { x: 18, y: 45 },
      { x: 100, y: 30 },
      { x: 182, y: 45 },
    ],
  },
  // V3 — two overlapping circles, one separate
  V3: {
    circles: [
      { cx: 55, cy: 55, r: 35 },
      { cx: 95, cy: 55, r: 35 },
      { cx: 160, cy: 95, r: 30 },
    ],
    labelPositions: [
      { x: 30, y: 30 },
      { x: 120, y: 30 },
      { x: 160, y: 95 },
    ],
  },
  // V4 — three circles, all separate (disjoint)
  V4: {
    circles: [
      { cx: 35, cy: 75, r: 25 },
      { cx: 100, cy: 75, r: 25 },
      { cx: 165, cy: 75, r: 25 },
    ],
    labelPositions: [
      { x: 35, y: 75 },
      { x: 100, y: 75 },
      { x: 165, y: 75 },
    ],
  },
  // V5 — one circle fully inside another (subset), a third separate
  V5: {
    circles: [
      { cx: 55, cy: 70, r: 42 },
      { cx: 55, cy: 70, r: 16 },
      { cx: 150, cy: 70, r: 20 },
    ],
    labelPositions: [
      { x: 55, y: 25 },
      { x: 55, y: 70 },
      { x: 150, y: 70 },
    ],
  },
  // V6 — three concentric circles (same centre, different sizes)
  V6: {
    circles: [
      { cx: 100, cy: 75, r: 48 },
      { cx: 100, cy: 75, r: 30 },
      { cx: 100, cy: 75, r: 13 },
    ],
    labelPositions: [
      { x: 100, y: 20 },
      { x: 100, y: 48 },
      { x: 100, y: 75 },
    ],
  },
  // V7 — one big circle containing two smaller separate circles
  V7: {
    circles: [
      { cx: 100, cy: 75, r: 58 },
      { cx: 72, cy: 75, r: 18 },
      { cx: 128, cy: 75, r: 18 },
    ],
    labelPositions: [
      { x: 100, y: 15 },
      { x: 72, y: 75 },
      { x: 128, y: 75 },
    ],
  },
  // V8 — two overlapping circles, small circle nested inside one of them
  V8: {
    circles: [
      { cx: 62, cy: 75, r: 40 },
      { cx: 112, cy: 75, r: 40 },
      { cx: 135, cy: 75, r: 13 },
    ],
    labelPositions: [
      { x: 30, y: 45 },
      { x: 145, y: 45 },
      { x: 135, y: 75 },
    ],
  },
};

export default function DiagramVenn({ type, labels, size = 140, className = "" }: DiagramVennProps) {
  const geo = GEOMETRY[type?.toUpperCase()];

  if (!geo) {
    // Unsupported/unknown code — never render a broken image, show a
    // clearly-labelled placeholder instead so it's obvious in QA/admin
    // review that this row needs a code fix, not a silent blank.
    return (
      <div
        className={`flex items-center justify-center rounded-lg border border-dashed border-border text-[10px] text-muted-foreground ${className}`}
        style={{ width: size, height: size * 0.75 }}
      >
        Diagram type "{type}" not supported
      </div>
    );
  }

  const safeLabels = labels ?? [];

  return (
    <svg
      viewBox="0 0 200 150"
      width={size}
      height={size * 0.75}
      className={className}
      role="img"
      aria-label={`Venn diagram: ${safeLabels.filter(Boolean).join(', ') || type}`}
    >
      {geo.circles.map((c, i) => (
        <circle
          key={i}
          cx={c.cx}
          cy={c.cy}
          r={c.r}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          className="text-foreground"
        />
      ))}
      {geo.labelPositions.map((p, i) => {
        const label = safeLabels[i];
        if (!label) return null;
        return (
          <text
            key={i}
            x={p.x}
            y={p.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={10}
            className="fill-foreground"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}
