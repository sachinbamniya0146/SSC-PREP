"use client";
/**
 * One small pill that says which plan the student is on - replaces the big "Premium active" card on the dashboard.
 *
 *   free      "Free plan · See what Premium adds"  -> /premium#compare   (calm, not a banner)
 *   premium   "✦ Premium · 42 days left"           -> /premium           (renew when <= 7 days)
 *   admin     "✦ Admin · full access"              (no link: an admin has no plan to buy / renew)
 *
 * It is ~30px tall, never wraps on a 360px phone and has a fixed-size placeholder while the plan loads, so nothing jumps.
 */
import * as React from "react";
import { useT } from "@/lib/i18n";

export type PlanState = {
  active: boolean;
  admin?: boolean;
  plan?: { name?: string } | null;
  endsAt?: string;
  daysLeft?: number;
  expiringSoon?: boolean;
} | null;

const base = "inline-flex h-8 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition";

export default function PremiumStatus({ subscription, className = "" }: { subscription: PlanState; className?: string }) {
  const tr = useT();

  if (subscription === null) {
    return <span aria-hidden className={`${base} w-36 animate-pulse border-border bg-muted ${className}`} />;
  }

  if (subscription.active && subscription.admin) {
    return (
      <span className={`${base} border-warning/40 bg-warning/10 text-foreground ${className}`} title={tr("Admin accounts have every feature", "Admin account me sab features hote hain")}>
        <span aria-hidden className="text-warning">✦</span>
        {tr("Admin · full access", "Admin · full access")}
      </span>
    );
  }

  if (subscription.active) {
    const days = typeof subscription.daysLeft === "number" ? subscription.daysLeft : null;
    const soon = !!subscription.expiringSoon;
    const until = subscription.endsAt ? new Date(subscription.endsAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
    return (
      <a
        href="/premium"
        title={until ? `${tr("Valid until", "Valid until")} ${until}` : undefined}
        className={`${base} ${soon ? "border-warning/60 bg-warning/15" : "border-warning/40 bg-warning/10"} text-foreground hover:border-warning ${className}`}
      >
        <span aria-hidden className="text-warning">✦</span>
        <span>Premium</span>
        {days !== null && (
          <span className="font-medium text-muted-foreground">
            · {days} {days === 1 ? tr("day left", "din baaki") : tr("days left", "din baaki")}
          </span>
        )}
        {soon && <span className="text-primary">· {tr("Renew", "Renew")}</span>}
      </a>
    );
  }

  return (
    <a href="/premium#compare" className={`${base} border-border bg-card text-foreground hover:border-primary/50 ${className}`}>
      <span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success">Free</span>
      <span className="truncate font-medium text-muted-foreground">{tr("See what Premium adds", "Premium me kya extra milta hai")} →</span>
    </a>
  );
}
