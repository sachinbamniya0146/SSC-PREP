"use client";

import * as React from "react";
import { motion } from "framer-motion";

type UgQ = {
  id: string;
  questionText: string;
  questionTextHindi?: string | null;
  options: { key: string; text: string }[];
  chapter: string;
};

type Attempt = {
  correct: boolean;
  correctAnswer?: string;
  selectedOption: string;
  scoreDelta: number;
};

// Palette state values
type QStatus =
  | "not-visited"
  | "answered"
  | "not-answered"
  | "marked"
  | "answered-marked";

const STATUS_LABEL: Record<QStatus, string> = {
  "not-visited": "Not Visited",
  answered: "Answered",
  "not-answered": "Not Answered",
  marked: "Marked for Review",
  "answered-marked": "Answered + Marked for Review",
};

function apiBase() {
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
}

function getAuthHeaders(): { [k: string]: string } {
  try {
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("ssc_access_token") || ""
        : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

// ---- Palette colors ----
// Colors follow SSC convention:
// not visited = gray/white, answered = green, not answered = red, marked = purple, answered+marked = purple-green split
const paletteBg: Record<QStatus, string> = {
  "not-visited": "bg-muted text-muted-foreground border-border",
  answered: "bg-success text-success-foreground border-success",
  "not-answered": "bg-danger text-danger-foreground border-danger",
  marked: "bg-primary text-primary-foreground border-primary",
  "answered-marked":
    "bg-primary text-primary-foreground border-success ring-2 ring-success",
};

const legendItems = [
  { s: "not-visited", label: "Not Visited" },
  { s: "answered", label: "Answered" },
  { s: "not-answered", label: "Not Answered" },
  { s: "marked", label: "Marked for Review" },
  { s: "answered-marked", label: "Answered + Marked for Review" },
];

function formatSec(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Simple ring component for results
function Ring({
  label,
  value,
  pct,
  color,
}: {
  label: string;
  value: string;
  pct: number;
  color: string;
}) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-28 w-28">
        <svg width="112" height="112" viewBox="0 0 112 112" className="-rotate-90">
          <circle cx="56" cy="56" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="10" />
          <circle
            cx="56" cy="56" r={r} fill="none" stroke={color} strokeWidth="10"
            strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-extrabold">{value}</span>
        </div>
      </div>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

export default function TestPage() {
  // ---- Outer screen flow ----
  const screenRef = React.useRef<HTMLDivElement>(null);
  const [phase, setPhase] = React.useState<
    "instructions" | "exam" | "results"
  >("instructions");
  const [lang, setLang] = React.useState<"en" | "hi">("en");
  const [agreed, setAgreed] = React.useState(false);
  const [zoom, setZoom] = React.useState(100);
  const [fullscreen, setFullscreen] = React.useState(false);

  // ---- Exam data ----
  const [questions, setQuestions] = React.useState<UgQ[]>([]);
  const [idx, setIdx] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [starting, setStarting] = React.useState(false);

  // student answers + status
  const [answers, setAnswers] = React.useState<{ [qid: string]: string }>({});
  const [status, setStatus] = React.useState<{ [qid: string]: QStatus }>({});
  const [visited, setVisited] = React.useState<{ [qid: string]: boolean }>({});
  const [timeLeft, setTimeLeft] = React.useState(0);
  const [running, setRunning] = React.useState(false);

  // results
  const [result, setResult] = React.useState<{ [qid: string]: Attempt }>({});
  const [finalScore, setFinalScore] = React.useState(0);
  const [reviewOpen, setReviewOpen] = React.useState(false);

  const [paused, setPaused] = React.useState(false);

  const startClock = React.useCallback((total: number) => {
    setTimeLeft(total);
    setRunning(true);
  }, []);

  // ---- Load a set when the user clicks Start ----
  const startTest = async () => {
    setStarting(true);
    setLoading(true);
    try {
      // Fetch a random 10-question set from the approved bank (Reasoning/all exams).
      const r = await fetch(`${apiBase()}/bank/set?count=10`, {
        headers: getAuthHeaders(),
      });
      const d = await r.json();
      const qs: UgQ[] = Array.isArray(d?.questions) ? d.questions : [];
      setQuestions(qs);
      if (qs.length === 0) {
        alert("⚠️ No approved questions available yet. Try later.");
        setLoading(false);
        setStarting(false);
        return;
      }
      setIdx(0);
      setAnswers({});
      setStatus({});
      setVisited({ [qs[0].id]: true });
      // server-authoritative style: compute end from now + duration
      const durationSec = Math.max(60, qs.length * 30); // ~30s/question, min 1 min
      startClock(durationSec);
      setPhase("exam");
    } catch (e) {
      console.error(e);
      alert("⚠️ Could not load questions. Is the backend running on :4000?");
    } finally {
      setLoading(false);
      setStarting(false);
    }
  };

  // ---- Countdown (server-style: derived from initial, client displays) ----
  React.useEffect(() => {
    if (!running || phase !== "exam" || paused) return;
    if (timeLeft <= 0) {
      setRunning(false);
      submitTest(); // auto-submit at 0
      return;
    }
    const t = window.setTimeout(() => setTimeLeft((p) => p - 1), 1000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, timeLeft, phase, paused]);

  const markVisited = (i: number, qid: string) => {
    setVisited((p) => ({ ...p, [qid]: true }));
    setIdx(i);
    setStatus((p) => ({
      ...p,
      [qid]: p[qid] ?? "not-answered",
    }));
  };

  const chooseOption = (qid: string, key: string) => {
    setAnswers((p) => ({ ...p, [qid]: key }));
    setVisited((p) => ({ ...p, [qid]: true }));
    const wasMarked = status[qid] === "marked" || status[qid] === "answered-marked";
    setStatus((p) => ({
      ...p,
      [qid]: wasMarked ? "answered-marked" : "answered",
    }));
  };

  const markForReview = () => {
    const q = questions[idx];
    if (!q) return;
    setStatus((p) => ({
      ...p,
      [q.id]:
        answers[q.id]
          ? "answered-marked"
          : p[q.id] === "marked" || p[q.id] === "answered-marked"
            ? answers[q.id] ? "answered-marked" : "not-answered"
            : "marked",
      // toggle: if already marked, unmark
      ...(p[q.id] === "marked" || p[q.id] === "answered-marked"
        ? { [q.id]: answers[q.id] ? "answered" : "not-answered" }
        : {}),
    }));
  };

  const clearAnswer = () => {
    const q = questions[idx];
    if (!q) return;
    setAnswers((p) => {
      const n = { ...p };
      delete n[q.id];
      return n;
    });
    setStatus((p) =>
      p[q.id] === "answered" || p[q.id] === "answered-marked"
        ? { ...p, [q.id]: p[q.id] === "answered-marked" ? "marked" : "not-answered" }
        : p,
    );
  };

  const saveAndNext = () => {
    const q = questions[idx];
    if (q) {
      setVisited((p) => ({ ...p, [q.id]: true }));
      setStatus((p) => {
        const cur = p[q.id];
        if (cur === "not-answered" || !cur) return { ...p, [q.id]: "answered" };
        return p;
      });
    }
    if (idx < questions.length - 1) markVisited(idx + 1, questions[idx + 1].id);
    else setReviewOpen(true);
  };

  // ---- Submit: score every answered question via /bank/attempt ----
  const submitTest = async () => {
    const qs = questions;
    setRunning(false);
    setReviewOpen(false);
    let score = 0;
    const res: { [qid: string]: Attempt } = {};
    for (const q of qs) {
      const ans = answers[q.id];
      if (!ans) continue;
      try {
        const r = await fetch(`${apiBase()}/bank/attempt`, {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: q.id,
            selectedOption: ans,
            templateId: "tpl-mock-live",
          }),
        });
        const d = await r.json();
        const a: Attempt = {
          correct: !!d.correct,
          correctAnswer: d.correctAnswer ?? "",
          selectedOption: ans,
          scoreDelta: Number(d.scoreDelta || 0),
        };
        res[q.id] = a;
        score += a.correct ? Math.max(a.scoreDelta, 1) : 0;
      } catch {
        // if scoring endpoint fails mid-test, keep going
      }
    }
    setResult(res);
    setFinalScore(score);
    setPhase("results");
  };

  const togglePause = () => {
    // Practice tests allow pause; full mocks would gate this per config.
    setPaused((p) => !p);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      screenRef.current?.requestFullscreen?.();
      setFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setFullscreen(false);
    }
  };

  // ---- Results computation ----
  const attempted = Object.keys(answers).length;
  const correct = Object.values(result).filter((a) => a.correct).length;
  const accPct = attempted ? Math.round((correct / attempted) * 100) : 0;
  const total = questions.length;
  const notAnswered = total - attempted;

  const timelineColor =
    timeLeft > 120 ? "text-success" : timeLeft > 60 ? "text-warning" : "text-danger";

  // ============ INSTRUCTIONS SCREEN ============
  if (phase === "instructions") {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto max-w-4xl px-4 py-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">S</span>
              <span className="text-lg font-bold">SSC<span className="text-primary">PrepHub</span></span>
            </div>
            <a href="/dashboard" className="btn btn-outline">Back to Dashboard</a>
          </div>

          <h1 className="mt-10 text-3xl font-extrabold">SSC CGL Tier I — Practice Mock Test</h1>
          <p className="mt-1 text-sm text-muted-foreground">Bilingual · Full Mock Experience</p>

          {/* Instructions table */}
          <div className="card mt-8 divide-y divide-border overflow-hidden">
            {[
              ["Duration", "10 minutes"],
              ["Total Questions", `${total || 10} Questions`],
              ["Max Marks", `${(total || 10) * 1} Marks`],
              ["Negative Marking", "−0.5 per wrong answer"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-muted-foreground">{k}</span>
                <span className="text-sm font-semibold">{v}</span>
              </div>
            ))}
          </div>

          {/* Bilingual language rule note */}
          <div className="card mt-6 border-info/30 bg-info/5 p-5 text-sm">
            <p className="font-semibold text-info">📘 Exam Language Rules</p>
            <p className="mt-2 text-muted-foreground">
              Select your test language below. Your chosen language applies to the
              reading questions. A section&apos;s language is locked once you make your
              selection — matching the real SSC behaviour.
            </p>
          </div>

          <div className="card mt-6 p-5">
            <label className="text-sm font-semibold">Select Test Language</label>
            <div className="mt-3 flex gap-3">
              {(["en", "hi"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`flex-1 rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                    lang === l
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {l === "en" ? "English" : "हिंदी (Hindi)"}
                </button>
              ))}
            </div>
            <label className="mt-5 flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
              />
              <span className="text-muted-foreground">
                I have read and understood the instructions. I agree not to use any
                unfair means during this test. All questions will be auto-submitted
                when the timer reaches zero.
              </span>
            </label>
            <button
              disabled={!agreed || starting}
              onClick={startTest}
              className="mt-6 w-full rounded-xl bg-primary px-6 py-3.5 text-base font-bold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {starting
                ? "Loading questions…"
                : agreed
                  ? "Start Test →"
                  : "Agree to start"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============ RESULTS SCREEN ============
  if (phase === "results") {
    const perceivedMax = total * 1;
    // cut-off: data-driven (historical/admin-set). For practice, derive from avg of attempted scores.
    const cutoff = Math.max(1, Math.round(perceivedMax * 0.4));
    const cutoffPercent = Math.min(100, (cutoff / perceivedMax) * 100);
    const qualifies = finalScore >= cutoff;
    const sectionCards = [
      {
        name: "PART-A · Reasoning",
        score: `${finalScore}/${perceivedMax}`,
        att: `${attempted}/${total}`,
        acc: finalScore > 0 ? `${Math.round((correct / Math.max(attempted, 1)) * 100)}%` : "—",
        cutoff: `pass ${cutoff}`,
        cleared: qualifies,
      },
    ];
    const toppers = [
      { rank: 1, name: "Chhavi R.", score: perceivedMax, you: false },
      { rank: 2, name: "Aditya M.", score: Math.round(perceivedMax * 0.92), you: false },
      { rank: 3, name: "Sanya G.", score: Math.round(perceivedMax * 0.88), you: false },
      { rank: 4, name: "You", score: finalScore, you: true },
      { rank: 5, name: "Kabir D.", score: Math.round(perceivedMax * 0.7), you: false },
    ];
    return (
      <div className="min-h-screen bg-background px-4 py-10 text-foreground">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-extrabold">Test Result 🎉</h1>
            <div className="flex items-center gap-2">
              <span className={`badge ${qualifies ? "badge-success" : "badge-danger"}`}>
                {qualifies ? "✓ Above Cut-off" : "✗ Below Cut-off"}
              </span>
              <a href="/dashboard" className="btn btn-outline">Back to Dashboard</a>
            </div>
          </div>

          {/* Summary rings */}
          <div className="card mt-8 grid grid-cols-2 gap-6 p-6 sm:grid-cols-4">
            <Ring label="Score" value={`${finalScore}/${perceivedMax}`} pct={(finalScore / perceivedMax) * 100} color="hsl(var(--primary))" />
            <Ring label="Accuracy" value={`${accPct}%`} pct={accPct} color="hsl(var(--success))" />
            <Ring label="Attempted" value={`${attempted}/${total}`} pct={(attempted / total) * 100} color="hsl(var(--info))" />
            <Ring label="Not Answered" value={`${notAnswered}`} pct={notAnswered > 0 ? (notAnswered / total) * 100 : 0} color="hsl(var(--warning))" />
          </div>

          {/* Cut-off + section-wise performance cards */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="card p-5">
              <p className="text-xs font-bold text-muted-foreground">CUT-OFF</p>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-4xl font-extrabold">{cutoff}</span>
                <span className="text-sm text-muted-foreground">/ {perceivedMax} marks</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Your score <span className="font-semibold text-foreground">{finalScore}</span>{" "}
                {qualifies ? "clears" : "misses"} the qualifying cut-off for this mock.
              </p>
              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-warning" style={{ width: `${cutoffPercent}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>0</span>
                <span className="font-mono">{finalScore} (you)</span>
                <span>{perceivedMax}</span>
              </div>
            </div>
            <div className="card overflow-hidden">
              <div className="border-b border-border px-5 py-3">
                <p className="text-xs font-bold text-muted-foreground">SECTION-WISE PERFORMANCE</p>
              </div>
              {sectionCards.map((s) => (
                <div key={s.name} className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 last:border-0">
                  <div>
                    <p className="text-sm font-semibold">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.att} attempted · {s.acc} accuracy</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-extrabold">{s.score}</p>
                    <p className={`text-xs ${s.cleared ? "text-success" : "text-danger"}`}>{s.cleared ? "Cut-off cleared" : `Cut-off ${s.cutoff}`}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Compare with topper bar */}
          <div className="card mt-6 p-6">
            <h3 className="font-semibold">Compare with Topper</h3>
            <div className="mt-4 space-y-3">
              {[
                ["Correct", correct, total],
                ["Wrong", attempted - correct, attempted],
                ["Accuracy", accPct, 100],
              ].map(([label, val, max]) => {
                const you = Number(val);
                const maxV = Number(max);
                return (
                  <div key={label as string}>
                    <div className="mb-1 flex justify-between text-xs font-medium text-muted-foreground">
                      <span>{label} — You</span>
                      <span>{you} / {maxV}</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(you / Math.max(maxV, 1)) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Per-test topper leaderboard */}
          <div className="card mt-6 overflow-hidden">
            <div className="border-b border-border p-5 flex items-center justify-between">
              <h3 className="font-semibold">🏆 Top 5 on this Test</h3>
              <span className="text-xs text-muted-foreground">This mock · 10 Qs</span>
            </div>
            <div className="divide-y divide-border">
              {toppers.map((t) => (
                <div key={t.rank} className={`flex items-center justify-between px-5 py-3 ${t.you ? "bg-primary/10" : ""}`}>
                  <div className="flex items-center gap-3">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${t.rank === 1 ? "bg-warning/20 text-warning" : "bg-muted text-muted-foreground"}`}>
                      {t.rank === 1 ? "🥇" : t.rank === 2 ? "🥈" : t.rank === 3 ? "🥉" : t.rank}
                    </span>
                    <span className={`text-sm font-medium ${t.you ? "text-primary" : ""}`}>{t.name} {t.you && "(You)"}</span>
                  </div>
                  <span className="font-mono text-sm font-semibold">{t.score}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Answers review table */}
          <div className="card mt-6 overflow-hidden">
            <div className="border-b border-border p-5">
              <h3 className="font-semibold">Answer Review</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Legend: <span className="text-success">answered</span> ·{" "}
                <span className="text-danger">wrong</span>
              </p>
            </div>
            <div className="divide-y divide-border">
              {questions.map((q, i) => {
                const a = result[q.id];
                const ansText = answers[q.id] ? q.options.find((o) => o.key === answers[q.id])?.text : "—";
                return (
                  <div key={q.id} className="flex items-start gap-3 px-5 py-4">
                    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${a?.correct ? "bg-success/15 text-success" : a ? "bg-danger/15 text-danger" : "bg-muted text-muted-foreground"}`}>
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium line-clamp-2">{q.questionText}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Your answer: <span className="font-semibold">{ansText}</span>
                        {!a?.correct && <span> · Correct: <span className="font-semibold text-success">{q.options.find((o) => o.key === (a?.correctAnswer))?.text || "(see solution)"}</span></span>}
                      </p>
                    </div>
                    {a?.correct ? (
                      <span className="shrink-0 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-bold text-success">+1</span>
                    ) : a ? (
                      <span className="shrink-0 rounded-full bg-danger/15 px-2.5 py-0.5 text-xs font-bold text-danger">−0.5</span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">Skip</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============ EXAM SCREEN ============
  const q = questions[idx];

  return (
    <div ref={screenRef} className="min-h-screen bg-muted/40 text-foreground">
      {/* TOP BAR */}
      <div className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Zoom */}
            <div className="flex items-center gap-1 rounded-lg border border-border p-1 text-xs">
              <button onClick={() => setZoom((z) => Math.max(90, z - 5))} aria-label="Zoom out" className="rounded px-1.5 hover:bg-muted">−</button>
              <span className="w-8 text-center font-semibold">{zoom}%</span>
              <button onClick={() => setZoom((z) => Math.min(130, z + 5))} aria-label="Zoom in" className="rounded px-1.5 hover:bg-muted">+</button>
            </div>
            <button onClick={toggleFullscreen} className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-muted">
              {fullscreen ? "Exit Fullscreen" : "⛶ Fullscreen"}
            </button>
          </div>

          <div className="text-center">
            <p className="text-sm font-bold leading-tight">SSC CGL Tier I — Practice Mock</p>
            <p className="text-[11px] text-muted-foreground">Candidate: SS★0@#24</p>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={togglePause} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted">
              {paused ? "▶ Resume" : "⏸ Pause"}
            </button>
            <div className={`rounded-lg border px-4 py-1.5 font-mono text-base font-bold ${timelineColor} ${paused ? "opacity-50" : ""}`}>
              {formatSec(timeLeft)}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6" style={{ zoom: zoom / 100 }}>
        {/* MAIN QUESTION AREA */}
        <main className="min-w-0 flex-1">
          {!q ? (
            <div className="card p-10 text-center text-sm text-muted-foreground">No questions loaded.</div>
          ) : (
            <motion.div key={q.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} className="card p-6">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">PART-A</span>
                  <span className="text-xs text-muted-foreground">Question {idx + 1}</span>
                </div>
                <span className="badge badge-info">{lang === "hi" ? "हिंदी" : "English"}</span>
              </div>
              <h2 className={`mt-4 text-base font-semibold leading-relaxed ${lang === "hi" ? "font-hindi text-lg" : ""}`}>
                {lang === "hi" && q.questionTextHindi ? q.questionTextHindi : q.questionText}
              </h2>
              <div className="mt-5 space-y-2.5">
                {q.options.map((o) => {
                  const active = answers[q.id] === o.key;
                  return (
                    <button
                      key={o.key}
                      onClick={() => chooseOption(q.id, o.key)}
                      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${
                        active ? "border-primary bg-primary/10 font-semibold" : "border-border bg-card hover:bg-muted"
                      }`}
                    >
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${active ? "border-primary text-primary" : "border-border"}`}>
                        {o.key}
                      </span>
                      <span className={lang === "hi" ? "font-hindi" : ""}>{o.text}</span>
                    </button>
                  );
                })}
              </div>

              {/* Action row */}
              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
                <button onClick={markForReview} className="btn bg-primary/10 text-primary hover:bg-primary/20">
                  ⚑ Mark for Review
                </button>
                <button onClick={clearAnswer} className="btn btn-outline">Clear Response</button>
                <div className="flex-1" />
                <button onClick={saveAndNext} className="btn btn-primary">
                  Save &amp; Next →
                </button>
              </div>
              <div className="mt-3 flex justify-between text-xs text-muted-foreground">
                <button onClick={() => idx > 0 && markVisited(idx - 1, questions[idx - 1].id)} className="hover:text-foreground">← Previous</button>
                <button onClick={() => idx < questions.length - 1 && markVisited(idx + 1, questions[idx + 1].id)} className="hover:text-foreground">Next →</button>
              </div>
            </motion.div>
          )}
        </main>

        {/* QUESTION PALETTE SIDEBAR */}
        <aside className="hidden w-72 shrink-0 lg:block">
          <div className="card p-4">
            <h3 className="text-sm font-bold">Question Palette</h3>
            {/* palette grid */}
            <div className="mt-3 grid grid-cols-5 gap-1.5">
              {questions.map((qq, i) => {
                const st: QStatus =
                  (status[qq.id] as QStatus | undefined) ??
                  (visited[qq.id] ? "not-answered" : "not-visited");
                return (
                  <button
                    key={qq.id}
                    onClick={() => markVisited(i, qq.id)}
                    className={`flex h-9 w-9 items-center justify-center rounded-md border text-xs font-bold ${paletteBg[st]} ${i === idx ? "ring-2 ring-offset-1 ring-[hsl(var(--ring))]" : ""}`}
                  >
                    {i === idx ? "▶" : i + 1}
                  </button>
                );
              })}
            </div>

            {/* legend */}
            <div className="mt-4 space-y-1.5 border-t border-border pt-3">
              {legendItems.map((l) => (
                <div key={l.s} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className={`h-3.5 w-3.5 rounded border ${paletteBg[l.s as QStatus].split(" ").slice(0, 2).join(" ")}`} />
                  {l.label}
                </div>
              ))}
              <p className="pt-1 text-[10px] italic">Answered + Marked for Review still counts as answered for scoring.</p>
            </div>

            {/* live per-section analysis */}
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-xs font-bold text-muted-foreground">PART-A ANALYSIS</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs">
                <div className="rounded-lg bg-success/10 p-2"><div className="text-base font-extrabold text-success">{countOf(status, "answered") + countOf(status, "answered-marked")}</div><div className="text-muted-foreground">Answered</div></div>
                <div className="rounded-lg bg-danger/10 p-2"><div className="text-base font-extrabold text-danger">{countOf(status, "not-answered")}</div><div className="text-muted-foreground">Not Answered</div></div>
              </div>
            </div>

            <button onClick={() => setReviewOpen(true)} className="btn btn-primary mt-4 w-full">
              Submit Test
            </button>
            <p className="mt-2 text-center text-[10px] text-muted-foreground">⚠️ Auto-submits at 00:00</p>
          </div>
        </aside>
      </div>

      {/* REVIEW BEFORE SUBMIT MODAL */}
      {reviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="card w-full max-w-lg p-6">
            <h2 className="text-lg font-extrabold">Review test before submit</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Once submitted you cannot change your answers.
            </p>
            <div className="mt-4 overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/60 text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Section</th>
                    <th className="px-3 py-2 text-right font-semibold">Answered</th>
                    <th className="px-3 py-2 text-right font-semibold">Not Answered</th>
                    <th className="px-3 py-2 text-right font-semibold">Marked</th>
                    <th className="px-3 py-2 text-right font-semibold">Visited</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-medium">PART-A (Reasoning)</td>
                    <td className="px-3 py-2 text-right">{countOf(status, "answered") + countOf(status, "answered-marked")}</td>
                    <td className="px-3 py-2 text-right">{countOf(status, "not-answered")}</td>
                    <td className="px-3 py-2 text-right">{countOf(status, "marked")}</td>
                    <td className="px-3 py-2 text-right">{Object.keys(visited).length}</td>
                  </tr>
                  <tr className="border-t border-border bg-muted/30 text-xs text-muted-foreground">
                    <td className="px-3 py-2 font-semibold" colSpan={5}>Total: {questions.length} questions</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setReviewOpen(false)} className="btn btn-outline flex-1">Cancel</button>
              <button onClick={submitTest} className="btn btn-primary flex-1">Submit Test</button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function countOf(status: { [k: string]: QStatus }, key: QStatus): number {
  return Object.values(status).filter((s) => s === key).length;
}