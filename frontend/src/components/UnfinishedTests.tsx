"use client";

import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";
import { useT } from "@/lib/i18n";

type Item = { attemptId: string; title: string; totalQuestions: number; answered: number; secondsLeft: number; resumeUrl: string };

function fmt(sec: number): string {
  const m = Math.max(0, Math.floor(sec / 60));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

/**
 * S49 — "Continue where you left off": the student's unfinished tests (clock still running) as a card on the dashboard and the history page,
 * each with a Continue button that reopens the same questions with the saved answers. Shows nothing when there is none; any failure is silent.
 */
export function UnfinishedTests({ className = "" }: { className?: string }) {
  const t = useT();
  const [items, setItems] = React.useState<Item[]>([]);

  React.useEffect(() => {
    let live = true;
    try {
      if (!localStorage.getItem("ssc_access_token")) return;
    } catch {
      return;
    }
    (async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/tests/attempts/active`);
        if (!r.ok || !live) return;
        const d = await r.json();
        const list: Item[] = Array.isArray(d?.items) ? d.items : [];
        if (live) setItems(list.filter((x) => x.secondsLeft > 30));
      } catch {
        /* silent */
      }
    })();
    return () => { live = false; };
  }, []);

  if (items.length === 0) return null;
  return (
    <section className={`card border-primary/40 bg-primary/5 p-4 ${className}`} aria-label={t("Unfinished tests", "Adhure test")}>
      <h2 className="text-sm font-bold">{t("Continue where you left off", "Jahan chhoda wahin se continue karo")}</h2>
      <ul className="mt-2 space-y-2">
        {items.map((x) => (
          <li key={x.attemptId} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 text-sm">
              <span className="block truncate font-semibold">{x.title}</span>
              <span className="text-xs text-muted-foreground">
                {x.answered}/{x.totalQuestions} {t("answered", "jawab diye")} · {fmt(x.secondsLeft)} {t("left", "bache")}
              </span>
            </span>
            <a className="btn btn-primary btn-sm" href={x.resumeUrl}>{t("Continue", "Continue")}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}
