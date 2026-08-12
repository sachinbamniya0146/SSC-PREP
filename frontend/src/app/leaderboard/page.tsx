"use client";

import * as React from "react";

type Row = { id: string; fullName: string; xp: number; currentStreak: number; longestStreak: number; coins: number; rank: number; isMe?: boolean };
type LB = { period: string; rows: Row[]; myRank: number | null; me: Row | null };

const apiBase = () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
const authHeaders = (): Record<string, string> => {
  const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export default function LeaderboardPage() {
  const [data, setData] = React.useState<LB | null>(null);
  const [period, setPeriod] = React.useState<"all" | "weekly">("all");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`${apiBase()}/gamification/leaderboard?period=${period}`, { headers: authHeaders() });
        if (!r.ok) {
          setError(r.status === 401 ? "Login required" : `Failed to load (${r.status})`);
          return;
        }
        setData(await r.json());
      } catch {
        setError("Network error — backend unreachable");
      } finally {
        setLoading(false);
      }
    })();
  }, [period]);

  const medal = (rank: number) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}`);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">← <span className="text-primary">SSC</span>PrepHub</a>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPeriod("all")}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${period === "all" ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}
            >
              All-time
            </button>
            <button
              onClick={() => setPeriod("weekly")}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${period === "weekly" ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}
            >
              This Week
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">🏆 Leaderboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Top scorers by XP — attempt tests & daily quizzes to climb!</p>

        {data?.me && (
          <div className="mt-6 flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/5 p-5">
            <div>
              <p className="text-xs text-muted-foreground">Your rank</p>
              <p className="text-3xl font-bold text-primary">#{data.myRank ?? "—"}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">XP</p>
              <p className="text-2xl font-bold">{data.me.xp}</p>
              <p className="mt-1 text-xs text-muted-foreground">🔥 {data.me.currentStreak} day streak</p>
            </div>
          </div>
        )}

        {loading && <p className="mt-8 text-muted-foreground">Loading leaderboard…</p>}
        {error && <p className="card mt-8 p-6 text-center text-sm text-danger">{error}</p>}

        {!loading && !error && (
          <div className="mt-4 space-y-2">
            {data?.rows.map((row) => (
              <div
                key={row.id}
                className={`flex items-center gap-4 rounded-xl border p-4 ${row.isMe ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}
              >
                <span className="w-10 text-center text-lg font-bold">{medal(row.rank)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {row.fullName}
                    {row.isMe && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">You</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">🔥 {row.currentStreak}-day streak · 🪙 {row.coins}</p>
                </div>
                <span className="text-lg font-bold text-primary">{row.xp} XP</span>
              </div>
            ))}
            {data && data.rows.length === 0 && (
              <p className="card p-8 text-center text-sm text-muted-foreground">No scores yet — take a test to get on the board!</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
