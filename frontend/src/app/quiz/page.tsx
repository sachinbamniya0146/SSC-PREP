"use client";

import * as React from "react";

type QuizQ = {
  id: string;
  q: string;
  opts: string[];
  marks: number;
  negativeMarks: number;
};

export default function DailyQuizPage() {
  const [quizId, setQuizId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [questions, setQuestions] = React.useState<QuizQ[]>([]);
  const [answers, setAnswers] = React.useState<Record<string, string | null>>({});
  const [loading, setLoading] = React.useState(true);
  const [result, setResult] = React.useState<{
    score: number;
    totalCorrect: number;
    totalWrong: number;
    totalSkipped: number;
  } | null>(null);
  const [review, setReview] = React.useState<
    {
      questionId: string;
      question: string;
      questionHindi?: string | null;
      options: { key: string; text: string }[];
      correctAnswer: string;
      submittedAnswer: string | null;
      isCorrect: boolean;
      wasSkipped: boolean;
      explanation?: string | null;
      explanationHindi?: string | null;
    }[]
  >([]);

  const load = async () => {
    const token = localStorage.getItem("ssc_access_token");
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1"}/quiz/today`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const d = await res.json();
        setQuizId(d.quizId);
        setTitle(d.title);
        setQuestions(d.questions);
        const init: Record<string, string | null> = {};
        d.questions.forEach((q: QuizQ) => (init[q.id] = null));
        setAnswers(init);
      }
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (qid: string, optIdx: number) => {
    setAnswers((prev) => ({ ...prev, [qid]: String.fromCharCode(65 + optIdx) }));
  };

  const submit = async () => {
    const token = localStorage.getItem("ssc_access_token");
    const payload = {
      quizId,
      answers: questions.map((q) => ({ questionId: q.id, selectedOption: answers[q.id] })),
    };
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1"}/quiz/submit`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (res.ok) {
      const d = await res.json();
      setResult(d.result);
      if (d.review) setReview(d.review);
    } else {
      alert("⚠️ Could not submit quiz.");
    }
  };

  const answered = Object.values(answers).filter((a) => a !== null).length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub
          </a>
          <span className="text-sm text-muted-foreground">{title}</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        {loading && <p className="text-muted-foreground">Loading today&apos;s quiz…</p>}

        {!loading && !result && (
          <>
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold">{title} ☀️</h1>
              <span className="rounded-full bg-muted px-4 py-1.5 text-sm font-semibold text-muted-foreground">
                {answered}/{questions.length} answered
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Each correct = +1, wrong = −0.5, skipped = 0
            </p>

            <div className="mt-6 space-y-5">
              {questions.map((q, i) => (
                <div key={q.id} className="card p-5">
                  <p className="font-medium">
                    Q{i + 1}. {q.q}
                  </p>
                  <div className="mt-3 grid gap-2">
                    {q.opts.map((o, oi) => {
                      const letter = String.fromCharCode(65 + oi);
                      const sel = answers[q.id] === letter;
                      return (
                        <button
                          key={oi}
                          onClick={() => select(q.id, oi)}
                          className={`text-left rounded-lg border px-4 py-2.5 text-sm transition ${
                            sel
                              ? "border-primary bg-primary/20 font-semibold text-primary"
                              : "border-border bg-card hover:bg-muted"
                          }`}
                        >
                          <span className="mr-2 font-semibold">{letter}.</span>
                          {o.replace(/^[A-D]\.\s*/, "")}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={submit}
              disabled={answered === 0}
              className="mt-6 w-full rounded-xl bg-primary py-3.5 font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Submit Quiz
            </button>
          </>
        )}

        {result && (
          <div className="space-y-6">
            <div className="card p-8 text-center">
              <p className="text-3xl">🏆</p>
              <h1 className="mt-2 text-2xl font-bold">Quiz Complete!</h1>
              <p className="mt-4 text-5xl font-black text-primary">{result.score} pts</p>
              <div className="mx-auto mt-6 grid max-w-xs gap-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">✅ Correct</span>
                  <span className="font-semibold text-success">{result.totalCorrect}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">❌ Wrong (−0.5)</span>
                  <span className="font-semibold text-danger">{result.totalWrong}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">⏭ Skipped</span>
                  <span className="font-semibold">{result.totalSkipped}</span>
                </div>
              </div>
              <a
                href="/weak-topics"
                className="mt-8 inline-block rounded-xl bg-primary px-8 py-3 font-semibold text-primary-foreground hover:opacity-90"
              >
                See My Weak Topics →
              </a>
            </div>

            {review.length > 0 && (
              <div className="card p-6">
                <h2 className="text-xl font-bold">📋 Answer Key &amp; Solutions</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Har question ka sahi answer + full solution — teacher-grade, exam ke liye.
                </p>
                <div className="mt-5 space-y-5">
                  {review.map((r, i) => (
                    <div
                      key={r.questionId}
                      className={`rounded-xl border p-4 ${
                        r.wasSkipped
                          ? "border-warning/30 bg-warning/5"
                          : r.isCorrect
                            ? "border-success/30 bg-success/5"
                            : "border-danger/30 bg-danger/5"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium">
                          Q{i + 1}. {r.question}
                        </p>
                        <span
                          className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                            r.wasSkipped
                              ? "bg-warning/20 text-warning"
                              : r.isCorrect
                                ? "bg-success/20 text-success"
                                : "bg-danger/20 text-danger"
                          }`}
                        >
                          {r.wasSkipped ? "Skipped" : r.isCorrect ? "Correct" : "Wrong"}
                        </span>
                      </div>

                      <div className="mt-3 space-y-1 text-sm">
                        {r.options.map((o) => (
                          <div
                            key={o.key}
                            className={`rounded-lg px-3 py-1.5 ${
                              o.key === r.correctAnswer
                                ? "bg-success/15 font-semibold text-success"
                                : o.key === r.submittedAnswer && !r.isCorrect
                                  ? "bg-danger/15 text-danger line-through"
                                  : "bg-muted text-muted-foreground"
                            }`}
                          >
                            <span className="mr-2 font-semibold">{o.key}.</span>
                            {o.text}
                            {o.key === r.correctAnswer && (
                              <span className="ml-2 text-xs">✅ Sahi Answer</span>
                            )}
                          </div>
                        ))}
                      </div>

                      {(r.explanation || r.explanationHindi) && (
                        <div className="mt-3 rounded-lg bg-primary/10 p-3 text-sm leading-relaxed">
                          {r.explanation && (
                            <p className="whitespace-pre-line">{r.explanation}</p>
                          )}
                          {r.explanationHindi && (
                            <p className="mt-2 whitespace-pre-line text-muted-foreground">
                              🇮🇳 {r.explanationHindi}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}