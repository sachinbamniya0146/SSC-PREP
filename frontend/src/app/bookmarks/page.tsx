"use client";

import * as React from "react";

type Bm = {
  bookmarkedAt: string;
  question: {
    id: string;
    questionText: string;
    questionTextHindi: string | null;
    options: { key: string; text: string }[];
    correctAnswer: string;
    explanation: string | null;
    examName?: string;
    subject: string | null;
    year?: number | null;
    shift?: string | null;
  };
};

const apiBase = () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
const authHeaders = (): Record<string, string> => {
  const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = React.useState<Bm[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${apiBase()}/bookmarks`, { headers: authHeaders() });
        if (!r.ok) {
          setError(r.status === 401 ? "Login required" : "Failed to load bookmarks");
          return;
        }
        const d = await r.json();
        setBookmarks(d.bookmarks || []);
      } catch {
        setError("Network error — backend unreachable");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const remove = async (id: string) => {
    const r = await fetch(`${apiBase()}/bookmarks/${id}/toggle`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (r.ok) setBookmarks((prev) => prev.filter((b) => b.question.id !== id));
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">← <span className="text-primary">SSC</span>PrepHub</a>
          <a href="/question-bank" className="btn border border-border px-4 py-1.5 text-sm hover:bg-muted">Browse Bank</a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-bold">🔖 My Bookmarks</h1>
        <p className="mt-1 text-sm text-muted-foreground">Questions you saved for revision ({bookmarks.length})</p>

        {loading && <p className="mt-8 text-muted-foreground">Loading…</p>}
        {error && <p className="card mt-8 p-6 text-center text-sm text-danger">{error}</p>}

        {!loading && !error && (
          <div className="mt-6 space-y-4">
            {bookmarks.length === 0 && (
              <p className="card p-8 text-center text-sm text-muted-foreground">
                No bookmarks yet — browse the question bank and save questions! 🔖
              </p>
            )}
            {bookmarks.map((b) => (
              <div key={b.question.id} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {b.question.examName || "SSC"} {b.question.year || ""} {b.question.shift ? `· ${b.question.shift} shift` : ""}
                    {b.question.subject ? ` · ${b.question.subject}` : ""}
                  </p>
                  <button
                    onClick={() => remove(b.question.id)}
                    className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-danger/10 hover:text-danger"
                  >
                    ✕ Remove
                  </button>
                </div>
                <p className="mt-2 text-sm leading-relaxed">
                  {b.question.questionText}
                  {b.question.questionTextHindi ? ` / ${b.question.questionTextHindi}` : ""}
                </p>
                <div className="mt-3 space-y-1.5">
                  {b.question.options.map((o) => (
                    <div
                      key={o.key}
                      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                        o.key === b.question.correctAnswer ? "border-success bg-success/10" : "border-border"
                      }`}
                    >
                      <span className="font-bold">{o.key}.</span>
                      <span>{o.text}</span>
                      {o.key === b.question.correctAnswer && <span className="ml-auto text-xs font-bold text-success">✓ Answer</span>}
                    </div>
                  ))}
                </div>
                {b.question.explanation && (
                  <p className="mt-3 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
                    💡 {b.question.explanation}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
