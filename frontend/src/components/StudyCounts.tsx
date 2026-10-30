"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

type Tot = { questions: number };
type Res = { totals: { today: Tot; week: Tot; month: Tot; year: Tot; all: Tot } };

/** Dashboard strip: questions solved today / this week / this month / in total, linking to the full My progress page. Silent on failure. */
export function StudyCounts({ className = "" }: { className?: string }) {
  const t = useT();
  const [d, setD] = React.useState<Res | null>(null);
  React.useEffect(() => {
    let live = true;
    try {
      if (!localStorage.getItem("ssc_access_token")) return;
    } catch {
      return;
    }
    api<Res>("/study-stats?period=today")
      .then((r) => { if (live) setD(r); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  if (!d) return null;
  const cells: [string, number][] = [
    [t("Today", "Aaj"), d.totals.today.questions],
    [t("This week", "Is hafte"), d.totals.week.questions],
    [t("This month", "Is mahine"), d.totals.month.questions],
    [t("Since start", "Shuru se"), d.totals.all.questions],
  ];
  return (
    <a href="/progress" className={`card block p-4 transition hover:border-primary/40 ${className}`} aria-label={t("My progress", "Meri progress")}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">{t("Questions I solved", "Maine kitne sawal kiye")}</h2>
        <span className="text-xs font-semibold text-primary">{t("Details →", "Details →")}</span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-center">
        {cells.map(([l, n]) => (
          <div key={l}>
            <p className="text-xl font-extrabold tabular-nums">{n}</p>
            <p className="text-[11px] text-muted-foreground">{l}</p>
          </div>
        ))}
      </div>
    </a>
  );
}
