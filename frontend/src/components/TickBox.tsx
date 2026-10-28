"use client";

/**
 * Big, tappable tick box (replaces the raw 16px browser checkbox on the test screens).
 *  - the WHOLE row is the tap target (min 48px high) — easy with a thumb on a 360px phone
 *  - the tick is drawn by us, so it is clearly visible on every browser / dark mode
 *  - still a real <input type="checkbox"> underneath: keyboard (Space), screen readers and form semantics keep working
 */
import * as React from "react";

export function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M4.5 10.5l3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TickBox({
  checked,
  onChange,
  children,
  className = "",
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex min-h-[48px] cursor-pointer touch-manipulation select-none items-start gap-3 rounded-xl border p-3 text-sm transition ${
        checked ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/60"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""} ${className}`}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition peer-focus-visible:ring-2 peer-focus-visible:ring-[hsl(var(--ring))] peer-focus-visible:ring-offset-2 ${
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background text-transparent"
        }`}
      >
        <CheckIcon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 leading-relaxed text-muted-foreground">{children}</span>
    </label>
  );
}
