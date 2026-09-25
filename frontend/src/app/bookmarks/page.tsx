"use client";
import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";

type Bm = {
  bookmarkedAt: string;
  question: {
    id: string;
    questionText: string;
    questionTextHindi: string | null;
    options: { key: string; text: string }[];
    // Backend only fills these in once you've actually attempted the
    // question elsewhere (mock/sectional/daily-test/practice) — null until
    // then, so bookmarking alone can never reveal the answer key.
    correctAnswer: string | null;
    explanation: string | null;
    attempted: boolean;
    examName?: string;
    subject: string | null;
    year?: number | null;
    shift?: string | null;
  };
  note?: string | null;
  noteUpdatedAt?: string | null;
};

const apiBase = () => API_BASE;
const authHeaders = (): Record<string, string> => {
  const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = React.useState<Bm[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  // NEW — inline note editor per bookmarked question, + "Practice my
  // bookmarks" (builds a real practice set from GET /bookmarks/practice-set
  // and hands off to /test the same way every other practice flow does).
  const [editingNoteId, setEditingNoteId] = React.useState("");
  const [noteDraft, setNoteDraft] = React.useState("");
  const [noteBusyId, setNoteBusyId] = React.useState("");
  const [startingPractice, setStartingPractice] = React.useState(false);
  const [practiceError, setPracticeError] = React.useState("");

  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetchAuth(`${apiBase()}/bookmarks`, { headers: authHeaders() });
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
    const r = await fetchAuth(`${apiBase()}/bookmarks/${id}/toggle`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (r.ok) setBookmarks((prev) => prev.filter((b) => b.question.id !== id));
  };

  const startEditNote = (b: Bm) => {
    setEditingNoteId(b.question.id);
    setNoteDraft(b.note || "");
  };

  const saveNote = async (questionId: string) => {
    const text = noteDraft.trim();
    setNoteBusyId(questionId);
    try {
      if (!text) {
        await fetchAuth(`${apiBase()}/bookmarks/${questionId}/note`, { method: "DELETE", headers: authHeaders() });
        setBookmarks((prev) => prev.map((b) => (b.question.id === questionId ? { ...b, note: null } : b)));
      } else {
        const r = await fetchAuth(`${apiBase()}/bookmarks/${questionId}/note`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
        });
        if (r.ok) {
          setBookmarks((prev) => prev.map((b) => (b.question.id === questionId ? { ...b, note: text } : b)));
        }
      }
      setEditingNoteId("");
    } finally {
      setNoteBusyId("");
    }
  };

  const practiceBookmarks = async () => {
    setStartingPractice(true);
    setPracticeError("");
    try {
      const r = await fetchAuth(`${apiBase()}/bookmarks/practice-set`, { headers: authHeaders() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setPracticeError(d?.message || "Practice set nahi ban paya");
        return;
      }
      sessionStorage.setItem("ssc_sectional_set", JSON.stringify(d));
      sessionStorage.setItem("ssc_sectional_subject", "🔖 My Bookmarks");
      window.location.href = "/test?sectional=1";
    } catch {
      setPracticeError("Network error");
    } finally {
      setStartingPractice(false);
    }
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">🔖 My Bookmarks</h1>
            <p className="mt-1 text-sm text-muted-foreground">Questions you saved for revision ({bookmarks.length})</p>
          </div>
          {bookmarks.length > 0 && (
            <button
              onClick={practiceBookmarks}
              disabled={startingPractice}
              className="btn bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {startingPractice ? "Starting…" : "🚀 Practice my bookmarks"}
            </button>
          )}
        </div>
        {practiceError && <p className="mt-2 text-sm text-danger">{practiceError}</p>}

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
                        b.question.attempted && o.key === b.question.correctAnswer
                          ? "border-success bg-success/10"
                          : "border-border"
                      }`}
                    >
                      <span className="font-bold">{o.key}.</span>
                      <span>{o.text}</span>
                      {b.question.attempted && o.key === b.question.correctAnswer && (
                        <span className="ml-auto text-xs font-bold text-success">✓ Answer</span>
                      )}
                    </div>
                  ))}
                </div>
                {b.question.attempted ? (
                  b.question.explanation && (
                    <p className="mt-3 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
                      💡 {b.question.explanation}
                    </p>
                  )
                ) : (
                  <p className="mt-3 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
                    🔒 Attempt this question in a test or practice set to reveal the answer & explanation here.
                  </p>
                )}

                {/* NEW — personal note per question (memory tricks, why I got
                    it wrong, anything). Stored via UserNote, private to this
                    student. */}
                {editingNoteId === b.question.id ? (
                  <div className="mt-3">
                    <textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      rows={3}
                      placeholder="Apna note likhein (yaad rakhne ki trick, galti ki wajah, etc.)"
                      className="w-full rounded-lg border border-border bg-background p-2 text-sm"
                    />
                    <div className="mt-1.5 flex gap-2">
                      <button
                        onClick={() => saveNote(b.question.id)}
                        disabled={noteBusyId === b.question.id}
                        className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button onClick={() => setEditingNoteId("")} className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-muted">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : b.note ? (
                  <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <p className="text-xs text-foreground">📝 {b.note}</p>
                    <button onClick={() => startEditNote(b)} className="mt-1 text-[11px] font-semibold text-primary hover:underline">
                      Edit note
                    </button>
                  </div>
                ) : (
                  <button onClick={() => startEditNote(b)} className="mt-3 text-xs font-semibold text-primary hover:underline">
                    ＋ Add a note
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
