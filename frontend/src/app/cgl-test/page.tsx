import { fetchAuth } from "@/lib/api";
"use client";

import * as React from "react";
import {
  CglExam,
  INSTRUCTIONS,
  SECTION_ROW,
  TIMING_NOTES,
  NAV_NOTES,
  ANS_NOTES,
  LANG_NOTES,
} from "./instructions-data";

type Phase = "instructions" | "exam" | "section-break" | "results";

type AnswerMap = { [qid: string]: string };
type StatusMap = { [qid: string]: "answered" | "review" | "visited" | "unvisited" };
type LangMode = "en" | "hi" | "both";

const apiBase = () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
const authHeaders = (): Record<string, string> => {
  const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const fmt = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

export default function CglTestPage() {
  const [phase, setPhase] = React.useState<Phase>("instructions");
  const [exam, setExam] = React.useState<CglExam | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [agreed, setAgreed] = React.useState(false);
  const [lang, setLang] = React.useState<LangMode>("both");

  // exam state
  const [sectionIdx, setSectionIdx] = React.useState(0);
  const [qIdx, setQIdx] = React.useState(0);
  const [answers, setAnswers] = React.useState<AnswerMap>({});
  const [status, setStatus] = React.useState<StatusMap>({});
  const [timeLeft, setTimeLeft] = React.useState(15 * 60);
  const [running, setRunning] = React.useState(false);
  const [finalScore, setFinalScore] = React.useState(0);
  const [sectionScores, setSectionScores] = React.useState<number[]>([]);
  const [attemptId, setAttemptId] = React.useState<string | null>(null);
  // Server-scored attempt result (P0: scoring is server-side only).
  const [result, setResult] = React.useState<any>(null);
  const [submitting, setSubmitting] = React.useState(false);
  // ---- per-question pacing (v6 §6: avg time/question, rushing/balanced/slow) ----
  const [timeSpent, setTimeSpent] = React.useState<{ [qid: string]: number }>({});
  const qEnterRef = React.useRef<{ qid: string; at: number }>({ qid: "", at: 0 });
  React.useEffect(() => {
    const cur = exam?.sections[sectionIdx]?.questions?.[qIdx];
    if (phase !== "exam" || !cur) return;
    qEnterRef.current.qid = cur.id;
    qEnterRef.current.at = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIdx, sectionIdx, phase, exam]);
  const markQuestionTime = (qid: string) => {
    if (qEnterRef.current.qid === qid && qEnterRef.current.at > 0) {
      const spent = Math.round((Date.now() - qEnterRef.current.at) / 1000);
      setTimeSpent((p) => ({ ...p, [qid]: (p[qid] || 0) + Math.max(spent, 0) }));
      qEnterRef.current.at = Date.now();
    }
  };

  // ---- Load exam on first Start ----
  const startExam = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetchAuth(`${apiBase()}/tests/sectional/cgl`, { headers: authHeaders() });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(`Failed to load exam: ${d.message || r.status}`);
        setLoading(false);
        return;
      }
      const d = await r.json();
      setExam(d);
      setSectionIdx(0);
      setQIdx(0);
      setAnswers({});
      setStatus({});
      setTimeLeft(d.sections[0].minutes * 60);
      setRunning(true);
      setPhase("exam");
      // P0: open a server-authoritative attempt — server stamps the deadline.
      try {
        const ar = await fetchAuth(`${apiBase()}/tests/attempts/start`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ testTemplateId: "tpl-cgl-pyq-2024" }),
        });
        const ad = await ar.json();
        setAttemptId(ad.id ?? null);
      } catch {
        setAttemptId(null); // exam still runs; submit will create its own record
      }
    } catch {
      setError("Network error — backend unreachable");
    } finally {
      setLoading(false);
    }
  };

  const sec = exam?.sections[sectionIdx];
  const qs = sec?.questions || [];
  const q = qs[qIdx];

  const allQuestions = (): { id: string }[] =>
    exam ? exam.sections.flatMap((s) => s.questions) : [];

  // ---- Sectional countdown ----
  React.useEffect(() => {
    if (phase !== "exam" || !running) return;
    const t = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(t);
          // auto-submit this section → next
          setTimeout(() => advanceSection(), 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, running, sectionIdx]);

  const advanceSection = () => {
    if (!exam) return;
    markQuestionTime(qs[qIdx]?.id);
    const isLast = sectionIdx >= exam.sections.length - 1;
    if (isLast) {
      computeResults();
    } else {
      setSectionIdx((i) => i + 1);
      setQIdx(0);
      setTimeLeft(exam.sections[sectionIdx + 1].minutes * 60);
      setPhase("section-break");
      setTimeout(() => setPhase("exam"), 2500);
    }
  };

  // ---- Answers / status ----
  const selectOption = (key: string) => {
    if (!q) return;
    setAnswers((p) => ({ ...p, [q.id]: key }));
    setStatus((p) => ({ ...p, [q.id]: "answered" }));
  };

  const markReview = () => {
    if (!q) return;
    setStatus((p) => ({ ...p, [q.id]: p[q.id] === "review" ? "visited" : "review" }));
  };

  const goTo = (i: number) => {
    if (i < 0 || i >= qs.length) return;
    markQuestionTime(qs[qIdx]?.id);
    setQIdx(i);
    setStatus((p) => ({ ...p, [qs[i].id]: p[qs[i].id] || "visited" }));
  };

  const saveNext = () => {
    if (!q) return;
    // answer already saved on select; ensure status
    setStatus((p) => ({ ...p, [q.id]: answers[q.id] ? "answered" : p[q.id] || "visited" }));
    goTo(qIdx + 1);
  };

  const computeResults = async () => {
    if (!exam || submitting) return;
    setSubmitting(true);
    setRunning(false);
    try {
      // P0: submit answers to the server — scoring happens server-side against
      // the DB answer key (client never receives correctAnswer before submit).
      const answersPayload: { questionId: string; selectedOption: string | null; timeSpentSeconds: number }[] = [];
      exam.sections.forEach((s) => {
        s.questions.forEach((qq) => {
          answersPayload.push({
            questionId: qq.id,
            selectedOption: answers[qq.id] ?? null,
            timeSpentSeconds: timeSpent[qq.id] || 0,
          });
        });
      });
      const r = await fetch(
        attemptId
          ? `${apiBase()}/tests/attempts/${attemptId}/submit`
          : `${apiBase()}/tests/attempts`,
        {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(
            attemptId
              ? { answers: answersPayload }
              : {
                  testTemplateId: "tpl-cgl-pyq-2024",
                  answers: answersPayload,
                },
          ),
        },
      );
      const d = await r.json();
      setResult(d);
      setFinalScore(d.score ?? 0);
      // server-scored per-section breakdown
      const perSec = exam.sections.map((s) => {
        let secScore = 0;
        s.questions.forEach((qq) => {
          const a = Array.isArray(d.answers) ? d.answers.find((x: any) => x.questionId === qq.id) : null;
          if (a?.isCorrect) secScore += qq.marks;
          else if (a?.selectedOption) secScore -= qq.negativeMarks;
        });
        return secScore;
      });
      setSectionScores(perSec);
    } catch {
      setFinalScore(0);
      setSectionScores(exam.sections.map(() => 0));
    } finally {
      setSubmitting(false);
      setPhase("results");
    }
  };

  // ---- Render: instructions ----
  if (phase === "instructions") {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
          <div className="mx-auto flex max-w-4xl items-center justify-between">
            <a href="/dashboard" className="text-lg font-bold">← <span className="text-primary">SSC</span>PrepHub</a>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-8">
          <div className="card p-6">
            <h1 className="text-xl font-bold">SSC CGL Tier 1 - Based on 2025</h1>
            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-sm font-semibold">1. Exam Overview / परीक्षा का संक्षिप्त विवरण</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {INSTRUCTIONS.map((i, n) => (
                  <li key={n}>• {i.en} <span className="text-foreground/60">/ {i.hi}</span></li>
                ))}
              </ul>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="py-1 pr-2">Section</th>
                      <th className="py-1 pr-2">Subject</th>
                      <th className="py-1 pr-2">Questions</th>
                      <th className="py-1 pr-2">Max Marks</th>
                      <th className="py-1">Timer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SECTION_ROW.map((r) => (
                      <tr key={r.part} className="border-b border-border/50">
                        <td className="py-1 pr-2">Part {r.part}</td>
                        <td className="py-1 pr-2">{r.name}</td>
                        <td className="py-1 pr-2">{r.q}</td>
                        <td className="py-1 pr-2">{r.marks}</td>
                        <td className="py-1">{r.min} minutes</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <NoteBlock title="2. Timing & Submission / समय और उत्तर जमा करना" items={TIMING_NOTES} />
            <NoteBlock title="3. Language / भाषा" items={LANG_NOTES} />
            <NoteBlock title="4. Navigation / नेविगेशन" items={NAV_NOTES} />
            <NoteBlock title="5. Answering / उत्तर देना" items={ANS_NOTES} />
            <NoteBlock
              title="6. Additional Notes / अतिरिक्त निर्देश"
              items={[
                { en: "The system saves responses for each question and auto-submits the section when its specific time ends.", hi: "हर उत्तर स्वचालित रूप से सिस्टम में सुरक्षित होता है और उसका विशिष्ट समय समाप्त होने पर अनुभाग स्वतः जमा हो जाता है।" },
                { en: "Maintain silence in the exam hall and do not engage in any communication with other candidates.", hi: "परीक्षा कक्ष में शांति बनाए रखें और अन्य उम्मीदवारों से बात न करें।" },
                { en: "Bathroom breaks or leaving your seat are not allowed during the exam.", hi: "परीक्षा के दौरान बाथरूम ब्रेक या सीट छोड़ने की अनुमति नहीं है।" },
              ]}
            />

            <div className="mt-6 flex items-center justify-between">
              <a href="/dashboard" className="btn border border-border px-5 py-2 text-sm hover:bg-muted">Back</a>
              <button
                onClick={startExam}
                disabled={loading}
                className="btn bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Loading…" : "I Agree, Start Exam"}
              </button>
            </div>
            {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          </div>
        </main>
      </div>
    );
  }

  // ---- Render: section break (auto-advance notice) ----
  if (phase === "section-break" && exam) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-center text-foreground">
        <div>
          <p className="text-2xl">⏱️</p>
          <h2 className="mt-3 text-xl font-bold">
            Section {exam.sections[sectionIdx]?.part} Complete
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Part {exam.sections[sectionIdx - 1]?.part} ({exam.sections[sectionIdx - 1]?.name}) auto-submitted —
            starting <b>Part {exam.sections[sectionIdx]?.part}</b> ({exam.sections[sectionIdx]?.name})…
          </p>
        </div>
      </div>
    );
  }

  // ---- Render: results ----
  if (phase === "results" && exam) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto max-w-3xl px-4 py-10">
          <div className="card p-6 text-center">
            <p className="text-4xl">🎉</p>
            <h1 className="mt-2 text-2xl font-bold">Exam Complete — Thank You!</h1>
            <p className="mt-1 text-sm text-muted-foreground">SSC CGL Tier 1 (Based on 2025) · 100 Qs · 200 Marks</p>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total Score" value={`${finalScore.toFixed(1)}`} />
              <Stat label="Correct" value={String(result?.totalCorrect ?? 0)} />
              <Stat label="Wrong" value={String(result?.totalWrong ?? 0)} />
              <Stat label="Skipped" value={String(result?.totalSkipped ?? 0)} />
            </div>
            {submitting && <p className="mt-3 text-sm text-muted-foreground">Scoring on server…</p>}
            <h3 className="mt-6 text-left text-sm font-semibold">Section-wise Score</h3>
            <div className="mt-2 space-y-2 text-left">
              {exam.sections.map((s, i) => (
                <div key={s.part} className="flex items-center justify-between rounded-lg border border-border px-4 py-2 text-sm">
                  <span>Part {s.part} — {s.name}</span>
                  <span className="font-bold">{sectionScores[i]?.toFixed(1) ?? "0.0"} / {s.marks}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-center gap-3">
              <a href="/dashboard" className="btn border border-border px-5 py-2 text-sm hover:bg-muted">Dashboard</a>
              <a href="/cgl-test" className="btn bg-primary px-5 py-2 text-sm text-primary-foreground hover:opacity-90">Retake</a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ---- Render: exam view ----
  if (!exam || !sec || !q) {
    return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  }

  const isEnglishOnly = sec.subjectSlug === "english";
  const effectiveLang: LangMode = isEnglishOnly ? "en" : lang;
  const stem = effectiveLang === "hi" ? (q.questionTextHindi || q.questionText) : q.questionText;
  const stemExtra = effectiveLang === "both" && q.questionTextHindi ? q.questionTextHindi : null;
  const optText = (o: { key: string; text: string; textHi: string | null }) =>
    effectiveLang === "hi" ? (o.textHi || o.text) : effectiveLang === "both" ? `${o.text}${o.textHi ? ` / ${o.textHi}` : ""}` : o.text;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar: exam title + timer */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-lg">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">SSC CGL Tier 1</p>
            <p className="text-xs text-muted-foreground">
              Part {sec.part} — {sec.name} · Q {qIdx + 1}/{qs.length}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {!isEnglishOnly && (
              <div className="flex overflow-hidden rounded-lg border border-border text-xs">
                {(["en", "hi", "both"] as LangMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setLang(m)}
                    className={`px-2.5 py-1.5 ${lang === m ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
                  >
                    {m === "en" ? "EN" : m === "hi" ? "हिंदी" : "EN+HI"}
                  </button>
                ))}
              </div>
            )}
            <div className={`rounded-lg px-3 py-1.5 font-mono text-sm font-bold ${timeLeft < 60 ? "bg-danger/15 text-danger" : "bg-card"}`}>
              ⏱ {fmt(timeLeft)}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Question card */}
          <div className="flex-1">
            <div className="card p-6">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Q{qIdx + 1} · {q.marks} marks · {q.negativeMarks} neg
                  {q.examName ? ` · ${q.examName}` : ""}
                  {q.year ? ` · ${q.year}` : ""}
                </p>
                <button
                  onClick={markReview}
                  className={`rounded-lg border px-3 py-1 text-xs font-semibold ${
                    status[q.id] === "review"
                      ? "border-amber-500 bg-amber-500/15 text-amber-600"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {status[q.id] === "review" ? "★ Marked" : "☆ Mark for Review"}
                </button>
              </div>

              <h2 className="mt-3 text-base font-medium leading-relaxed">{stem}</h2>
              {stemExtra && <h3 className="mt-1 text-base leading-relaxed text-muted-foreground">{stemExtra}</h3>}

              <div className="mt-5 space-y-3">
                {q.options.map((o) => {
                  const selected = answers[q.id] === o.key;
                  return (
                    <button
                      key={o.key}
                      onClick={() => selectOption(o.key)}
                      className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left text-sm transition ${
                        selected ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"
                      }`}
                    >
                      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                        selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                      }`}>
                        {o.key}
                      </span>
                      <span className="leading-relaxed">{optText(o)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Nav buttons */}
            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => goTo(qIdx - 1)}
                disabled={qIdx === 0}
                className="btn border border-border px-5 py-2 text-sm hover:bg-muted disabled:opacity-40"
              >
                ← Previous
              </button>
              <button
                onClick={saveNext}
                className="btn bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                {qIdx === qs.length - 1 ? (sectionIdx === exam.sections.length - 1 ? "Submit Exam" : "End Section") : "Save & Next →"}
              </button>
            </div>
          </div>

          {/* Palette */}
          <aside className="w-full shrink-0 lg:w-64">
            <div className="card sticky top-20 p-4">
              <p className="text-xs font-semibold text-muted-foreground">Question Palette — Part {sec.part}</p>
              <div className="mt-3 grid grid-cols-5 gap-1.5">
                {qs.map((qq, i) => {
                  const st = status[qq.id];
                  const cls =
                    st === "answered" ? "bg-green-600 text-white" :
                    st === "review" ? "bg-amber-500 text-white" :
                    st === "visited" ? "bg-border text-foreground" : "bg-muted text-muted-foreground";
                  return (
                    <button
                      key={qq.id}
                      onClick={() => goTo(i)}
                      className={`h-8 rounded-md text-xs font-bold ${cls} ${i === qIdx ? "ring-2 ring-primary" : ""}`}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 space-y-1 text-[11px] text-muted-foreground">
                <p><span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-600 align-middle" /> Answered</p>
                <p><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500 align-middle" /> Marked for Review</p>
                <p><span className="inline-block h-2.5 w-2.5 rounded-sm bg-border align-middle" /> Visited</p>
                <p><span className="inline-block h-2.5 w-2.5 rounded-sm bg-muted align-middle" /> Not visited</p>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

// ---- Helpers ----
function NoteBlock({ title, items }: { title: string; items: { en: string; hi: string }[] }) {
  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        {items.map((i, n) => (
          <li key={n}>
            • {i.en} <span className="text-foreground/60">/ {i.hi}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
