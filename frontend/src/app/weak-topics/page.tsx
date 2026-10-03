"use client";

// Student → My weak chapters / topics / sub-topics (rewritten Oct 3 2026)
//
// After ANY test (mock, PYQ, sectional, daily test, study-plan test, quiz) the questions you got
// wrong or skipped put their chapter › topic › sub-topic on this list. Pick one and strengthen it
// with a practice set. A topic leaves the weak list ONLY when you score the pass mark on its
// practice — until then it stays here and keeps being counted.
import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";

type Item = {
  id: string;
  status: "WEAK" | "STRENGTHENED";
  subjectId: string | null;
  subjectName: string;
  chapterId: string | null;
  chapterName: string;
  topicId: string | null;
  topicName: string;
  subTopicId: string | null;
  subTopicName: string;
  label: string;
  wrongCount: number;
  attemptedCount: number;
  practiceSetsDone: number;
  lastPracticeScore: number | null;
  available: number | null;
  strengthenedAt: string | null;
};
type Data = { passPercent: number; summary: { weakCount: number; strengthenedCount: number; chaptersAffected: number }; weak: Item[]; strengthened: Item[] };

export default function WeakTopicsPage() {
  const [data, setData] = React.useState<Data | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [starting, setStarting] = React.useState("");
  const [size, setSize] = React.useState(25);
  const [subjectFilter, setSubjectFilter] = React.useState("");

  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/bank/weak-topics`);
        if (r.ok) setData(await r.json());
        else setError("List load nahi hui. Dobara try karein.");
      } catch {
        setError("Network error.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const start = async (it: Item) => {
    setStarting(it.id);
    setError("");
    try {
      const r = await fetchAuth(`${API_BASE}/bank/practice/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterId: it.chapterId || undefined,
          topicId: it.topicId || undefined,
          subTopicId: it.subTopicId || undefined,
          size,
          mode: "practice",
          allowPyqFallback: true,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.code === "PREMIUM_REQUIRED" ? "Is topic ka free practice limit khatam — Premium lein." : `Start nahi hua: ${d.message || r.status}`);
        return;
      }
      sessionStorage.setItem("ssc_sectional_set", JSON.stringify(d));
      sessionStorage.setItem("ssc_sectional_subject", d.chapterName || it.label || "Weak topic practice");
      window.location.href = "/test?sectional=1";
    } catch {
      setError("Network error — practice start nahi hui.");
    } finally {
      setStarting("");
    }
  };

  const subjects = React.useMemo(() => {
    const m = new Map<string, string>();
    data?.weak.forEach((w) => w.subjectId && m.set(w.subjectId, w.subjectName));
    return [...m.entries()];
  }, [data]);

  const grouped = React.useMemo(() => {
    const out = new Map<string, { chapter: string; subject: string; items: Item[] }>();
    for (const w of data?.weak ?? []) {
      if (subjectFilter && w.subjectId !== subjectFilter) continue;
      const k = w.chapterId || "none";
      if (!out.has(k)) out.set(k, { chapter: w.chapterName || "General", subject: w.subjectName, items: [] });
      out.get(k)!.items.push(w);
    }
    return [...out.values()];
  }, [data, subjectFilter]);

  const pass = data?.passPercent ?? 60;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <a href="/dashboard" className="text-sm font-bold">← <span className="text-primary">SSC</span>PrepHub</a>
          <span className="text-sm font-bold">🎯 Meri weak list</span>
          <a href="/study-plan" className="text-xs font-semibold text-primary">Planner</a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-3 py-5">
        {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600">{error}</div>}
        {loading && <p className="py-10 text-center text-sm text-muted-foreground">Aapke tests check ho rahe hain…</p>}

        {!loading && data && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3"><p className="text-2xl font-extrabold text-red-600">{data.summary.weakCount}</p><p className="text-[11px] text-muted-foreground">Weak topics</p></div>
              <div className="rounded-xl border border-border bg-card p-3"><p className="text-2xl font-extrabold">{data.summary.chaptersAffected}</p><p className="text-[11px] text-muted-foreground">Chapters</p></div>
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3"><p className="text-2xl font-extrabold text-emerald-600">{data.summary.strengthenedCount}</p><p className="text-[11px] text-muted-foreground">Strong ho gaye</p></div>
            </div>

            <div className="rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
              💡 Topic tab tak <b>weak</b> rehta hai jab tak aap uski practice me <b>{pass}%+</b> score nahi laate. Kisi bhi test me galat hone par wo wapas yahan aa jata hai.
            </div>

            {data.weak.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-8 text-center">
                <p className="text-lg font-semibold">Koi weak topic nahi 🎉</p>
                <p className="mt-2 text-sm text-muted-foreground">Mock, PYQ ya sectional test dein — galat hue topics yahan aa jayenge.</p>
                <a href="/mocks" className="btn btn-primary mt-4 inline-block">Test dein</a>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-2 text-sm">
                    <option value="">Saare subjects</option>
                    {subjects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                  <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="rounded-lg border border-border bg-background px-2 py-2 text-sm">
                    {[15, 25, 35, 50].map((n) => <option key={n} value={n}>{n} questions</option>)}
                  </select>
                </div>

                {grouped.map((g) => (
                  <section key={g.chapter + g.subject} className="rounded-xl border border-border bg-card p-3">
                    <p className="text-xs font-semibold text-muted-foreground">{g.subject}</p>
                    <h2 className="mb-2 text-base font-bold">{g.chapter}</h2>
                    <ul className="space-y-2">
                      {g.items.map((w) => {
                        const label = [w.topicName, w.subTopicName].filter(Boolean).join(" › ") || "Poora chapter";
                        const score = w.lastPracticeScore;
                        return (
                          <li key={w.id} className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="break-words text-sm font-semibold">{label}</p>
                                <p className="mt-0.5 text-[11px] text-muted-foreground">❌ {w.wrongCount} galat/skip · {w.practiceSetsDone} practice set{score != null ? ` · last score ${score}%` : ""}</p>
                              </div>
                              <button onClick={() => start(w)} disabled={starting === w.id || w.available === 0} className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50">
                                {w.available === 0 ? "Questions jald" : starting === w.id ? "Shuru ho raha…" : "💪 Strong karein"}
                              </button>
                            </div>
                            <div className="mt-2">
                              <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                                <div className={`h-full ${score != null && score >= pass ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${Math.min(100, score ?? 0)}%` }} />
                                <div className="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: `${pass}%` }} />
                              </div>
                              <p className="mt-1 text-[10px] text-muted-foreground">Pass mark {pass}% · {w.available != null ? `${w.available} questions available` : ""}</p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </>
            )}

            {data.strengthened.length > 0 && (
              <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                <h2 className="mb-2 text-sm font-bold text-emerald-700">✅ Strong ho gaye ({data.strengthened.length})</h2>
                <ul className="space-y-1 text-xs">
                  {data.strengthened.map((s) => <li key={s.id} className="break-words">{s.label || s.chapterName}{s.lastPracticeScore != null ? ` — ${s.lastPracticeScore}%` : ""}</li>)}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
