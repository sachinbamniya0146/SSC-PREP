"use client";
import * as React from "react";
import { toggleBookmark, useBookmarked } from "@/lib/bookmark-store";
import { useFeatures } from "@/lib/features";
import { useT } from "@/lib/i18n";

/**
 * Star on a question (test screen, review, bank). Flips instantly; if the server refuses (switched off by the admin,
 * free-plan limit, network) the star goes back and a short message shows next to it.
 * Hidden completely when the admin has switched bookmarks off AND the question is not already saved.
 */
export function BookmarkButton({
  questionId,
  size = "md",
  withLabel = false,
  className = "",
}: {
  questionId: string | null | undefined;
  size?: "sm" | "md";
  withLabel?: boolean;
  className?: string;
}) {
  const tr = useT();
  const on = useBookmarked(questionId);
  const { on: flag } = useFeatures();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const timer = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  if (!questionId) return null;
  if (!flag("bookmarks") && !on) return null;

  const click = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      await toggleBookmark(questionId);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : tr("Could not save", "Save nahi hua"));
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setMsg(""), 4000);
    } finally {
      setBusy(false);
    }
  };

  const dim = size === "sm" ? "h-8 min-w-8 px-2 text-sm" : "h-10 min-w-10 px-3 text-base";
  return (
    <span className={`relative inline-flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={click}
        aria-pressed={on}
        aria-label={on ? tr("Remove bookmark", "Bookmark hatao") : tr("Bookmark this question", "Question bookmark karo")}
        title={on ? tr("Bookmarked - tap to remove", "Bookmark hai - hatane ke liye tap karo") : tr("Bookmark for later", "Baad me dekhne ke liye bookmark")}
        className={`inline-flex items-center justify-center gap-1.5 rounded-full border font-semibold transition active:scale-90 ${dim} ${
          on ? "border-warning/50 bg-warning/15 text-warning" : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
        } ${busy ? "opacity-70" : ""}`}
      >
        <span aria-hidden className={`inline-block transition-transform ${on ? "scale-110" : ""}`}>{on ? "★" : "☆"}</span>
        {withLabel && <span className="text-xs">{on ? tr("Bookmarked", "Bookmarked") : tr("Bookmark", "Bookmark")}</span>}
      </button>
      {msg && (
        <span role="status" className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-card p-2 text-xs text-danger shadow-lg">
          {msg}
        </span>
      )}
    </span>
  );
}
