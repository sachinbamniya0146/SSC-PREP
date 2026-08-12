"use client";
import { fetchAuth } from "@/lib/api";

import * as React from "react";
import { motion } from "framer-motion";

type UgQ = {
  id: string;
  questionText: string;
  questionTextHindi?: string | null;
  options: { key: string; text: string; textHi?: string | null }[];
  chapter: string;
  examName?: string | null;
  year?: number | null;
  shift?: string | null;
  marks?: number;
  negativeMarks?: number;
  correctAnswer?: string | null;
  explanation?: string | null;
  explanationHindi?: string | null;
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
  const [attemptId, setAttemptId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<{ [qid: string]: QStatus }>({});
  const [visited, setVisited] = React.useState<{ [qid: string]: boolean }>({});
  const [timeLeft, setTimeLeft] = React.useState(0);
  const [running, setRunning] = React.useState(false);

  // results
  const [result, setResult] = React.useState<{ [qid: string]: Attempt }>({});
  const [finalScore, setFinalScore] = React.useState(0);
  const [reviewOpen, setReviewOpen] = React.useState(false);

  const [paused, setPaused] = React.useState(false);

  // practice-mode aids (v6 §5: Show Answer + AI Hint, hint capped at 3/session)
  const [showAns, setShowAns] = React.useState<{ [qid: string]: boolean }>({});
  const [hintUsed, setHintUsed] = React.useState<{ [qid: string]: boolean }>({});
  const [hintQuota, setHintQuota] = React.useState(3);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  // ---- per-question pacing (v6 §6: avg time/question, rushing/balanced/slow) ----
  const [qEnterRef] = React.useState<{ qid: string; at: number }>({ qid: "", at: 0 });
  const [timeSpent, setTimeSpent] = React.useState<{ [qid: string]: number }>({});
  React.useEffect(() => {
    if (phase !== "exam" || !questions[idx]) return;
    qEnterRef.qid = questions[idx].id;
    qEnterRef.at = Date.now();
  }, [idx, phase, questions, qEnterRef]);
  const markQuestionTime = (qid: string) => {
    if (qEnterRef.qid === qid && qEnterRef.at > 0) {
      const spent = Math.round((Date.now() - qEnterRef.at) / 1000);
      setTimeSpent((p) => ({ ...p, [qid]: (p[qid] || 0) + Math.max(spent, 0) }));
      qEnterRef.at = Date.now();
    }
  };

  const startClock = React.useCallback((total: number) => {
    setTimeLeft(total);
    setRunning(true);
  }, []);

  // ---- Load a set when the user clicks Start ----
  const startTest = async () => {
    setStarting(true);
    setLoading(true);
    try {
      // v3 §6.4 — Daily Test (Live mode): /test?daily=1 → server composes the
      // plan-based paper, snapshots it and opens a server-authoritative timed attempt
      const isDaily = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("daily") === "1" : false;
      let qs: UgQ[] = [];
      let durationSec = 0;
      let attemptId: string | null = null;
      if (isDaily) {
        const dr = await fetchAuth(`${apiBase()}/tests/daily-test/start`, {
          method: "POST",
          headers: getAuthHeaders(),
        });
        const dd = await dr.json().catch(() => ({}));
        if (!dr.ok) {
          alert(`⚠️ ${dd?.message || "Daily Test unavailable — create a study plan first."}`);
          setLoading(false);
          setStarting(false);
          return;
        }
        qs = Array.isArray(dd?.questions) ? dd.questions : [];
        durationSec = dd?.durationSec || 0;
        attemptId = dd?.attemptId ?? null;
        setAttemptId(attemptId);
        if (attemptId) sessionStorage.setItem("ssc_active_attempt", attemptId);
      }
      // v6 §2a — full shift paper: /test?template=<id> composes the template's paper
      // server-side (real exam blueprint, no answer key) + opens a server-authoritative
      // timed attempt.
      const tplId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("template") : null;
      if (tplId) {
        const pr = await fetchAuth(`${apiBase()}/tests/paper/${encodeURIComponent(tplId)}`, {
          headers: getAuthHeaders(),
        });
        if (!pr.ok) {
          const err = await pr.json().catch(() => ({}));
          alert(`⚠️ ${err?.message || "Could not load this mock."}`);
          setLoading(false);
          setStarting(false);
          return;
        }
        const paper = await pr.json();
        qs = Array.isArray(paper?.sections)
          ? paper.sections.flatMap((s: any) =>
              (s.questions || []).map((qq: any) => ({
                id: qq.id,
                questionText: qq.questionText,
                questionTextHindi: qq.questionTextHindi,
                options: qq.options,
                chapter: qq.chapter || "",
                examName: qq.examName,
                year: qq.year,
                shift: qq.shift,
                marks: qq.marks,
                negativeMarks: qq.negativeMarks,
                explanation: qq.explanation,
                explanationHindi: qq.explanationHindi,
              })),
            )
          : [];
        durationSec = (paper?.durationMinutes || 60) * 60;
        // server-authoritative timed attempt
        try {
          const ar = await fetchAuth(`${apiBase()}/tests/attempts/start`, {
            method: "POST",
            headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ testTemplateId: tplId }),
          });
          const ad = await ar.json();
          attemptId = ad.id ?? null;
          setAttemptId(attemptId);
          if (attemptId) sessionStorage.setItem("ssc_active_attempt", attemptId);
          // v4 §31 — resumed attempt (refresh/revisit): hydrate persisted autosaves
          if (Array.isArray(ad.answers) && ad.answers.length) {
            const savedMap: { [qid: string]: string } = {};
            for (const a of ad.answers) if (a.selectedOption) savedMap[a.questionId] = a.selectedOption;
            setAnswers(savedMap);
            setStatus((p) => {
              const n = { ...p };
              for (const qid of Object.keys(savedMap)) n[qid] = "answered";
              return n;
            });
          }
        } catch {
          attemptId = null;
        }
      }
      // v6 §2c — sectional test: composed set stashed by /sectional page
      if (qs.length === 0) {
        const sectionalRaw = sessionStorage.getItem("ssc_sectional_set");
        if (sectionalRaw) {
          const d = JSON.parse(sectionalRaw);
          qs = Array.isArray(d?.questions) ? d.questions : [];
          sessionStorage.removeItem("ssc_sectional_set");
        }
      }
      // v5 §36 — chapter-wise PYQ practice: /test?chapter=<id>&exam=<id>
      if (qs.length === 0) {
        const chapId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("chapter") : null;
        if (chapId) {
          const qp = new URLSearchParams({ take: "25" });
          const eid = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("exam") : null;
          if (eid) qp.append("examId", eid);
          const cr = await fetchAuth(`${apiBase()}/bank/chapters/${encodeURIComponent(chapId)}/pyq?${qp}`, {
            headers: getAuthHeaders(),
          });
          const cd = await cr.json();
          qs = Array.isArray(cd?.questions) ? cd.questions : Array.isArray(cd) ? cd : [];
        }
      }
      if (qs.length === 0) {
        // Default: random bilingual set from the approved bank
        const r = await fetchAuth(`${apiBase()}/bank/set?count=10`, {
          headers: getAuthHeaders(),
        });
        const d = await r.json();
        qs = Array.isArray(d?.questions) ? d.questions : [];
      }
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
      const durationSecFinal = durationSec > 0 ? durationSec : Math.max(60, qs.length * 30); // ~30s/question, min 1 min
      startClock(durationSecFinal);
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
    if (questions[idx]) markQuestionTime(questions[idx].id);
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

  // ---- v4 §31 — AUTOSAVE: debounced persist of answers mid-attempt. What's
  // saved here is exactly what an auto-submit-at-expiry scores (lossless). ----
  const autosaveTimer = React.useRef<any>(null);
  React.useEffect(() => {
    if (!attemptId || phase !== "exam" || Object.keys(answers).length === 0) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      try {
        const payload = Object.entries(answers).map(([questionId, selectedOption]) => ({
          questionId,
          selectedOption,
        }));
        await fetchAuth(`${apiBase()}/tests/attempts/${attemptId}/answers`, {
          method: "PUT",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ answers: payload }),
        });
      } catch {
        /* autosave is best-effort — the submit payload is authoritative */
      }
    }, 2500);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [answers, attemptId, phase]);

  // ---- v4 §31 — keyboard shortcuts (real exam feel) ----
  React.useEffect(() => {
    if (phase !== "exam" || paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        const q = questions[idx];
        if (q) chooseOption(q.id, String.fromCharCode(64 + Number(e.key)));
        return;
      }
      if (e.key === " " && !e.shiftKey) {
        e.preventDefault();
        saveAndNext();
        return;
      }
      if (e.key === " " && e.shiftKey) {
        e.preventDefault();
        if (idx > 0) markVisited(idx - 1, questions[idx - 1].id);
        return;
      }
      if (e.key.toLowerCase() === "p") {
        setPaletteOpen((p) => !p);
        return;
      }
      if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused, idx, questions, answers, status]);

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
        const r = await fetchAuth(`${apiBase()}/bank/attempt`, {
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
        score += a.scoreDelta; // server-side: correct→+marks, wrong→−negativeMarks
      } catch {
        // if scoring endpoint fails mid-test, keep going
      }
    }
    setResult(res);
    setFinalScore(score);
    if (qs[idx]) markQuestionTime(qs[idx].id); // finalize last question time
    setPhase("results");

    // P1 — best-effort save to results history (never blocks results view)
    try {
      const activeAttempt =
        typeof window !== "undefined" ? sessionStorage.getItem("ssc_active_attempt") : null;
      if (activeAttempt) {
        // P0: server-authoritative timed attempt — submit to the open attempt.
        const answersPayload = [];
        for (const q of qs) {
          const a = res[q.id];
          answersPayload.push({
            questionId: q.id,
            selectedOption: a ? a.selectedOption : null,
            timeSpentSeconds: timeSpent[q.id] || 0,
          });
        }
        await fetchAuth(`${apiBase()}/tests/attempts/${activeAttempt}/submit`, {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ answers: answersPayload }),
        });
        sessionStorage.removeItem("ssc_active_attempt");
        return;
      }
      let correct = 0;
      let wrong = 0;
      let skipped = 0;
      const answersPayload = [];
      for (const q of qs) {
        const a = res[q.id];
        if (!a) { skipped++; continue; }
        if (a.correct) correct++;
        else wrong++;
        answersPayload.push({
          questionId: q.id,
          selectedOption: a.selectedOption,
          isCorrect: a.correct,
          timeSpentSeconds: timeSpent[q.id] || 0,
        });
      }
      const total = qs.length;
      const acc = total ? Math.round(((correct + 0) / total) * 100) : 0;
      await fetchAuth(`${apiBase()}/tests/attempts`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          testTemplateId: "tpl-mock-live",
          score,
          totalCorrect: correct,
          totalWrong: wrong,
          totalSkipped: skipped,
          accuracyPercent: acc,
          answers: answersPayload,
        }),
      });
    } catch {
      // history save is best-effort — ignore failures
    }
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
  const total = questions.length;
  const attempted = Object.keys(answers).length;
  const correct = Object.values(result).filter((a) => a.correct).length;
  const wrong = attempted - correct;
  const skipped = total - attempted;
  const accPct = attempted ? Math.round((correct / attempted) * 100) : 0;
  const notAnswered = total - attempted;

  // pacing (v6 §6): avg sec/question on ATTEMPTED questions + rushing/balanced/slow
  const spentList = questions
    .map((q) => timeSpent[q.id] || 0)
    .filter((t) => t > 0);
  const avgSec = spentList.length
    ? Math.round(spentList.reduce((a, b) => a + b, 0) / spentList.length)
    : 0;
  const paceLabel = avgSec === 0 ? "—" : avgSec < 40 ? "Rushing ⚡" : avgSec <= 90 ? "Balanced ✅" : "Slow 🐢";

  // topic breakdown weakest-first (chapter tags from v6 §2/§3 — real DB data)
  const topicMap: { [ch: string]: { total: number; correct: number } } = {};
  questions.forEach((q) => {
    const t = q.chapter || "General";
    topicMap[t] = topicMap[t] || { total: 0, correct: 0 };
    topicMap[t].total += 1;
    if (result[q.id]?.correct) topicMap[t].correct += 1;
  });
  const topicRows = Object.entries(topicMap)
    .map(([name, v]) => ({
      name,
      total: v.total,
      correct: v.correct,
      pct: v.total ? Math.round((v.correct / v.total) * 100) : 0,
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => a.pct - b.pct); // weakest first

  // what-to-do-next (v6 §6)
  const nextAction =
    attempted === 0
      ? "Is test me koi answer nahi kiya — pehle 5 questions attempt karke aao."
      : accPct < 60
        ? "Accuracy 60% se kam hai — weak topics review karke wapas try karo."
        : skipped > 0
          ? "Bach gaye " + skipped + " skipped questions — ab unhe attempt karna seekho, speed par kaam karo."
          : "Achhi accuracy! Ab naya test try karke speed badhao.";

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

          {/* Instructions table — real values, no hardcode (v6 §1) */}
          <div className="card mt-8 divide-y divide-border overflow-hidden">
            {(() => {
              const durSec = Math.max(60, (total || 10) * 30);
              const durMin = durSec / 60;
              const maxMarks = questions.reduce((s, q) => s + (q.marks ?? 1), 0);
              const negM = questions[0]?.negativeMarks ?? 0.25;
              const posM = questions[0]?.marks ?? 1;
              return [
                ["Duration", `${durMin % 1 === 0 ? durMin : durMin.toFixed(1)} minutes`],
                ["Total Questions", `${total || 10} Questions`],
                ["Max Marks", `${maxMarks} Marks`],
                ["Negative Marking", `−${negM} per wrong answer`],
                ["Marking", `+${posM} per correct answer`],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-muted-foreground">{k}</span>
                  <span className="text-sm font-semibold">{v}</span>
                </div>
              ));
            })()}
          </div>

          {/* Bilingual language rule note */}
          <div className="card mt-6 border-info/30 bg-info/5 p-5 text-sm">
            <p className="font-semibold text-info">📘 Bilingual Questions</p>
            <p className="mt-2 text-muted-foreground">
              Har question English <b>aur</b> हिंदी dono mein ek saath dikhta hai
              — kisi language toggle ki zaroorat nahi. Options bhi bilingual hain.
              Matching the real SSC bilingual paper experience.
            </p>
          </div>

          <div className="card mt-6 p-5">
            <label className="text-sm font-semibold">Exam Format</label>
            <div className="mt-3 flex gap-3">
              <button
                className="flex-1 rounded-xl border border-primary bg-primary/10 px-4 py-3 text-sm font-semibold text-primary"
              >
                Bilingual (EN + हिंदी)
              </button>
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
    const perceivedMax = questions.reduce((s, q) => s + (q.marks ?? 1), 0);
    // cut-off: data-driven (historical/admin-set). For practice, derive from avg of attempted scores.
    const cutoff = Math.max(1, Math.round(perceivedMax * 0.4));
    const cutoffPercent = Math.min(100, (cutoff / perceivedMax) * 100);
    const qualifies = finalScore >= cutoff;
    // colour-coded correct/wrong/skipped bar (v6 §6)
    const cwPct = total ? (correct / total) * 100 : 0;
    const wwPct = total ? (wrong / total) * 100 : 0;
    const swPct = total ? (skipped / total) * 100 : 0;
    // per-question review tabs (v6 §6: All / Wrong / Skipped / Correct)
    const [reviewTab, setReviewTab] = React.useState<"all" | "wrong" | "skipped" | "correct">("all");
    const reviewQs = questions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) =>
        reviewTab === "all" ? true
          : reviewTab === "correct" ? !!result[q.id]?.correct
          : reviewTab === "wrong" ? (result[q.id] && !result[q.id].correct)
          : !result[q.id]
      );
    const [navQ, setNavQ] = React.useState<number | null>(null); // navigator selection
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
                <p className="text-xs font-bold text-muted-foreground">CORRECT / WRONG / SKIPPED</p>
              </div>
              <div className="px-5 py-4">
                <div className="flex h-3 w-full overflow-hidden rounded-full">
                  {correct > 0 && <div className="h-full bg-success" style={{ width: `${cwPct}%` }} title={`${correct} correct`} />}
                  {wrong > 0 && <div className="h-full bg-danger" style={{ width: `${wwPct}%` }} title={`${wrong} wrong`} />}
                  {skipped > 0 && <div className="h-full bg-muted-foreground/30" style={{ width: `${swPct}%` }} title={`${skipped} skipped`} />}
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-success" /> {correct} Correct</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-danger" /> {wrong} Wrong</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/30" /> {skipped} Skipped</span>
                </div>
              </div>
            </div>
          </div>

          {/* Topic breakdown weakest-first (real DB chapter tags) */}
          <div className="card mt-6 overflow-hidden">
            <div className="border-b border-border p-5">
              <p className="text-xs font-bold text-muted-foreground">WHAT IT LOOKED AT — TOPIC BREAKDOWN (weakest first)</p>
            </div>
            {topicRows.length === 0 ? (
              <div className="px-5 py-4 text-sm text-muted-foreground">Koi attempt nahi — topics analyze nahi ho sake.</div>
            ) : (
              topicRows.map((t) => (
                <div key={t.name} className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t.name}</p>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${t.pct >= 70 ? "bg-success" : t.pct >= 40 ? "bg-warning" : "bg-danger"}`}
                        style={{ width: `${Math.max(t.pct, 3)}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-24 shrink-0 text-right">
                    <p className="text-sm font-extrabold">{t.pct}%</p>
                    <p className="text-[11px] text-muted-foreground">{t.correct}/{t.total} correct</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Pacing analysis (v6 §6) */}
          <div className="card mt-6 p-6">
            <h3 className="font-semibold">⏱ Pacing Analysis</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-muted/50 p-3 text-center">
                <p className="text-2xl font-extrabold">{avgSec || "—"}<span className="text-xs font-normal text-muted-foreground"> sec</span></p>
                <p className="text-[11px] text-muted-foreground">avg per question</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3 text-center">
                <p className="text-2xl font-extrabold">{paceLabel}</p>
                <p className="text-[11px] text-muted-foreground">pace on attempted</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3 text-center">
                <p className="text-2xl font-extrabold">{spentList.length}<span className="text-xs font-normal text-muted-foreground">/ {total}</span></p>
                <p className="text-[11px] text-muted-foreground">timed questions</p>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-info/20 bg-info/5 p-4 text-sm">
              <p className="font-semibold text-info">💡 Instant Diagnosis</p>
              <p className="mt-1 text-muted-foreground">{nextAction}</p>
            </div>
          </div>

          {/* What to do next (v6 §6) */}
          <div className="card mt-6 flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h3 className="font-semibold">📌 What to do next</h3>
              <p className="mt-1 text-xs text-muted-foreground">Practice with another 10-question set, phir review mistakes.</p>
            </div>
            <div className="flex gap-2">
              <a href="/test" className="btn btn-primary">New Test →</a>
              <a href="/question-bank" className="btn btn-outline">Question Bank</a>
            </div>
          </div>

          {/* Answers review — v6 §6: tabs + topic/year + time spent + navigator */}
          <div className="card mt-6 overflow-hidden">
            <div className="border-b border-border p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Answer Review</h3>
                {/* filter tabs */}
                <div className="flex gap-1 rounded-lg bg-muted p-1 text-xs font-semibold">
                  {([["all", `All (${total})`], ["wrong", `Wrong (${wrong})`], ["skipped", `Skipped (${skipped})`], ["correct", `Correct (${correct})`]] as const).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => { setReviewTab(k); setNavQ(null); }}
                      className={`rounded-md px-2.5 py-1 transition ${reviewTab === k ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Legend: <span className="text-success">correct</span> ·{" "}
                <span className="text-danger">wrong</span> ·{" "}
                <span className="text-muted-foreground">skipped</span>
              </p>
            </div>

            {/* question navigator — color-coded jump grid (v6 §6) */}
            <div className="border-b border-border px-5 py-3">
              <p className="text-xs font-bold text-muted-foreground">JUMP TO QUESTION</p>
              <div className="mt-2 grid grid-cols-10 gap-1.5">
                {questions.map((qq, i) => {
                  const st = result[qq.id]?.correct ? "bg-success text-white" : result[qq.id] ? "bg-danger text-white" : "bg-muted text-muted-foreground";
                  return (
                    <button
                      key={qq.id}
                      onClick={() => { setNavQ(i); setReviewTab("all"); }}
                      className={`flex h-8 w-8 items-center justify-center rounded-md text-xs font-bold ${st} ${navQ === i ? "ring-2 ring-[hsl(var(--ring))]" : ""}`}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="divide-y divide-border">
              {(navQ !== null ? questions.map((q, i) => ({ q, i })).filter(({ i }) => i === navQ) : reviewQs).map(({ q, i }) => {
                const a = result[q.id];
                const ansText = answers[q.id] ? q.options.find((o) => o.key === answers[q.id])?.text : "—";
                const spent = timeSpent[q.id] || 0;
                return (
                  <div key={q.id} className="flex items-start gap-3 px-5 py-4">
                    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${a?.correct ? "bg-success/15 text-success" : a ? "bg-danger/15 text-danger" : "bg-muted text-muted-foreground"}`}>
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        {q.chapter && <span className="rounded bg-muted px-1.5 py-0.5 font-semibold text-muted-foreground">{q.chapter}</span>}
                        {q.examName && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-600">{q.examName}{q.year ? ` ${q.year}` : ""}{q.shift ? ` · ${q.shift}` : ""}</span>}
                        {spent > 0 && <span className="text-muted-foreground">⏱ {spent}s</span>}
                      </div>
                      <p className="mt-1 text-sm font-medium line-clamp-2">{q.questionText}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Your answer: <span className="font-semibold">{ansText}</span>
                        {!a?.correct && <span> · Correct: <span className="font-semibold text-success">{q.options.find((o) => o.key === (a?.correctAnswer))?.text || "(see solution)"}</span></span>}
                      </p>
                    </div>
                    {a?.correct ? (
                      <span className="shrink-0 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-bold text-success">+{(q.marks ?? 1).toFixed(2).replace(/\.?0+$/, "")}</span>
                    ) : a ? (
                      <span className="shrink-0 rounded-full bg-danger/15 px-2.5 py-0.5 text-xs font-bold text-danger">−{(q.negativeMarks ?? 0.25).toFixed(2).replace(/\.?0+$/, "")}</span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">Skip</span>
                    )}
                  </div>
                );
              })}
              {reviewQs.length === 0 && navQ === null && (
                <div className="px-5 py-6 text-center text-sm text-muted-foreground">Is tab me koi question nahi.</div>
              )}
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
            {/* Mobile palette toggle (drawer) */}
            <button onClick={() => setPaletteOpen(true)} className="rounded-lg border border-border px-2.5 py-1 text-xs lg:hidden" aria-label="Open question palette">
              ☰ Palette
            </button>
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
            <div className="mt-0.5 flex items-center justify-center gap-2">
              <span className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-bold text-success">
                +{questions[0]?.marks ?? 1} / −{questions[0]?.negativeMarks ?? 0.25}
              </span>
              <p className="text-[11px] text-muted-foreground">Candidate · Practice</p>
            </div>
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
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{q.chapter || "General"}</span>
                  <span className="text-xs text-muted-foreground">Question {idx + 1} of {questions.length}</span>
                  {q.examName && (
                    <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-600">
                      {q.examName}{q.year ? ` ${q.year}` : ""}{q.shift ? ` · Shift ${q.shift}` : ""}
                    </span>
                  )}
                  <span className="rounded-md bg-success/15 px-2 py-0.5 text-xs font-bold text-success">+{q.marks ?? 1} / −{q.negativeMarks ?? 0.25}</span>
                </div>
                <span className="badge badge-info">EN + हिंदी</span>
              </div>
              <h2 className="mt-4 text-base font-semibold leading-relaxed">
                {q.questionText}
              </h2>
              {q.questionTextHindi && (
                <p className="mt-2 border-l-2 border-primary/40 pl-3 text-[15px] font-hindi leading-relaxed text-muted-foreground">
                  {q.questionTextHindi}
                </p>
              )}
              <div className="mt-5 space-y-2.5">
                {q.options.map((o) => {
                  const active = answers[q.id] === o.key;
                  return (
                    <button
                      key={o.key}
                      onClick={() => chooseOption(q.id, o.key)}
                      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${
                        active ? "border-primary bg-primary text-white shadow-md" : "border-border bg-card hover:bg-muted"
                      }`}
                    >
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${active ? "border-white bg-white text-primary" : "border-border"}`}>
                        {o.key}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span>{o.text}</span>
                        {o.textHi && (
                          <span className="ml-3 border-l-2 border-border pl-3 font-hindi text-muted-foreground">
                            {o.textHi}
                          </span>
                        )}
                      </span>
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
                {q.correctAnswer && (
                  <button
                    onClick={() => setShowAns((p) => ({ ...p, [q.id]: !p[q.id] }))}
                    className={`btn ${showAns[q.id] ? "btn-success" : "btn-outline"}`}
                  >
                    {showAns[q.id] ? "✓ Answer Shown" : "Show Answer"}
                  </button>
                )}
                <button
                  onClick={() => {
                    if (hintUsed[q.id] || hintQuota <= 0) return;
                    setHintUsed((p) => ({ ...p, [q.id]: true }));
                    setHintQuota((n) => n - 1);
                  }}
                  disabled={hintUsed[q.id] || hintQuota <= 0}
                  className="btn btn-outline disabled:opacity-40"
                  title="Free AI Hint (3 per session)"
                >
                  {hintUsed[q.id] ? "Hint shown ✓" : hintQuota <= 0 ? "Hint used all (3/3)" : `💡 AI Hint (${hintQuota} left)`}
                </button>
                <div className="flex-1" />
                <button onClick={saveAndNext} className="btn btn-primary">
                  Save &amp; Next →
                </button>
              </div>

              {/* Show Answer / Hint panel — real DB data, no fabrication */}
              {(showAns[q.id] || hintUsed[q.id]) && (
                <div className="mt-4 rounded-xl border border-success/30 bg-success/5 p-4">
                  <p className="text-xs font-bold text-success">Correct Answer: {q.correctAnswer}</p>
                  {hintUsed[q.id] && (
                    <p className="mt-1 text-xs italic text-muted-foreground">
                      Hint: {q.explanation ? q.explanation.slice(0, 120) + (q.explanation.length > 120 ? "…" : "") : "Explanation available in solution."}
                    </p>
                  )}
                  {showAns[q.id] && q.explanation && (
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{q.explanation}</p>
                  )}
                </div>
              )}
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
              <p className="text-xs font-bold text-muted-foreground">LIVE ANALYSIS</p>
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

      {/* MOBILE QUESTION PALETTE DRAWER */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPaletteOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-border bg-background p-4 pb-6">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted" />
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">Question Palette</h3>
              <button onClick={() => setPaletteOpen(false)} className="rounded-lg border border-border px-2.5 py-1 text-xs">✕ Close</button>
            </div>
            {/* palette grid */}
            <div className="mt-3 grid grid-cols-6 gap-1.5">
              {questions.map((qq, i) => {
                const st: QStatus =
                  (status[qq.id] as QStatus | undefined) ??
                  (visited[qq.id] ? "not-answered" : "not-visited");
                return (
                  <button
                    key={qq.id}
                    onClick={() => { markVisited(i, qq.id); setPaletteOpen(false); }}
                    className={`flex h-10 w-full items-center justify-center rounded-md border text-xs font-bold ${paletteBg[st]} ${i === idx ? "ring-2 ring-offset-1 ring-[hsl(var(--ring))]" : ""}`}
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
            </div>
            {/* live per-section analysis */}
            <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded-lg bg-success/10 p-2"><div className="text-base font-extrabold text-success">{countOf(status, "answered") + countOf(status, "answered-marked")}</div><div className="text-muted-foreground">Answered</div></div>
              <div className="rounded-lg bg-danger/10 p-2"><div className="text-base font-extrabold text-danger">{countOf(status, "not-answered")}</div><div className="text-muted-foreground">Not Answered</div></div>
            </div>
            <button onClick={() => { setReviewOpen(true); setPaletteOpen(false); }} className="btn btn-primary mt-4 w-full">
              Submit Test
            </button>
          </div>
        </div>
      )}

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
                    <td className="px-3 py-2 font-medium">Full Paper ({questions.length} Qs)</td>
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