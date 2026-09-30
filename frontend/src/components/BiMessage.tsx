// Shows one server message in BOTH English and Hindi together, as the
// product owner asked ("poore English or Hindi dono me message aaye").
import * as React from "react";

export default function BiMessage({
  msg,
  tone = "info",
  className = "",
}: {
  msg?: { en: string; hi: string } | null;
  tone?: "info" | "warn" | "danger" | "success";
  className?: string;
}) {
  if (!msg) return null;
  const toneCls =
    tone === "warn"
      ? "border-amber-500/40 bg-amber-500/5"
      : tone === "danger"
        ? "border-red-500/40 bg-red-500/5"
        : tone === "success"
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-border bg-card";
  return (
    <div className={`rounded-xl border p-4 text-sm ${toneCls} ${className}`}>
      <p className="font-medium">{msg.en}</p>
      <p className="mt-1.5 text-muted-foreground">{msg.hi}</p>
    </div>
  );
}
