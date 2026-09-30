"use client";

// Word quiz page (NEW — Sep 2026)
//
// Fixed self-contained set (no per-question drip like the exam-prep bank —
// this is a short, all-in-one-go quiz). Submits everything at once to
// POST /vocab/words/:slug/submit, which scores it and — at >=95% — marks the
// word mastered (unlocking the next word on the hub page). Below 95%, the
// student can just retake it; nothing is lost.
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";

type QuizQuestion = { id: string; questionText: string; options: { key: string; text: string }[] };
type QuizData = { wordId: string; word: string; slug: string; masteryThresholdPct: number; requiredCorrectCount: number; timeLimitSec?: number; questions: QuizQuestion[] };
type ReviewItem = {
  id: string;
  questionText: string;
  options: { key: string; text: string }[];
  givenAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean;
  explanation?: string | null;
};
type SubmitResult = {
  scorePct: number;
  correct: number;
  wrong: number;
  total: number;
  masteryThresholdPct: number;
  requiredCorrectCount: number;
  justMastered: boolean;
  alreadyMastered: boolean;
  review: ReviewItem[];
};

export default function VocabWordQuizPage() {
  const params = useParams();
  const router = useRouter();
  const slug = String(params?.slug ?? "");

  const [quiz, setQuiz] = React.useState<QuizData | null>(null);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [current, setCurrent] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<SubmitResult | null>(null);
  // NEW (Sep 26 2026) — "students test dete time timer bhi chalna chahiye":
  // a simple count-up stopwatch, visible for the whole attempt. Not a
  // countdown/time-limit (nothing was asked for a cutoff) — just always-
  // visible elapsed time, same spirit as the exam-prep /test page's timer.
  const [elapsedSec, setElapsedSec] = React.useState(0);

  React.useEffect(() => {
    const timer = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (totalSec: number) => {
    const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
    const s = (totalSec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const r = await fetchAuth(`${API_BASE}/vocab/words/${slug}/quiz`);
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d?.message || "Quiz load nahi hui");
        }
        setQuiz(await r.json());
      } catch (e: any) {
        setError(e.message || "Load failed");
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const submit = async () => {
    if (!quiz) return;
    setSubmitting(true);
    try {
      const r = await fetchAuth(`${API_BASE}/vocab/words/${slug}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.message || "Submit fail hua");
      }
      setResult(await r.json());
    } catch (e: any) {
      setError(e.message || "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  // NEW (Sep 29 2026): the practice quiz is timed — countdown from the server's
  // timeLimitSec, auto-submits at 0 (unanswered questions count as wrong).
  const autoSubmitted = React.useRef(false);
  React.useEffect(() => {
    if (!quiz?.timeLimitSec || result || submitting || autoSubmitted.current) return;
    if (elapsedSec >= quiz.timeLimitSec) {
      autoSubmitted.current = true;
      submit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedSec, quiz, result, submitting]);

  if (loading) return <div className="min-h-screen bg-background text-foreground"><main className="mx-auto max-w-xl px-4 py-10 text-center text-muted-foreground">Loading…</main></div>;

  if (error && !quiz) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto max-w-xl px-4 py-16 text-center">
          <p className="text-danger">{error}</p>
          <a href="/vocabulary" className="btn btn-outline mt-4 inline-block py-2 text-sm">← Vocabulary list</a>
        </main>
      </div>
    );
  }

  if (result) {
    const passed = result.scorePct >= result.masteryThresholdPct;
    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto max-w-xl px-4 py-10">
          <div className={`rounded-2xl border p-6 text-center ${passed ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
            <div className="text-4xl">{passed ? "🎉" : "😕"}</div>
            <h1 className="mt-2 text-2xl font-bold">{result.scorePct}%</h1>
            <p className="mt-1 text-sm text-muted-foreground">{result.correct}/{result.total} sahi</p>
            {passed ? (
              <p className="mt-3 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                {result.alreadyMastered ? "Ye word pehle se hi mastered hai! 🎯" : "Mubarak ho! Agla word unlock ho gaya. 🎯"}
              </p>
            ) : (
              <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
                {result.total} me se {result.requiredCorrectCount} sahi chahiye ({result.masteryThresholdPct}%+) agla word unlock karne ke liye — word ko dobara padhein aur quiz phir se dein.
              </p>
            )}
          </div>

          <div className="mt-6 space-y-3">
            <h2 className="text-sm font-bold">Review</h2>
            {result.review.map((r, i) => (
              <div key={r.id} className={`rounded-xl border p-4 text-sm ${r.isCorrect ? "border-emerald-500/30" : "border-danger/30"}`}>
                <p className="font-medium">{i + 1}. {r.questionText}</p>
                <p className="mt-1.5 text-xs">
                  Aapka jawab: <span className={r.isCorrect ? "text-emerald-600 dark:text-emerald-400" : "text-danger"}>{r.givenAnswer ?? "Skipped"}</span>
                  {!r.isCorrect && <span className="ml-2 text-emerald-600 dark:text-emerald-400">Sahi: {r.correctAnswer}</span>}
                </p>
                {r.explanation && <p className="mt-1.5 text-xs text-muted-foreground">💡 {r.explanation}</p>}
              </div>
            ))}
          </div>

          <div className="mt-6 flex gap-2">
            {!passed && (
              <button onClick={() => window.location.reload()} className="btn flex-1 bg-primary py-2.5 text-sm font-semibold text-primary-foreground">
                🔁 Dobara try karein
              </button>
            )}
            <a href="/vocabulary" className="btn btn-outline flex-1 py-2.5 text-center text-sm">
              ← Vocabulary list
            </a>
          </div>
        </main>
      </div>
    );
  }

  if (!quiz || quiz.questions.length === 0) {
    return <div className="min-h-screen bg-background text-foreground"><main className="mx-auto max-w-xl px-4 py-10 text-center text-muted-foreground">Is word ke liye abhi koi question nahi hai.</main></div>;
  }

  const q = quiz.questions[current];
  const answeredCount = Object.keys(answers).length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-lg">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <span className="text-sm font-semibold">{quiz.word} — Quiz</span>
          <div className="flex items-center gap-3">
            {quiz?.timeLimitSec ? (
              <span className={`font-mono text-xs font-bold ${quiz.timeLimitSec - elapsedSec <= 30 ? "text-red-600" : "text-muted-foreground"}`}>⏳ {formatTime(Math.max(0, quiz.timeLimitSec - elapsedSec))}</span>
            ) : (
              <span className="font-mono text-xs text-muted-foreground">⏱ {formatTime(elapsedSec)}</span>
            )}
            <span className="text-xs text-muted-foreground">{answeredCount}/{quiz.questions.length} answered</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-6">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {quiz.questions.map((qq, i) => (
            <button
              key={qq.id}
              onClick={() => setCurrent(i)}
              className={`h-7 w-7 rounded-md text-xs font-semibold ${
                i === current ? "bg-primary text-primary-foreground" : answers[qq.id] ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <p className="font-medium">{q.questionText}</p>
          <div className="mt-4 space-y-2">
            {q.options.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.key }))}
                className={`w-full rounded-lg border p-3 text-left text-sm transition ${
                  answers[q.id] === opt.key ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"
                }`}
              >
                <span className="mr-2 font-semibold">{opt.key}.</span>
                {opt.text}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setCurrent((c) => Math.max(0, c - 1))}
            disabled={current === 0}
            className="btn btn-outline flex-1 py-2.5 text-sm disabled:opacity-40"
          >
            ← Previous
          </button>
          {current < quiz.questions.length - 1 ? (
            <button onClick={() => setCurrent((c) => c + 1)} className="btn flex-1 bg-primary py-2.5 text-sm font-semibold text-primary-foreground">
              Next →
            </button>
          ) : (
            <button onClick={submit} disabled={submitting} className="btn flex-1 bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {submitting ? "Submitting…" : "✅ Submit Quiz"}
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </main>
    </div>
  );
}
