"use client";

// Vocabulary Daily Revision (NEW — Sep 29 2026)
//
// A student who unlocked N words revises them every day: 2 questions per word,
// timed. Wrong words must be re-scored 95%+ before new words unlock. The day
// can be skipped for an escalating fee (Rs 1, 5, 10 ...) — the test is then due
// again tomorrow. All amounts + messages come from the server (both languages).
import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";
import { startCashfreeCheckout, type BiMsg } from "@/lib/vocab-pay";
import BiMessage from "@/components/BiMessage";

type Status = {
  due: boolean;
  doneToday: "COMPLETED" | "SKIPPED" | null;
  poolSize: number;
  wordsInTest: number;
  questionsInTest: number;
  timeLimitSec: number;
  inProgressSessionId: string | null;
  skipFeeInr: number;
  nextSkipFeeInr: number;
  skipStreak: number;
  remaster: { slug: string; word: string }[];
  messages: { pending: BiMsg | null; skipWarning: BiMsg; remaster: BiMsg | null; nothingToRevise: BiMsg | null; alreadyDone: BiMsg | null };
};
type Q = { id: string; questionText: string; options: { key: string; text: string }[] };
type Session = { sessionId: string; timeLimitSec: number; totalQuestions: number; questions: Q[] };
type Review = { id: string; questionText: string; options: { key: string; text: string }[]; givenAnswer: string | null; correctAnswer: string; isCorrect: boolean; explanation?: string | null };
type Result = { scorePct: number; correct: number; wrong: number; total: number; wrongWords: { slug: string; word: string }[]; allClear: boolean; messages: { summary: BiMsg }; review: Review[] };

const fmt = (s: number) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, "0")}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

export default function VocabRevisionPage() {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [session, setSession] = React.useState<Session | null>(null);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [idx, setIdx] = React.useState(0);
  const [result, setResult] = React.useState<Result | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [confirmSkip, setConfirmSkip] = React.useState(false);
  const [remaining, setRemaining] = React.useState(0);
  const deadlineRef = React.useRef(0);
  const submittedRef = React.useRef(false);

  const loadStatus = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchAuth(`${API_BASE}/vocab/revision/status`);
      if (!r.ok) throw new Error("Load failed");
      setStatus(await r.json());
    } catch {
      setError("Status load nahi ho paya.");
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetchAuth(`${API_BASE}/vocab/revision/start`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.message || "Start nahi hua");
      submittedRef.current = false;
      deadlineRef.current = Date.now() + d.timeLimitSec * 1000;
      setRemaining(d.timeLimitSec);
      setAnswers({});
      setIdx(0);
      setSession(d);
    } catch (e: any) {
      setError(e.message || "Start failed");
    } finally {
      setBusy(false);
    }
  };

  const submit = React.useCallback(async () => {
    if (!session || submittedRef.current) return;
    submittedRef.current = true;
    setBusy(true);
    try {
      const r = await fetchAuth(`${API_BASE}/vocab/revision/${session.sessionId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.messages?.en || d?.message || "Submit fail hua");
      setResult(d);
      setSession(null);
    } catch (e: any) {
      setError(e.message || "Submit failed");
      setSession(null);
      loadStatus();
    } finally {
      setBusy(false);
    }
  }, [session, answers, loadStatus]);

  // Countdown from a wall-clock deadline (immune to tab throttling) + auto-submit at 0.
  React.useEffect(() => {
    if (!session) return;
    const t = setInterval(() => {
      const left = Math.round((deadlineRef.current - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0) submit();
    }, 500);
    return () => clearInterval(t);
  }, [session, submit]);

  const paySkip = async () => {
    setBusy(true);
    setError("");
    try {
      await startCashfreeCheckout({ vocabRevisionSkip: true });
    } catch (e: any) {
      setError(e.message || "Payment start nahi hua");
      setBusy(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <a href="/vocabulary" className="text-sm font-semibold">← Vocabulary</a>
          <span className="text-sm font-bold">🔁 Daily Revision</span>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-8">{children}</main>
    </div>
  );

  if (loading) return shell(<p className="text-center text-muted-foreground">Loading…</p>);

  // ---------------------------------------------------------------- running
  if (session) {
    const q = session.questions[idx];
    const answered = Object.keys(answers).length;
    return shell(
      <>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Q {idx + 1}/{session.questions.length} · {answered} answered</span>
          <span className={`rounded-lg px-3 py-1 font-mono text-sm font-bold ${remaining <= 60 ? "bg-red-500/10 text-red-600" : "bg-primary/10 text-primary"}`}>⏳ {fmt(remaining)}</span>
        </div>
        <div className="mt-4 rounded-xl border border-border bg-card p-5">
          <p className="font-semibold">{q.questionText}</p>
          <div className="mt-4 space-y-2">
            {q.options.map((o) => (
              <button
                key={o.key}
                onClick={() => setAnswers((a) => ({ ...a, [q.id]: o.key }))}
                className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition ${answers[q.id] === o.key ? "border-primary bg-primary/10 font-semibold" : "border-border hover:border-primary/50"}`}
              >
                {o.text}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button disabled={idx === 0} onClick={() => setIdx((i) => i - 1)} className="btn btn-outline py-2 text-sm disabled:opacity-40">← Prev</button>
          {idx < session.questions.length - 1 ? (
            <button onClick={() => setIdx((i) => i + 1)} className="btn bg-primary py-2 text-sm font-semibold text-primary-foreground">Next →</button>
          ) : (
            <button onClick={submit} disabled={busy} className="btn bg-emerald-600 py-2 text-sm font-semibold text-white disabled:opacity-50">Submit ✓</button>
          )}
        </div>
        <div className="mt-5 flex flex-wrap gap-1.5">
          {session.questions.map((qq, i) => (
            <button key={qq.id} onClick={() => setIdx(i)} className={`h-8 w-8 rounded-md text-xs font-semibold ${i === idx ? "bg-primary text-primary-foreground" : answers[qq.id] ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>{i + 1}</button>
          ))}
        </div>
        {answered < session.questions.length && idx === session.questions.length - 1 && (
          <p className="mt-3 text-xs text-amber-600">{session.questions.length - answered} question(s) unanswered — they count as wrong.</p>
        )}
      </>,
    );
  }

  // ----------------------------------------------------------------- result
  if (result) {
    return shell(
      <>
        <div className={`rounded-2xl border p-6 text-center ${result.allClear ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
          <div className="text-4xl">{result.allClear ? "🎉" : "📚"}</div>
          <h1 className="mt-2 text-2xl font-bold">{result.scorePct}%</h1>
          <p className="text-sm text-muted-foreground">{result.correct}/{result.total} sahi</p>
        </div>
        <BiMessage msg={result.messages.summary} tone={result.allClear ? "success" : "warn"} className="mt-4" />
        {result.wrongWords.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {result.wrongWords.map((w) => (
              <a key={w.slug} href={`/vocabulary/${w.slug}/quiz`} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                {w.word} → 95%+ score karein
              </a>
            ))}
          </div>
        )}
        <div className="mt-6 space-y-3">
          <h2 className="text-sm font-bold">Review</h2>
          {result.review.map((r, i) => (
            <div key={r.id} className={`rounded-xl border p-4 text-sm ${r.isCorrect ? "border-emerald-500/30" : "border-red-500/30"}`}>
              <p className="font-semibold">{i + 1}. {r.questionText}</p>
              <p className="mt-1 text-xs">
                Aapka: <b>{r.givenAnswer ?? "—"}</b> · Sahi: <b className="text-emerald-600">{r.correctAnswer}</b>
              </p>
              {r.explanation && <p className="mt-1 text-xs text-muted-foreground">{r.explanation}</p>}
            </div>
          ))}
        </div>
        <a href="/vocabulary" className="btn btn-outline mt-6 block py-2.5 text-center text-sm">← Vocabulary</a>
      </>,
    );
  }

  // ------------------------------------------------------------------- home
  if (!status) return shell(<p className="text-center text-danger">{error || "Load nahi hua"}</p>);
  return shell(
    <>
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      {status.doneToday && <BiMessage msg={status.messages.alreadyDone} tone="success" />}
      {!status.doneToday && status.poolSize === 0 && <BiMessage msg={status.messages.nothingToRevise} />}
      {status.due && (
        <>
          <BiMessage msg={status.messages.pending} tone="warn" />
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-xl border border-border bg-card p-3"><div className="text-lg font-bold">{status.wordsInTest}</div><div className="text-xs text-muted-foreground">words</div></div>
            <div className="rounded-xl border border-border bg-card p-3"><div className="text-lg font-bold">{status.questionsInTest}</div><div className="text-xs text-muted-foreground">questions</div></div>
            <div className="rounded-xl border border-border bg-card p-3"><div className="text-lg font-bold">{Math.ceil(status.timeLimitSec / 60)}m</div><div className="text-xs text-muted-foreground">time</div></div>
          </div>
          <button onClick={start} disabled={busy} className="btn mt-4 w-full bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {status.inProgressSessionId ? "▶ Continue revision" : "▶ Start revision (free)"}
          </button>
          {!confirmSkip ? (
            <button onClick={() => setConfirmSkip(true)} className="mt-2 w-full text-xs text-muted-foreground underline">Aaj skip karna hai? / Skip today?</button>
          ) : (
            <div className="mt-3 space-y-2">
              <BiMessage msg={status.messages.skipWarning} tone="danger" />
              <button onClick={paySkip} disabled={busy} className="btn w-full border border-red-500/40 bg-red-500/10 py-2.5 text-sm font-semibold text-red-600 disabled:opacity-50">
                {busy ? "Redirecting…" : `Pay ₹${status.skipFeeInr} & skip today`}
              </button>
              <button onClick={() => setConfirmSkip(false)} className="btn btn-outline w-full py-2 text-sm">Nahi, revision karunga / No, I will revise</button>
            </div>
          )}
        </>
      )}
      {status.remaster.length > 0 && (
        <div className="mt-5">
          <BiMessage msg={status.messages.remaster} tone="warn" />
          <div className="mt-3 flex flex-wrap gap-2">
            {status.remaster.map((w) => (
              <a key={w.slug} href={`/vocabulary/${w.slug}/quiz`} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">{w.word} →</a>
            ))}
          </div>
        </div>
      )}
    </>,
  );
}
