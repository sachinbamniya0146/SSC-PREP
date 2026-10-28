"use client";
/**
 * Full-screen "your purchase is live" moment: a gift to tap -> cracker blast (confetti) -> what you got.
 * Shown once per order (the caller decides); Escape / the close button skips straight to the normal page.
 */
import * as React from "react";
import Link from "next/link";
import { fireConfetti } from "@/lib/confetti";

export type CelebrationPlan = { name: string; endsAt?: string | null; daysLeft?: number | null } | null;

const COPY: Record<string, { emoji: string; title: string; sub: string; big: boolean }> = {
  PLAN: { emoji: "👑", title: "Premium is active!", sub: "Everything is unlocked. Go crush your next mock.", big: true },
  CHAPTER: { emoji: "📘", title: "Chapter PDF unlocked", sub: "Your download is ready in the chapter.", big: false },
  MOCK: { emoji: "📝", title: "Mock test unlocked", sub: "You can start it right now.", big: false },
  VOCAB_WORD: { emoji: "🔓", title: "Word unlocked", sub: "It stays unlocked — no re-locking.", big: false },
  VOCAB_UNLOCK_ALL: { emoji: "🚀", title: "All words unlocked", sub: "The whole vocabulary course is open for you.", big: true },
  VOCAB_SUBSCRIPTION: { emoji: "📖", title: "Vocabulary plan active", sub: "Learn at your pace for the next 30 days.", big: false },
  VOCAB_REVISION_SKIP: { emoji: "⏭️", title: "Revision skipped", sub: "You are clear to continue today.", big: false },
};

const PERKS = ["Unlimited practice sets", "All premium mock tests", "Detailed solutions & analytics", "Weak-area practice"];

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");

export function PurchaseCelebration({
  kind,
  plan,
  orderId,
  onClose,
}: {
  kind: string | null;
  plan: CelebrationPlan;
  orderId: string;
  onClose: () => void;
}) {
  const info = COPY[kind || ""] ?? { emoji: "🎉", title: "Purchase successful!", sub: "Your purchase is now active.", big: false };
  const [revealed, setRevealed] = React.useState(false);
  const stopRef = React.useRef<() => void>(() => {});
  const openBtn = React.useRef<HTMLButtonElement | null>(null);
  const doneBtn = React.useRef<HTMLAnchorElement | null>(null);

  const firedRef = React.useRef(false);
  const reveal = React.useCallback(() => {
    if (firedRef.current) return; // tap + the auto-open timer must not fire the blast twice
    firedRef.current = true;
    setRevealed(true);
    stopRef.current = fireConfetti({ intensity: info.big ? 1.25 : 0.7, rainMs: info.big ? 3200 : 1800 });
    try {
      navigator.vibrate?.([40, 40, 80]);
    } catch {
      /* not supported */
    }
  }, [info.big]);

  // auto-open after a few seconds so nobody is left staring at a gift
  React.useEffect(() => {
    const t = window.setTimeout(reveal, 4500);
    return () => window.clearTimeout(t);
  }, [reveal]);

  React.useEffect(() => () => stopRef.current(), []);

  React.useEffect(() => {
    (revealed ? doneBtn.current : openBtn.current)?.focus();
  }, [revealed]);

  // Escape closes; lock page scroll while the overlay is up
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={info.title}
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur-md"
    >
      <div className="relative my-auto w-full max-w-md">
        {!revealed ? (
          <div className="text-center">
            <p className="pop-in text-sm font-semibold uppercase tracking-widest text-primary">Payment received</p>
            <h2 className="pop-in mt-2 text-2xl font-extrabold sm:text-3xl">You have a surprise waiting</h2>
            <button
              ref={openBtn}
              type="button"
              onClick={reveal}
              className="group relative mx-auto mt-8 flex h-44 w-44 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
              aria-label="Open your gift"
            >
              <span className="glow-ring absolute inset-0 rounded-full bg-primary/30" aria-hidden />
              <span className="glow-ring absolute inset-0 rounded-full bg-accent/30 [animation-delay:0.9s]" aria-hidden />
              <span className="gift-wobble relative select-none text-[96px] leading-none drop-shadow-lg transition group-active:scale-90" aria-hidden>
                🎁
              </span>
            </button>
            <p className="mt-6 text-sm text-muted-foreground">Tap the gift to open it</p>
            <button type="button" onClick={onClose} className="mt-6 text-xs font-medium text-muted-foreground underline-offset-4 hover:underline">
              Skip
            </button>
          </div>
        ) : (
          <div className="pop-in card relative overflow-hidden p-6 text-center shadow-lift sm:p-8">
            <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-primary via-accent to-success" aria-hidden />
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-5xl" aria-hidden>
              {info.emoji}
            </div>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">{info.title}</h2>
            <p className="mt-1.5 text-muted-foreground">{info.sub}</p>

            {kind === "PLAN" && plan && (
              <div className="relative mt-5 overflow-hidden rounded-xl border border-primary/25 bg-primary/5 p-4 text-left shine">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">Your plan</p>
                <p className="mt-0.5 text-lg font-bold">{plan.name}</p>
                {plan.endsAt && (
                  <p className="text-sm text-muted-foreground">
                    Valid until <b className="text-foreground">{fmt(plan.endsAt)}</b>
                    {plan.daysLeft != null ? ` · ${plan.daysLeft} days` : ""}
                  </p>
                )}
              </div>
            )}

            {kind === "PLAN" && (
              <ul className="mt-4 grid grid-cols-1 gap-1.5 text-left text-sm sm:grid-cols-2">
                {PERKS.map((p) => (
                  <li key={p} className="flex items-start gap-2">
                    <span className="mt-0.5 text-success" aria-hidden>✓</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6 grid gap-2">
              <Link
                ref={doneBtn}
                href={kind === "PLAN" ? "/mocks" : kind?.startsWith("VOCAB") ? "/vocabulary" : "/dashboard"}
                className="btn btn-primary btn-lg w-full"
              >
                {kind === "PLAN" ? "Start a mock test" : kind?.startsWith("VOCAB") ? "Continue vocabulary" : "Go to dashboard"}
              </Link>
              <button type="button" onClick={onClose} className="btn btn-outline w-full">
                See order details
              </button>
            </div>
            {kind === "PLAN" && (
              <p className="mt-4 text-xs text-muted-foreground">
                Know someone preparing for SSC? <Link href="/referral" className="font-semibold text-primary hover:underline">Invite a friend</Link> — they save, you earn.
              </p>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground/80">Order {orderId}</p>
          </div>
        )}
      </div>
    </div>
  );
}
