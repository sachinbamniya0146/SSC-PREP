"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";
import { useT } from "@/lib/i18n";

type Item = { attemptId: string; title: string; totalQuestions: number; answered: number; secondsLeft: number; resumeUrl: string };

const IGNORED_KEY = "ssc_resume_ignored";

function ignoredIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(IGNORED_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(-30) : [];
  } catch {
    return [];
  }
}

function fmt(sec: number): string {
  const m = Math.max(0, Math.floor(sec / 60));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

/**
 * S48 — "Continue your test" pop-up. Mounted once in the root layout. On the student's browsing pages it asks the server for tests that were started
 * and not finished while their time still runs, and shows ONE box: Continue (opens the test where it was) or Ignore (not shown again for that test).
 * Never shown on the exam / auth / admin screens. Any failure is silent - this is a convenience, not a gate.
 */
export function ResumeTestPrompt() {
  const t = useT();
  const pathname = usePathname() || "";
  const [item, setItem] = React.useState<Item | null>(null);

  const hide =
    pathname.startsWith("/test") || pathname.startsWith("/cgl-test") || pathname.startsWith("/quiz") || pathname.startsWith("/login") ||
    pathname.startsWith("/signup") || pathname.startsWith("/verification") || pathname.startsWith("/admin") || pathname.startsWith("/vocabulary/") ||
    pathname.startsWith("/results") || pathname === "/" || pathname.startsWith("/privacy") || pathname.startsWith("/terms");

  React.useEffect(() => {
    if (hide) { setItem(null); return; }
    let token: string | null = null;
    try { token = localStorage.getItem("ssc_access_token"); } catch { token = null; }
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/tests/attempts/active`);
        if (!r.ok || cancelled) return;
        const d = await r.json();
        const skip = new Set(ignoredIds());
        const next = (Array.isArray(d?.items) ? (d.items as Item[]) : []).find((x) => x.secondsLeft > 30 && !skip.has(x.attemptId));
        if (!cancelled) setItem(next ?? null);
      } catch {
        /* silent */
      }
    })();
    return () => { cancelled = true; };
  }, [pathname, hide]);

  if (!item || hide) return null;

  const ignore = () => {
    try {
      localStorage.setItem(IGNORED_KEY, JSON.stringify([...ignoredIds(), item.attemptId]));
    } catch { /* ignore */ }
    setItem(null);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={t("Continue your test", "Apna test jaari rakhein")}>
      <div className="card w-full max-w-sm p-5 shadow-xl">
        <h2 className="text-lg font-bold">{t("You have an unfinished test", "Aapka ek test adhoora hai")}</h2>
        <p className="mt-1 text-sm font-medium">{item.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(`${item.answered} of ${item.totalQuestions} answered · ${fmt(item.secondsLeft)} left`, `${item.totalQuestions} me se ${item.answered} kiye · ${fmt(item.secondsLeft)} bache`)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">{t("The timer keeps running until you finish or time is over.", "Timer tab tak chalta hai jab tak aap finish na karein ya time khatam na ho.")}</p>
        <div className="mt-4 flex gap-2">
          <a href={item.resumeUrl} className="btn btn-primary flex-1 text-center">{t("Continue", "Continue")}</a>
          <button type="button" onClick={ignore} className="btn btn-outline flex-1">{t("Ignore", "Ignore")}</button>
        </div>
      </div>
    </div>
  );
}
