import { fetchAuth } from "@/lib/api";
"use client";

import * as React from "react";

type Subject = { id: string; name: string; slug: string; questionCount: number };

export default function SectionalPage() {
  const [subjects, setSubjects] = React.useState<Subject[]>([]);
  const [selected, setSelected] = React.useState<string>("");
  const [count, setCount] = React.useState(25);
  const [loading, setLoading] = React.useState(true);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState("");

  const apiBase = () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
  const authHeaders = (): Record<string, string> => {
    const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetchAuth(`${apiBase()}/tests/sectional/subjects`, { headers: authHeaders() });
        if (!r.ok) {
          setError(r.status === 401 ? "Login required" : "Failed to load subjects");
          return;
        }
        const d = await r.json();
        const list = (Array.isArray(d) ? d : d.subjects || []).filter((s: Subject) => s.questionCount > 0);
        setSubjects(list);
        if (list.length > 0) setSelected(list[0].id);
      } catch {
        setError("Network error — backend unreachable");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    if (!selected) return;
    setStarting(true);
    try {
      // fetch the composed set to validate (and keep it cached for the test page)
      const r = await fetchAuth(`${apiBase()}/tests/sectional?subjectId=${selected}&count=${count}`, {
        headers: authHeaders(),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(`Failed: ${d.message || r.status}`);
        return;
      }
      const d = await r.json();
      sessionStorage.setItem("ssc_sectional_set", JSON.stringify(d));
      // stash subject name for display
      const subj = subjects.find((s) => s.id === selected);
      sessionStorage.setItem("ssc_sectional_subject", subj?.name || "");
      window.location.href = "/test?sectional=1";
    } catch {
      setError("Network error while composing test");
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
          <a href="/mocks" className="btn btn-outline text-sm">Mock Tests</a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-bold">📚 Sectional Tests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Subject-wise practice — questions pulled from multiple years (v6 §2c)
        </p>

        {loading && <p className="mt-8 text-muted-foreground">Loading subjects…</p>}
        {error && <p className="card mt-8 p-6 text-center text-sm text-danger">{error}</p>}

        {!loading && !error && (
          <div className="card mt-6 max-w-2xl space-y-5 p-6">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Choose Subject *</label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {subjects.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelected(s.id)}
                    className={`rounded-xl border p-4 text-left transition ${
                      selected === s.id
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:border-primary/50"
                    }`}
                  >
                    <p className="font-semibold">{s.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {s.questionCount.toLocaleString()} bilingual questions
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground">Questions per test</label>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                {[10, 25, 50, 100].map((c) => (
                  <option key={c} value={c}>{c} questions</option>
                ))}
              </select>
            </div>

            <button
              onClick={start}
              disabled={!selected || starting}
              className="btn w-full bg-primary py-3 text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {starting ? "Composing…" : "🚀 Start Sectional Test"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
