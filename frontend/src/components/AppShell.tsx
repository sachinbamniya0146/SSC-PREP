"use client";
/**
 * Shared page chrome for signed-in student pages (Oct 2026 design pass).
 *
 *   <AppShell width="lg">
 *     <PageHeading title="Mock Tests" subtitle="…" actions={<a className="btn btn-outline">…</a>} />
 *     …content…
 *   </AppShell>
 *
 * - AppShell renders AppHeader (nav, theme switch, account menu) + a width-limited <main>. It reads the cached
 *   `ssc_user` from localStorage after mount (same as the dashboard) so there is no hydration mismatch.
 * - Small presentational helpers (PageHeading, EmptyState, ErrorNote, CardSkeletons, ChoiceChip) keep every page's
 *   loading / empty / selected states consistent. None of them own data, so they are safe to use anywhere.
 */
import * as React from "react";
import { AppHeader } from "@/components/AppHeader";

type Width = "md" | "lg" | "wide" | "xl";
const WIDTH: Record<Width, string> = {
  md: "max-w-3xl",
  lg: "max-w-4xl",
  wide: "max-w-5xl",
  xl: "max-w-6xl",
};

/** AppHeader wired to the cached signed-in user. Use directly on pages that keep their own <main> layout. */
export function ShellHeader() {
  const [name, setName] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem("ssc_user");
        if (raw) setName(JSON.parse(raw)?.fullName || undefined);
      } catch {
        /* ignore */
      }
    };
    read();
    window.addEventListener("ssc-user-updated", read);
    return () => window.removeEventListener("ssc-user-updated", read);
  }, []);
  return <AppHeader name={name} />;
}

export function AppShell({ children, width = "lg" }: { children: React.ReactNode; width?: Width }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <ShellHeader />
      <main className={`mx-auto w-full ${WIDTH[width]} px-4 py-6 sm:px-6 sm:py-10`}>{children}</main>
    </div>
  );
}

export function PageHeading({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground sm:text-base">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon ? (
        <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-xl" aria-hidden>
          {icon}
        </div>
      ) : null}
      <p className="text-base font-semibold">{title}</p>
      {body ? <p className="max-w-md text-sm text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ErrorNote({ children, onRetry, retryLabel = "Try again" }: { children: React.ReactNode; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="card flex flex-wrap items-center justify-between gap-3 border-danger/30 bg-danger/5 px-5 py-4 text-sm">
      <p className="font-medium text-danger">{children}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="btn btn-outline btn-sm">
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/** Placeholder rows shaped like the real cards, so the page does not jump when data arrives. */
export function CardSkeletons({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card flex items-center justify-between gap-4 p-5">
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton h-3 w-1/2" />
            <div className="skeleton h-5 w-20 rounded-full" />
          </div>
          <div className="skeleton h-10 w-28 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

/** Selectable pill / tile. `tile` = bigger two-line card used for exams & subjects. */
export function ChoiceChip({
  selected,
  onClick,
  children,
  disabled,
  tile,
  className = "",
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  tile?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`border text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
        tile ? "rounded-xl p-4" : "rounded-lg px-3.5 py-2 text-sm"
      } ${
        selected
          ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/40"
          : "border-border bg-card hover:border-primary/50 hover:bg-muted/50"
      } ${className}`}
    >
      {children}
    </button>
  );
}
