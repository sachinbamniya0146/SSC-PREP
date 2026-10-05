"use client";

// Front-page card (NEW — Oct 3 2026): "aapka 9 AM test" + today's compulsory revision.
// Shown first on the dashboard so the planner test is the first thing a student sees.
// Renders nothing when the student has no plan / nothing is due.
import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";
import { useT } from "@/lib/i18n";

type Upcoming = {
  test: { id: string; status: string; examName: string; scheduledFor: string; msLeft: number; canStart: boolean; chapterCount: number; pattern: { totalQuestions: number; durationMinutes: number } } | null;
};
type Revision = { available: boolean; testId?: string | null; doneToday?: boolean; chapters?: unknown[] };

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function PlanTestBanner() {
  const tr = useT();
  const [up, setUp] = React.useState<Upcoming | null>(null);
  const [rev, setRev] = React.useState<Revision | null>(null);
  const [loadedAt, setLoadedAt] = React.useState(Date.now());
  const [hasPlan, setHasPlan] = React.useState<boolean | null>(null);
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    (async () => {
      try {
        const [u, r] = await Promise.all([fetchAuth(`${API_BASE}/study-plan/test/upcoming`), fetchAuth(`${API_BASE}/study-plan/revision/today`)]);
        if (u.ok) setUp(await u.json());
        if (r.ok) setRev(await r.json());
        setHasPlan(u.ok || r.ok); // both answer 400 NO_PLAN until the student sets a target
        setLoadedAt(Date.now());
      } catch {
        /* the banner is optional */
      }
    })();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const test = up?.test ?? null;
  const left = test ? Math.max(0, test.msLeft - (now - loadedAt)) : 0;
  const open = !!test && left === 0;
  const showRev = !!rev?.available && !rev.doneToday && !!rev.testId;
  if (hasPlan === null) return null;

  return (
    <div className="mb-6 space-y-3">
      {!test && !showRev && (
        <a href={hasPlan ? "/study-plan/board" : "/study-plan"} className="flex items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-primary/5 p-4">
          <div>
            <p className="text-sm font-bold">{hasPlan ? tr("🗓️ Your Study Planner", "🗓️ Aapka Study Planner") : tr("🎯 Build your Study Planner", "🎯 Apna Study Planner banayein")}</p>
            <p className="text-xs text-muted-foreground">
              {hasPlan
                ? tr("Mark the chapters you have completed — tomorrow's 9 AM test and your daily revision come from here.", "Complete kiye chapters mark karein — kal 9 AM ka test aur roz ka revision yahin se milega.")
                : tr("Choose your target exam and date, then mark chapters — we will build your daily plan, test and revision.", "Target exam aur date chunein, phir chapters mark karein — hum roz ka plan, test aur revision bana denge.")}
            </p>
          </div>
          <span className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground">{hasPlan ? "Kholein →" : tr("Start →", "Shuru →")}</span>
        </a>
      )}
      {test && (
        <div className={`rounded-2xl border p-4 ${open ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-muted-foreground">{test.examName} · Study-plan test</p>
              <p className="text-base font-bold">{open ? tr("⏰ Your test is ready!", "⏰ Aapka test taiyaar hai!") : tr("📅 Your test opens at 9:00 AM", "📅 Aapka test 9:00 AM par khulega")}</p>
              <p className="text-xs text-muted-foreground">{test.chapterCount} chapter · {test.pattern.totalQuestions} questions · {test.pattern.durationMinutes} min · har chapter me 95%+ chahiye</p>
            </div>
            {open ? (
              <a href={`/test?plantest=${test.id}`} className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground">{tr("Start test →", "Test shuru karein →")}</a>
            ) : (
              <div className="rounded-xl border border-border bg-background px-4 py-2 text-center font-mono text-lg font-bold">{fmt(left)}</div>
            )}
          </div>
        </div>
      )}
      {showRev && (
        <a href={`/test?plantest=${rev!.testId}`} className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/50 bg-amber-500/5 p-4">
          <div>
            <p className="text-sm font-bold">🔁 Aaj ka revision baaki hai</p>
            <p className="text-xs text-muted-foreground">{tr("50 questions · from your completed chapters · every day", "50 questions · aapke complete chapters se · roz zaroori")}</p>
          </div>
          <span className="shrink-0 rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white">{tr("Start →", "Shuru →")}</span>
        </a>
      )}
    </div>
  );
}
