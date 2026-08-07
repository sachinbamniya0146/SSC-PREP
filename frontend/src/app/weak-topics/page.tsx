"use client";

import * as React from "react";

type WeakTopic = {
  chapterId: string;
  chapterName: string;
  subjectName: string;
  total: number;
  correct: number;
  accuracyPercent: number;
  strengthScore: number;
  isWeak: boolean;
  action: { drillQuestions: number; testQuestions: number; message: string };
};

export default function WeakTopicsPage() {
  const [weak, setWeak] = React.useState<WeakTopic[]>([]);
  const [strong, setStrong] = React.useState<WeakTopic[]>([]);
  const [summary, setSummary] = React.useState<{
    chaptersAttempted: number;
    weakChapters: number;
    strongChapters: number;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [drill, setDrill] = React.useState<{
    chapterId: string;
    chapterName: string;
    drill: { id: string; q: string; opts: string[] }[];
    test: { id: string; q: string; opts: string[] }[];
  } | null>(null);

  const load = async () => {
    const token = localStorage.getItem("ssc_access_token");
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1"}/analytics/performance`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const d = await res.json();
        setWeak(d.weakTopics);
        setStrong(d.strongTopics);
        setSummary(d.summary);
      }
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDrill = async (t: WeakTopic) => {
    const token = localStorage.getItem("ssc_access_token");
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1"}/analytics/chapter/${t.chapterId}/drill`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok) {
      const d = await res.json();
      setDrill({ ...d, chapterName: t.chapterName });
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub
          </a>
          <a href="/dashboard" className="btn btn-outline text-sm">
            Back to Dashboard
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-bold">Your Performance Analysis 📊</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Chapter-wise weak / strong analysis from your tests. Strengthen weak topics with a
          25-question drill, then a 10-question test.
        </p>

        {loading && <p className="mt-8 text-muted-foreground">Analyzing your attempts…</p>}

        {!loading && summary && (
          <>
            {/* Summary cards */}
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <div className="card p-5">
                <p className="text-xs text-muted-foreground">Chapters Attempted</p>
                <p className="mt-1 text-3xl font-bold">{summary.chaptersAttempted}</p>
              </div>
              <div className="card border-danger/30 bg-danger/5 p-5">
                <p className="text-xs text-danger">Weak Chapters ⚠️</p>
                <p className="mt-1 text-3xl font-bold text-danger">{summary.weakChapters}</p>
              </div>
              <div className="card border-success/30 bg-success/5 p-5">
                <p className="text-xs text-success">Strong Chapters 💪</p>
                <p className="mt-1 text-3xl font-bold text-success">{summary.strongChapters}</p>
              </div>
            </div>

            {summary.chaptersAttempted === 0 && (
              <div className="card mt-10 p-8 text-center">
                <p className="text-lg font-semibold">No test attempts yet 📝</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Attempt your first chapter test or daily quiz — then come back here to see your
                  weak topics and personalized drill.
                </p>
              </div>
            )}

            {/* Weak topics with direct action */}
            {weak.length > 0 && !drill && (
              <div className="mt-8">
                <h2 className="text-lg font-semibold text-danger">
                  🔴 Your Weak Topics — Strengthen Them Now
                </h2>
                <div className="mt-3 space-y-3">
                  {weak.map((t) => (
                    <div key={t.chapterId} className="card border-danger/20 p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold">{t.chapterName}</p>
                          <p className="text-xs text-muted-foreground">
                            {t.subjectName} · {t.correct}/{t.total} correct ·{" "}
                            <span className="font-semibold text-danger">
                              {t.accuracyPercent}% accuracy
                            </span>
                          </p>
                        </div>
                        <button
                          onClick={() => startDrill(t)}
                          className="btn bg-primary text-primary-foreground hover:opacity-90"
                        >
                          🎯 Strengthen: {t.action.drillQuestions}Q drill → {t.action.testQuestions}Q test
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{t.action.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Strong topics */}
            {strong.length > 0 && (
              <div className="mt-10">
                <h2 className="text-lg font-semibold text-success">
                  💪 Your Strong Topics
                </h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {strong.map((t) => (
                    <div key={t.chapterId} className="card border-success/20 p-4">
                      <p className="font-semibold">{t.chapterName}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.accuracyPercent}% accuracy · {t.correct}/{t.total} correct
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Drill in progress */}
            {drill && (
              <div className="mt-8">
                <h2 className="text-lg font-semibold text-primary">
                  🎯 Strengthening: {drill.chapterName}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Practice {drill.drill.length} questions, then take the {drill.test.length}-question
                  test below.
                </p>

                <div className="mt-4">
                  <h3 className="font-semibold">Practice Drill ({drill.drill.length} Q)</h3>
                  <div className="mt-3 space-y-4">
                    {drill.drill.map((q, i) => (
                      <div key={q.id} className="card p-5">
                        <p className="text-sm font-medium">
                          {i + 1}. {q.q}
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {q.opts.map((o, oi) => (
                            <div key={oi} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                              {o}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6">
                  <h3 className="font-semibold">Chapter Test ({drill.test.length} Q)</h3>
                  <div className="mt-3 space-y-4">
                    {drill.test.map((q, i) => (
                      <div key={q.id} className="card border-primary/30 bg-primary/5 p-5">
                        <p className="text-sm font-medium">
                          {i + 1}. {q.q}
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {q.opts.map((o, oi) => (
                            <div key={oi} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                              {o}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => {
                    setDrill(null);
                    load();
                  }}
                  className="mt-6 btn btn-outline"
                >
                  ← Done, show my analysis again
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}