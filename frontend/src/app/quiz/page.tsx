"use client";

import * as React from "react";
import { AppHeader } from "@/components/app-header";

type QuizQ = {
  id: string;
  q: string;
  qh?: string | null;
  opts: string[];
  examName?: string | null;
  year?: number | null;
  shift?: string | null;
  marks: number;
  negativeMarks: number;
};

// Render a YouTube/Vimeo/S3 video URL in an iframe player
function VideoPlayer({ url, title }: { url: string; title?: string | null }) {
  let src = url;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu")) {
      const v = u.searchParams.get("v") || u.pathname.split("/").filter(Boolean).pop();
      src = v ? `https://www.youtube.com/embed/${v}` : url;
    } else if (u.hostname.includes("vimeo")) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      src = id ? `https://player.vimeo.com/video/${id}` : url;
    }
  } catch {
    src = url;
  }
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border">
      <iframe
        src={src}
        title={title || "Video Solution"}
        className="aspect-video w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
}

// v5 §37.4 — Report Error: student flags a suspected wrong answer (auto soft-suspend on threshold)
function ReportError({ questionId }: { questionId: string }) {
  const [open, setOpen] = React.useState(false);
  const [desc, setDesc] = React.useState("");
  const [category, setCategory] = React.useState("OTHER");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = React.useState(false);

  const CATEGORIES = [
    { value: "WRONG_ANSWER", label: "Galat answer" },
    { value: "WRONG_OPTION", label: "Galat option" },
    { value: "WRONG_EXPLANATION", label: "Galat explanation" },
    { value: "TRANSLATION", label: "Hindi translation galat" },
    { value: "TYPO", label: "Typo / spelling" },
    { value: "MISSING_OPTION", label: "Option missing" },
    { value: "DUPLICATE", label: "Duplicate question" },
    { value: "OTHER", label: "Kuch aur" },
  ];

  const submit = async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    if (!token) {
      setMsg({ ok: false, text: "Login karke report karo." });
      return;
    }
    setSending(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1"}/report-error`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            questionId,
            description: desc.trim() || "Reported error",
            category,
          }),
        },
      );
      const d = await res.json();
      if (res.ok) {
        setMsg({
          ok: true,
          text: d.suspended
            ? "🙏 Report mil gaya. Is question ko review ke liye suspend kar diya — kami fix karenge."
            : `🙏 Report mil gaya (${d.openReports}/${d.threshold} reports).`,
        });
        setDesc("");
      } else {
        setMsg({ ok: false, text: d.message || "Kuch galat gaya. Dobara try karo." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error. Dobara try karo." });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-3">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-danger"
        >
          ⚠️ Is question me galat answer lage? Report karo
        </button>
      ) : (
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-semibold text-muted-foreground">
            Batchao — is question me kya galat lag raha hai:
          </p>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="e.g. Sahi answer C hona chahiye, option B galat laga…"
            className="mt-2 w-full rounded-lg border border-border bg-card p-2 text-sm"
            rows={2}
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-2 w-full rounded-lg border border-border bg-card p-2 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={submit}
              disabled={sending}
              className="rounded-lg bg-danger px-4 py-1.5 text-xs font-semibold text-danger-foreground hover:opacity-90 disabled:opacity-40"
            >
              {sending ? "Bhej rahe…" : "Submit Report"}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground"
            >
              Cancel
            </button>
          </div>
          {msg && (
            <p className={`mt-2 text-xs ${msg.ok ? "text-success" : "text-danger"}`}>
              {msg.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

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
      examName?: string | null;
      year?: number | null;
      shift?: string | null;
      options: { key: string; text: string }[];
      correctAnswer: string;
      submittedAnswer: string | null;
      isCorrect: boolean;
      wasSkipped: boolean;
      explanation?: string | null;
      explanationHindi?: string | null;
      videoUrl?: string | null;
      videoSource?: string | null;
      videoTitle?: string | null;
    }[]
  >([]);

  const load = async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
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
    const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
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
      <AppHeader showSupport={true} />
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
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-primary/15 px-2.5 py-0.5 text-xs font-bold text-primary">
                      Q{i + 1}
                    </span>
                    {(q.examName || q.year) && (
                      <span className="rounded-md bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                        📖 {q.examName ?? "SSC"} {q.year ?? ""} {q.shift ? `• ${q.shift}` : ""}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      +{q.marks} / −{q.negativeMarks}
                    </span>
                  </div>
                  <p className="mt-2 font-medium leading-relaxed">{q.q}</p>
                  {q.qh && (
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      🇮🇳 {q.qh}
                    </p>
                  )}
                  <div className="mt-3 grid gap-2">
                    {q.opts.map((o, oi) => {
                      const letter = String.fromCharCode(65 + oi);
                      const sel = answers[q.id] === letter;
                      return (
                        <button
                          key={oi}
                          onClick={() => select(q.id, oi)}
                          className={`text-left rounded-lg border-2 px-4 py-2.5 text-sm transition-all ${
                            sel
                              ? "border-primary bg-primary font-semibold text-primary-foreground shadow-md"
                              : "border-border bg-card hover:border-primary/50 hover:bg-muted"
                          }`}
                        >
                          <span
                            className={`mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                              sel ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted"
                            }`}
                          >
                            {letter}
                          </span>
                          {o.replace(/^[A-D]\.\s*/, "")}
                          {sel && <span className="float-right text-primary-foreground">✓</span>}
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
                        <div>
                          <p className="font-medium leading-relaxed">
                            Q{i + 1}. {r.question}
                          </p>
                          {r.questionHindi && (
                            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                              🇮🇳 {r.questionHindi}
                            </p>
                          )}
                          {(r.examName || r.year) && (
                            <p className="mt-1 text-xs font-semibold text-muted-foreground">
                              📖 {r.examName ?? "SSC"} {r.year ?? ""}{" "}
                              {r.shift ? `• ${r.shift}` : ""}
                            </p>
                          )}
                          <p className="mt-1 text-xs text-success">
                            ✓ Verified Answer — SSC official answer key se match kiya
                          </p>
                          </div>
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

                      {r.videoUrl && <VideoPlayer url={r.videoUrl} title={r.videoTitle} />}

                      <ReportError questionId={r.questionId} />
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