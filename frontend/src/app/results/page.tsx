"use client";
import { fetchAuth } from "@/lib/api";

import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";

type AttemptSummary = {
  id: string;
  score: number;
  totalCorrect: number;
  totalWrong: number;
  totalSkipped: number;
  accuracyPercent: number;
  submittedAt: string;
  testTemplate: { id: string; title: string; totalQuestions: number; totalMarks: number };
  _count?: { answers: number };
};

export default function ResultsPage() {
  const [attempts, setAttempts] = React.useState<AttemptSummary[]>([]);
  const [stats, setStats] = React.useState<{ totalAttempts: number; bestScore: number; bestAccuracy: number } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const apiBase = () => API_BASE;
  const authHeaders = (): Record<string, string> => {
    const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetchAuth(`${apiBase()}/tests/attempts`, { headers: authHeaders() });
        if (!r.ok) {
          setError(r.status === 401 ? "Login required" : "Failed to load history");
          return;
        }
        const d = await r.json();
        setAttempts(d.attempts || []);
        setStats(d.stats || null);
      } catch {
        setError("Network error — backend unreachable");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub
          </a>
          <a href="/test" className="btn btn-outline text-sm">Take a Test</a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-bold">📊 Results History</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your past test attempts & scores</p>

        {stats && (
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="card p-5">
              <p className="text-xs text-muted-foreground">Total Attempts</p>
              <p className="mt-1 text-3xl font-bold">{stats.totalAttempts}</p>
            </div>
            <div className="card p-5">
              <p className="text-xs text-muted-foreground">Best Score</p>
              <p className="mt-1 text-3xl font-bold">{stats.bestScore}</p>
            </div>
            <div className="card p-5">
              <p className="text-xs text-muted-foreground">Best Accuracy</p>
              <p className="mt-1 text-3xl font-bold">{stats.bestAccuracy}%</p>
            </div>
          </div>
        )}

        {loading && <p className="mt-8 text-muted-foreground">Loading history…</p>}
        {error && <p className="card mt-8 p-6 text-center text-sm text-danger">{error}</p>}

        {!loading && !error && (
          <div className="mt-6 space-y-4">
            {attempts.length === 0 && (
              <p className="card p-8 text-center text-sm text-muted-foreground">
                No attempts yet — take your first test to see results here! 🎯
              </p>
            )}
            {attempts.map((a) => (
              <div key={a.id} className="card flex flex-wrap items-center justify-between gap-3 p-5">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{a.testTemplate?.title || "Mock Test"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {fmt(a.submittedAt)} · {a.testTemplate?.totalQuestions ?? a._count?.answers ?? "—"} questions ·{" "}
                    {a.testTemplate?.totalMarks ?? "—"} marks
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-success/15 px-3 py-1 font-semibold text-success">
                      ✅ {a.totalCorrect} correct
                    </span>
                    <span className="rounded-full bg-danger/15 px-3 py-1 font-semibold text-danger">
                      ❌ {a.totalWrong} wrong
                    </span>
                    <span className="rounded-full bg-muted px-3 py-1 font-semibold text-muted-foreground">
                      ⏭️ {a.totalSkipped} skipped
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-primary">{a.score}</p>
                  <p className="text-xs text-muted-foreground">score · {a.accuracyPercent}% acc</p>
                  <a
                    href={`/results/${a.id}`}
                    className="mt-2 inline-block rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
                  >
                    Review →
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
