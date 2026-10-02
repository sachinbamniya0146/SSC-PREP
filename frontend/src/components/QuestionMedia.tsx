"use client";

/**
 * Shared question media (Oct 2026) — ONE place that shows every kind of figure
 * so a diagram question looks the same on every screen (test, practice, PYQ,
 * results, review, bookmarks…):
 *   • Venn type codes  (DiagramVenn)
 *   • pictures / SVG-code diagrams (stored as an image URL or a data: URI)
 *   • solution pictures inside explanation text  ![solution](url)
 * Pictures that fail to load retry twice, then show a tap-to-retry note instead
 * of a silent blank. Old URLs saved with a wrong host (localhost / http / old
 * domain) are re-pointed at the live /api/v1/media route.
 */
import * as React from "react";
import { API_BASE } from "@/lib/api";
import DiagramVenn from "@/components/DiagramVenn";

export function resolveMediaUrl(u?: string | null): string {
  if (!u) return "";
  if (u.startsWith("data:")) return u;
  const m = u.match(/\/api\/v1\/media\/(question-images\/[A-Za-z0-9._-]+)/);
  if (m) return `${API_BASE}/media/${m[1]}`;
  if (u.startsWith("http://") && typeof window !== "undefined" && window.location.protocol === "https:") {
    return u.replace(/^http:\/\//, "https://");
  }
  return u;
}

export function QFigure({ src, alt = "Figure", className = "max-h-64" }: { src?: string | null; alt?: string; className?: string }) {
  const [attempt, setAttempt] = React.useState(0);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [src]);
  if (!src) return null;
  const base = resolveMediaUrl(src);
  const url = attempt > 0 && !base.startsWith("data:") ? `${base}${base.includes("?") ? "&" : "?"}r=${attempt}` : base;
  if (failed) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setFailed(false);
          setAttempt((a) => a + 1);
        }}
        className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:border-primary"
      >
        ⚠️ Image load nahi hui — dobara try karne ke liye tap karein
      </button>
    );
  }
  return (
    // White card so black line-art stays readable in dark mode.
    <span className="inline-flex max-w-full items-center justify-center rounded-lg bg-white p-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => (attempt < 2 ? setAttempt((a) => a + 1) : setFailed(true))}
        className={`${className} max-w-full object-contain`}
      />
    </span>
  );
}

type StemProps = {
  diagramType?: string | null;
  diagramLabels?: (string | null)[] | null;
  imageUrl?: string | null;
};

/** Figure under the question text (nothing is rendered for ordinary text questions). */
export function StemMedia({ diagramType, diagramLabels, imageUrl }: StemProps) {
  if (!diagramType && !imageUrl) return null;
  return (
    <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-border bg-muted/30 p-3">
      {diagramType && <DiagramVenn type={diagramType} labels={diagramLabels} size={180} />}
      {imageUrl && <QFigure src={imageUrl} alt="Question figure" />}
    </div>
  );
}

type OptProps = StemProps & { text?: string | null; textHi?: string | null; showHi?: boolean; label?: string };

/** The inside of an option button: figure when the option is a picture/diagram, otherwise its text. */
export function OptionBody({ diagramType, diagramLabels, imageUrl, text, textHi, showHi, label }: OptProps) {
  if (diagramType || imageUrl) {
    return (
      <span className="flex flex-col items-center gap-1 py-1">
        {diagramType && <DiagramVenn type={diagramType} labels={diagramLabels} size={110} />}
        {imageUrl && <QFigure src={imageUrl} alt={label ? `Option ${label}` : "Option"} className="max-h-36" />}
        {text ? <span className="text-xs">{text}</span> : null}
      </span>
    );
  }
  return <>{showHi && textHi ? textHi : text}</>;
}

const IMG_MD = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

/** Explanation text that may contain  ![solution](url|data-uri)  picture lines. */
export function RichText({ text, className = "" }: { text?: string | null; className?: string }) {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  IMG_MD.lastIndex = 0;
  while ((m = IMG_MD.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={`t${last}`} className="whitespace-pre-line">{text.slice(last, m.index)}</span>);
    parts.push(
      <span key={`i${m.index}`} className="my-2 block text-center">
        <QFigure src={m[2]} alt={m[1] || "Solution figure"} className="max-h-72" />
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={`t${last}`} className="whitespace-pre-line">{text.slice(last)}</span>);
  return <div className={className}>{parts}</div>;
}

/** Plain-text version (for line-clamped previews) — strips the picture markdown. */
export function stripImages(text?: string | null): string {
  return (text ?? "").replace(IMG_MD, "").trim();
}
