"use client";

import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";

type WeakPracticeData = {
  type: "WEAK_AREAS_PRACTICE";
  count: number;
  chapters: {
    chapterId: string;
    chapterName: string;
    subjectName: string;
    examName: string | null;
    wrongCount: number;
    skippedCount: number;
    totalErrors: number;
  }[];
  questions: {
    id: string;
    questionText: string;
    questionTextHindi?: string | null;
    options: { key: string; text: string; textHi?: string | null }[];
    chapter: string;
    examName?: string | null;
    year?: number | null;
    shift?: string | null;
    marks?: number;
    negativeMarks?: number;
    explanation?: string | null;
    explanationHindi?: string | null;
    subjectId?: string;
    _weakMeta?: { chapterId: string; chapterName: string; wasWrong: boolean; wasSkipped: boolean };
  }[];
  message?: string;
};

export default function WeakPracticePage() {
  const [data, setData] = React.useState<WeakPracticeData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [count, setCount] = React.useState(25);
  const [includeSkipped, setIncludeSkipped] = React.useState(true);

  const apiBase = () => API_BASE;

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetchAuth(
        `${apiBase()}/tests/weak-areas/practice?limit=${count}&includeSkipped=${includeSkipped}`,
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(`Failed: ${d.message || r.status}`);
        return;
      }
      const d = await r.json();
      setData(d);
    } catch {
      setError("Network error — backend unreachable");
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, includeSkipped]);

  const start = async () => {
    if (!data || data.questions.length === 0) return;
    setStarting(true);
    try {
      // Store the practice set in sessionStorage for the test page
      sessionStorage.setItem("ssc_sectional_set", JSON.stringify(data));
      // Store subject name for display
      sessionStorage.setItem("ssc_sectional_subject", "Weak Areas Practice");
      window.location.href = "/test?sectional=1";
    } catch {
      setError("Failed to start practice");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub
          </a>
          <a href="/dashboard" className="btn btn-outline text-sm">Dashboard</a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-bold">🎯 Weak Areas Practice</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Auto-generated practice from your wrong & skipped questions across all tests (v7 §NEW)
        </p>

        {loading && <p className="mt-8 text-muted-foreground">Analyzing your attempts…</p>}
        {error && <p className="card mt-8 p-6 text-center text-sm text-danger">{error}</p>}

        {!loading && !error && data && data.message && (
          <div className="card mt-8 p-6 text-center text-sm text-muted-foreground">
            {data.message}
          </div>
        )}

        {!loading && !error && data && data.questions.length > 0 && (
          <div className="card mt-6 space-y-5 p-6">
            {/* Weak Chapters Summary */}
            <div>
              <h2 className="font-semibold text-lg">Your Weak Chapters (from wrong/skipped answers)</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {data.chapters.length} chapters need attention — showing top {data.chapters.length}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.chapters.map((c) => (
                  <div
                    key={c.chapterId}
                    className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-left"
                  >
                    <p className="font-semibold text-destructive">{c.chapterName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{c.subjectName}</p>
                    {c.examName && (
                      <p className="mt-1 text-xs text-primary">{c.examName}</p>
                    )}
                    <div className="mt-2 flex items-center gap-4 text-xs">
                      <span className="text-destructive">✗ {c.wrongCount} wrong</span>
                      {c.skippedCount > 0 && (
                        <span className="text-warning">⊘ {c.skippedCount} skipped</span>
                      )}
                    </div>
                    <div className="mt-2 h-2 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-destructive"
                        style={{ width: `${Math.min(100, (c.totalErrors / 10) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Practice Settings */}
            <div className="border-t border-border pt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Questions per practice session</label>
                  <select
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  >
                    {[10, 25, 50, 100].map((c) => (
                      <option key={c} value={c}>
                        {c} questions
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeSkipped}
                      onChange={(e) => setIncludeSkipped(e.target.checked)}
                      className="h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
                    />
                    <span className="text-muted-foreground">Include skipped questions in weak analysis</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Start Button */}
            <button
              onClick={start}
              disabled={starting || data.questions.length === 0}
              className="btn w-full bg-primary py-3 text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {starting ? "Preparing…" : `🚀 Start Practice ({data.questions.length} Questions)`}
            </button>

            <p className="text-center text-xs text-muted-foreground">
              Practice will open in the test interface with bilingual questions. Correct answers + explanations shown
              after each question (practice mode).
            </p>
          </div>
        )}
      </main>
    </div>
  );
}