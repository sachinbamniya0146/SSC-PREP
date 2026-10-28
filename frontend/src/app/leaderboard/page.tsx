"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { useFeatures, FeatureOff } from "@/lib/features";
import { INDIAN_STATES } from "@/lib/states";
import { Skeleton } from "@/components/Skeleton";
import { useT } from "@/lib/i18n";

type Row = { id: string; fullName: string; xp: number; currentStreak: number; longestStreak: number; coins: number; rank: number; state?: string | null; isMe?: boolean };
type LB = { period: string; scope: "india" | "state"; state: string | null; needState: boolean; rows: Row[]; myRank: number | null; me: Row | null };

export default function LeaderboardPage() {
  const tr = useT();
  const { on, loaded } = useFeatures();
  const [data, setData] = React.useState<LB | null>(null);
  const [period, setPeriod] = React.useState<"all" | "weekly">("all");
  const [scope, setScope] = React.useState<"india" | "state">("india");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [pick, setPick] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const reqId = React.useRef(0);

  React.useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    setError("");
    api<LB>(`/gamification/leaderboard?period=${period}&scope=${scope}`)
      .then((d) => id === reqId.current && setData(d))
      .catch((e) => id === reqId.current && setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => id === reqId.current && setLoading(false));
  }, [period, scope, reload]);

  const saveState = async () => {
    if (!pick) return;
    setSaving(true);
    try {
      await api("/users/me/profile", { method: "PUT", body: JSON.stringify({ state: pick }) });
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your state");
    } finally {
      setSaving(false);
    }
  };

  if (loaded && !on("leaderboard")) {
    return <FeatureOff title={tr("Leaderboard is paused", "Leaderboard abhi band hai")} />;
  }

  const medal = (rank: number) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}`);
  const stateOn = on("stateRank");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-lg">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
          <a href="/dashboard" className="text-lg font-bold">← <span className="text-primary">SSC</span>PrepHub</a>
          <div className="flex items-center gap-2">
            {(["all", "weekly"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${period === p ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted"}`}
              >
                {p === "all" ? tr("All-time", "All-time") : tr("This Week", "Is hafte")}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">🏆 {tr("Leaderboard", "Leaderboard")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{tr("Top scorers by XP - attempt tests & daily quizzes to climb!", "XP ke hisaab se top students - tests aur daily quiz karke upar chadho!")}</p>
          </div>
          {stateOn && (
            <div className="inline-flex rounded-full border border-border p-0.5 text-xs font-semibold">
              {(["india", "state"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setScope(k)}
                  className={`rounded-full px-4 py-1.5 transition ${scope === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {k === "india" ? tr("All India", "All India") : tr("My state", "Mera state")}
                </button>
              ))}
            </div>
          )}
        </div>

        {data?.needState && scope === "state" && (
          <div className="mt-6 rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-5">
            <p className="text-sm font-semibold">{tr("Choose your state to see the state leaderboard", "State leaderboard dekhne ke liye apna state chuno")}</p>
            <div className="mt-3 flex gap-2">
              <select value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1 border bg-background px-3 py-2 text-sm" aria-label="State">
                <option value="">{tr("Select state", "State chuno")}</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button onClick={saveState} disabled={!pick || saving} className="btn btn-primary">{saving ? "…" : tr("Save", "Save")}</button>
            </div>
          </div>
        )}

        {data?.me && !data.needState && (
          <div className="mt-6 flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/5 p-5">
            <div>
              <p className="text-xs text-muted-foreground">{scope === "state" && data.state ? `${tr("Rank in", "Rank")} ${data.state}` : tr("Your rank", "Aapki rank")}</p>
              <p className="text-3xl font-bold text-primary">#{data.myRank ?? "—"}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">XP</p>
              <p className="text-2xl font-bold">{data.me.xp}</p>
              <p className="mt-1 text-xs text-muted-foreground">🔥 {data.me.currentStreak} {tr("day streak", "din ki streak")}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="card mt-6 flex items-center justify-between gap-3 p-4 text-sm text-danger">
            <span>{error}</span>
            <button onClick={() => setReload((n) => n + 1)} className="btn btn-outline btn-sm">{tr("Retry", "Dobara")}</button>
          </div>
        )}

        {loading && !data ? (
          <div className="mt-4 space-y-2" role="status" aria-label="Loading">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : (
          !error &&
          !(data?.needState && scope === "state") && (
            <div className={`mt-4 space-y-2 transition-opacity ${loading ? "opacity-50" : ""}`}>
              {data?.rows.map((row) => (
                <div
                  key={row.id}
                  className={`flex items-center gap-4 rounded-xl border p-4 ${row.isMe ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}
                >
                  <span className="w-10 text-center text-lg font-bold">{medal(row.rank)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {row.fullName}
                      {row.isMe && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">{tr("You", "Aap")}</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      🔥 {row.currentStreak}-{tr("day streak", "din")} · 🪙 {row.coins}
                      {scope === "india" && row.state ? ` · ${row.state}` : ""}
                    </p>
                  </div>
                  <span className="text-lg font-bold text-primary">{row.xp} XP</span>
                </div>
              ))}
              {data && data.rows.length === 0 && (
                <p className="card p-8 text-center text-sm text-muted-foreground">{tr("No scores yet - take a test to get on the board!", "Abhi koi score nahi - test dekar board par aao!")}</p>
              )}
            </div>
          )
        )}
      </main>
    </div>
  );
}
