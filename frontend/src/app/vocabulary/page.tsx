"use client";

// Vocabulary Mastery hub (NEW — Sep 2026)
//
// "jesa PYQ ka scene hai same vesa hi" — a chapter-grid-style landing page
// for the word-by-word mastery track: every word as a card (locked / can
// study+quiz / mastered), a daily-goal setter, and a "Aaj ka Plan" widget
// (today's new word, revision words, what's coming up next).
import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";

type WordCard = {
  id: string;
  slug: string;
  word: string;
  orderIndex: number;
  meaningHindi: string;
  state: "LOCKED" | "UNLOCKED" | "MASTERED";
  bestScorePct: number;
  attemptsCount: number;
  needsRevision: boolean;
};

type TodaysPlan = {
  wordsPerDay: number;
  masteredToday: number;
  newWordsToday: { slug: string; word: string; meaningHindi: string; state: string; bestScorePct: number }[];
  comingUp: { slug: string; word: string; meaningHindi: string; state: string; bestScorePct: number }[];
  revisionToday: { slug: string; word: string; meaningHindi: string; state: string; bestScorePct: number }[];
  totalMastered: number;
  totalWords: number;
};

export default function VocabularyHubPage() {
  const [words, setWords] = React.useState<WordCard[]>([]);
  const [totalWords, setTotalWords] = React.useState(0);
  const [masteredCount, setMasteredCount] = React.useState(0);
  const [plan, setPlan] = React.useState<TodaysPlan | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [goalDraft, setGoalDraft] = React.useState(1);
  const [savingGoal, setSavingGoal] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [wordsRes, planRes] = await Promise.all([
        fetchAuth(`${API_BASE}/vocab/words`),
        fetchAuth(`${API_BASE}/vocab/today`),
      ]);
      if (!wordsRes.ok || !planRes.ok) throw new Error("Load failed");
      const wd = await wordsRes.json();
      const pd = await planRes.json();
      setWords(wd.words || []);
      setTotalWords(wd.totalWords || 0);
      setMasteredCount(wd.masteredCount || 0);
      setPlan(pd);
      setGoalDraft(pd.wordsPerDay || 1);
    } catch {
      setError("Load nahi ho paya — dobara try karein.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const saveGoal = async () => {
    setSavingGoal(true);
    try {
      const r = await fetchAuth(`${API_BASE}/vocab/daily-goal`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordsPerDay: goalDraft }),
      });
      if (r.ok) await load();
    } finally {
      setSavingGoal(false);
    }
  };

  const stateStyle = (s: WordCard["state"]) =>
    s === "MASTERED"
      ? "border-emerald-500/40 bg-emerald-500/5"
      : s === "UNLOCKED"
        ? "border-primary/40 bg-primary/5"
        : "border-border bg-muted/20 opacity-70";

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto max-w-5xl px-4 py-10 text-center text-muted-foreground">Loading…</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">← <span className="text-primary">SSC</span>PrepHub</a>
          <a href="/dashboard" className="btn btn-outline text-sm">Dashboard</a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">📖 Vocabulary Mastery</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ek word padhein, phir usi word ka quiz dein — 95%+ score par hi agla word khulta hai.
        </p>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        {/* Progress bar */}
        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">{masteredCount} / {totalWords} words mastered</span>
            <span className="text-muted-foreground">{totalWords ? Math.round((masteredCount / totalWords) * 100) : 0}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${totalWords ? (masteredCount / totalWords) * 100 : 0}%` }} />
          </div>
        </div>

        {/* Daily goal */}
        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <h2 className="font-semibold text-sm">🎯 Daily Goal</h2>
          <p className="mt-1 text-xs text-muted-foreground">Aap roz kitne naye words seekhna chahte hain?</p>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={10}
              value={goalDraft}
              onChange={(e) => setGoalDraft(Number(e.target.value))}
              className="w-20 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
            />
            <span className="text-sm text-muted-foreground">words / day</span>
            <button
              onClick={saveGoal}
              disabled={savingGoal}
              className="ml-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>

        {/* Today's plan */}
        {plan && (plan.newWordsToday.length > 0 || plan.revisionToday.length > 0) && (
          <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <h2 className="font-semibold text-sm">📅 Aaj ka Plan</h2>
            {plan.newWordsToday.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-semibold text-muted-foreground">Naya word:</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {plan.newWordsToday.map((w) => (
                    <a key={w.slug} href={`/vocabulary/${w.slug}`} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                      {w.word} →
                    </a>
                  ))}
                </div>
              </div>
            )}
            {plan.revisionToday.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">🔥 Revise karein (pichli baar kuch galat hue the):</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {plan.revisionToday.map((w) => (
                    <a key={w.slug} href={`/vocabulary/${w.slug}/quiz`} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      {w.word}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Word grid */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {words.map((w) => (
            <a
              key={w.id}
              href={w.state === "LOCKED" ? undefined : `/vocabulary/${w.slug}`}
              className={`rounded-xl border p-4 transition ${stateStyle(w.state)} ${w.state === "LOCKED" ? "cursor-not-allowed" : "hover:border-primary"}`}
              onClick={(e) => {
                if (w.state === "LOCKED") e.preventDefault();
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">#{w.orderIndex}</span>
                {w.state === "MASTERED" && <span className="text-xs">✅</span>}
                {w.state === "LOCKED" && <span className="text-xs">🔒</span>}
                {w.needsRevision && <span className="text-xs" title="Revision chahiye">🔥</span>}
              </div>
              <h3 className="mt-1 font-bold">{w.state === "LOCKED" ? "?????" : w.word}</h3>
              {w.state !== "LOCKED" && <p className="mt-0.5 truncate text-xs text-muted-foreground">{w.meaningHindi}</p>}
              {w.attemptsCount > 0 && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">Best: {w.bestScorePct}%</p>
              )}
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}
