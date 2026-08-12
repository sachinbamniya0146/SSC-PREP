import { fetchAuth } from "@/lib/api";
"use client";

import * as React from "react";
import { useParams } from "next/navigation";

type ReviewQuestion = {
  questionId: string;
  questionText: string;
  questionTextHindi: string | null;
  options: { key: string; text: string; textHi: string | null }[];
  selectedOption: string | null;
  correctAnswer: string;
  isCorrect: boolean;
  isSkipped: boolean;
  isMarkedForReview: boolean;
  timeSpentSeconds: number;
  explanation: string | null;
  explanationHindi: string | null;
  explanationSource?: string | null;
  examName?: string;
  chapter: string | null;
  subject: string | null;
  year?: number | null;
  shift?: string | null;
  difficulty?: string | null;
  marks: number;
  negativeMarks: number;
};

type AttemptDetail = {
  id: string;
  userId?: string;
  testTemplateId?: string;
  score: number;
  totalCorrect: number;
  totalWrong: number;
  totalSkipped: number;
  accuracyPercent: number;
  rank?: number | null;
  percentile?: number | null;
  submittedAt: string;
  testTemplate: { id: string; title: string; totalQuestions: number; totalMarks: number };
  topper?: { score: number | null; accuracyPercent: number | null } | null;
  questions: ReviewQuestion[];
};

type Filter = "all" | "wrong" | "skipped" | "correct";

const apiBase = () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
const authHeaders = (): Record<string, string> => {
  const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
const fmtTime = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

export default function AttemptReviewPage() {
  const params = useParams<{ attemptId: string }>();
  const [detail, setDetail] = React.useState<AttemptDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [lang, setLang] = React.useState<"en" | "both">("both");
  // v6 §6 — per-template stats (real cutoff P90 + top-5 toppers)
  const [stats, setStats] = React.useState<any>(null);

  React.useEffect(() => {
    if (!params?.attemptId) return;
    (async () => {
      try {
        const r = await fetchAuth(`${apiBase()}/tests/attempts/${params.attemptId}`, { headers: authHeaders() });
        if (!r.ok) {
          setError(r.status === 401 ? "Login required" : `Failed to load attempt (${r.status})`);
          return;
        }
        const d = await r.json();
        setDetail(d);
        // best-effort stats fetch (real cutoff + toppers for this template)
        if (d?.testTemplateId) {
          fetchAuth(`${apiBase()}/tests/stats/${d.testTemplateId}`, { headers: authHeaders() })
            .then((r) => (r.ok ? r.json() : null))
            .then((s) => s && setStats(s))
            .catch(() => null);
        }
      } catch {
        setError("Network error — backend unreachable");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.attemptId]);

  if (loading) return <div className="p-10 text-center text-muted-foreground">Loading attempt…</div>;
  if (error || !detail) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="card p-8 text-center">
          <p className="text-2xl">😕</p>
          <p className="mt-2 text-sm text-danger">{error || "Attempt not found"}</p>
          <a href="/results" className="btn mt-4 border border-border px-4 py-2 text-sm">← Back to Results</a>
        </div>
      </div>
    );
  }

  const { testTemplate: tpl, questions } = detail;
  const maxScore = tpl.totalMarks || questions.reduce((s, q) => s + (q.marks || 2), 0);
  const pct = maxScore ? ((detail.score / maxScore) * 100).toFixed(1) : "0.0";

  // v6 §6 — topic breakdown, weakest-first (chapter/subject labels)
  const topicMap = new Map<string, { correct: number; total: number; time: number }>();
  const sectionMap = new Map<string, { correct: number; total: number; score: number; time: number }>();
  questions.forEach((q) => {
    const t = q.chapter || q.subject || "General";
    const cur = topicMap.get(t) || { correct: 0, total: 0, time: 0 };
    cur.total += 1;
    if (q.isCorrect) cur.correct += 1;
    cur.time += q.timeSpentSeconds || 0;
    topicMap.set(t, cur);
    // section-wise (subject) aggregation for exam-style breakdown
    const s = q.subject || "General";
    const sc = sectionMap.get(s) || { correct: 0, total: 0, score: 0, time: 0 };
    sc.total += 1;
    if (q.isCorrect) { sc.correct += 1; sc.score += q.marks || 2; }
    else if (q.selectedOption) sc.score -= q.negativeMarks || 0.5;
    sc.time += q.timeSpentSeconds || 0;
    sectionMap.set(s, sc);
  });
  const sections = Array.from(sectionMap.entries()).map(([name, v]) => ({
    name,
    ...v,
    acc: v.total ? Math.round((v.correct / v.total) * 100) : 0,
  }));
  const topics = Array.from(topicMap.entries())
    .map(([name, v]) => ({ name, ...v, acc: v.total ? Math.round((v.correct / v.total) * 100) : 0 }))
    .sort((a, b) => a.acc - b.acc);
  const filtered =
    filter === "wrong" ? questions.filter((q) => !q.isCorrect && !q.isSkipped)
    : filter === "skipped" ? questions.filter((q) => q.isSkipped)
    : filter === "correct" ? questions.filter((q) => q.isCorrect)
    : questions;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <a href="/results" className="text-lg font-bold">← <span className="text-primary">SSC</span>PrepHub</a>
          <div className="flex items-center gap-3">
            <div className="flex overflow-hidden rounded-lg border border-border text-xs">
              {(["en", "both"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setLang(m)}
                  className={`px-2.5 py-1.5 ${lang === m ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
                >
                  {m === "en" ? "EN" : "EN+हिंदी"}
                </button>
              ))}
            </div>
            <a href="/test" className="btn border border-border px-4 py-1.5 text-sm hover:bg-muted">New Test</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">📊 Result Review</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tpl.title} · {fmt(detail.submittedAt)}
        </p>

        {/* Summary cluster */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label="Score" value={`${detail.score}`} sub={`/ ${maxScore} (${pct}%)`} tone="primary" />
          <SummaryCard label="Rank" value={detail.rank ? `#${detail.rank}` : "—"} sub="in this test" tone="rank" />
          <SummaryCard label="Percentile" value={detail.percentile != null ? `${detail.percentile}%` : "—"} sub="vs all attempts" tone="rank" />
          <SummaryCard label="Accuracy" value={`${detail.accuracyPercent}%`} sub="on attempted" tone="primary" />
        </div>

        {/* Topper benchmark + pacing (v6 §6) */}
        {detail.topper?.score != null && (
          <div className="card mt-4 flex flex-wrap items-center justify-between gap-3 border-primary/20 bg-primary/5 p-5">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🏆</span>
              <div>
                <p className="text-sm font-semibold">Topper Benchmark</p>
                <p className="text-xs text-muted-foreground">
                  Best score in this test: <b>{detail.topper.score}</b>
                  {detail.topper.accuracyPercent != null && <> · top accuracy {detail.topper.accuracyPercent}%</>}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Your gap to topper</p>
              <p className="text-lg font-bold text-primary">
                {Math.max(0, Number((Number(detail.topper.score) - detail.score).toFixed(1)))} marks
              </p>
            </div>
          </div>
        )}

        {/* v6 §6 — real stats: cutoff (P90, data-driven) + top-5 toppers */}
        {stats && stats.attempts > 0 && (
          <div className="card mt-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold">📈 Real Stats — {stats.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {stats.attempts} attempts · avg score <b>{stats.avgScore}</b> · avg accuracy{" "}
                  <b>{stats.avgAccuracy}%</b>
                </p>
              </div>
              <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Cutoff (90th percentile)
                </p>
                <p className="text-xl font-extrabold text-primary">{stats.cutoffScore}</p>
                <p className="text-[10px] text-muted-foreground">
                  {stats.cutoffLabel}{detail.score >= stats.cutoffScore && stats.hasEnoughData ? " · ✅ you crossed it" : ""}
                </p>
              </div>
            </div>
            {stats.toppers.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="pb-1.5 pr-3 font-semibold">#</th>
                      <th className="pb-1.5 pr-3 font-semibold">Student</th>
                      <th className="pb-1.5 pr-3 font-semibold">Score</th>
                      <th className="pb-1.5 pr-3 font-semibold">Accuracy</th>
                      <th className="pb-1.5 font-semibold">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.toppers.map((t: any, i: number) => {
                      const isYou = t.userId === detail.userId;
                      return (
                        <tr key={i} className={isYou ? "bg-primary/10 font-semibold" : ""}>
                          <td className="py-1.5 pr-3">{i + 1}</td>
                          <td className="py-1.5 pr-3">{isYou ? `${t.fullName} (you)` : t.fullName}</td>
                          <td className="py-1.5 pr-3">{t.score}</td>
                          <td className="py-1.5 pr-3">{t.accuracyPercent}%</td>
                          <td className="py-1.5">{fmtTime(t.durationSec)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!stats.hasEnoughData && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Cutoff needs ≥10 attempts to be meaningful — keep practicing, more data is coming in.
              </p>
            )}
          </div>
        )}

        {/* Correct / wrong / skipped bar */}
        <div className="card mt-4 p-5">
          <div className="flex h-3 w-full overflow-hidden rounded-full">
            <div className="bg-success" style={{ width: `${(detail.totalCorrect / Math.max(questions.length, 1)) * 100}%` }} />
            <div className="bg-danger" style={{ width: `${(detail.totalWrong / Math.max(questions.length, 1)) * 100}%` }} />
            <div className="bg-muted" style={{ width: `${(detail.totalSkipped / Math.max(questions.length, 1)) * 100}%` }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-success" /> {detail.totalCorrect} correct</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-danger" /> {detail.totalWrong} wrong</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-muted" /> {detail.totalSkipped} skipped</span>
            <span className="ml-auto">⏱ avg {fmtTime(Math.round(questions.reduce((s, q) => s + (q.timeSpentSeconds || 0), 0) / Math.max(questions.length, 1)))}/Q</span>
          </div>
        </div>

        {/* Section-wise cards (exam-style breakdown) */}
        {sections.length > 1 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {sections.map((s) => (
              <div key={s.name} className="card p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{s.name}</p>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      s.acc < 40 ? "bg-danger/15 text-danger" : s.acc < 70 ? "bg-warning/15 text-warning" : "bg-success/15 text-success"
                    }`}
                  >
                    {s.acc}%
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {s.correct}/{s.total} correct · {s.score.toFixed(1)} marks
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${s.acc < 40 ? "bg-danger" : s.acc < 70 ? "bg-warning" : "bg-success"}`}
                    style={{ width: `${s.acc}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Topic breakdown — weakest first */}
        <div className="card mt-4 p-5">
          <h2 className="text-sm font-bold">📚 Topic Breakdown <span className="font-normal text-muted-foreground">(weakest first)</span></h2>
          <div className="mt-3 space-y-2">
            {topics.map((t) => (
              <div key={t.name} className="flex items-center gap-3 text-sm">
                <span className="w-40 truncate text-muted-foreground">{t.name}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${t.acc < 40 ? "bg-danger" : t.acc < 70 ? "bg-warning" : "bg-success"}`}
                    style={{ width: `${t.acc}%` }}
                  />
                </div>
                <span className="w-24 text-right text-xs text-muted-foreground">{t.correct}/{t.total} · {t.acc}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="mt-6 flex flex-wrap gap-2">
          {(["all", "wrong", "skipped", "correct"] as Filter[]).map((f) => {
            const count =
              f === "wrong" ? detail.totalWrong : f === "skipped" ? detail.totalSkipped : f === "correct" ? detail.totalCorrect : questions.length;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold capitalize ${
                  filter === f ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {f} ({count})
              </button>
            );
          })}
        </div>

        {/* Per-question review list */}
        <div className="mt-4 space-y-4">
          {filtered.length === 0 && (
            <p className="card p-8 text-center text-sm text-muted-foreground">No questions in this filter 🎉</p>
          )}
          {filtered.map((q, i) => (
            <QuestionReview key={q.questionId} q={q} index={i} lang={lang} />
          ))}
        </div>

        {/* Navigator */}
        <div className="card mt-6 p-5">
          <h2 className="text-sm font-bold">🧭 Question Navigator</h2>
          <div className="mt-3 grid grid-cols-8 gap-1.5 sm:grid-cols-10">
            {questions.map((q, i) => {
              const cls = q.isSkipped ? "bg-muted text-muted-foreground" : q.isCorrect ? "bg-success text-white" : "bg-danger text-white";
              return (
                <a
                  key={q.questionId}
                  href={`#q-${i}`}
                  className={`flex h-8 items-center justify-center rounded-md text-xs font-bold ${cls}`}
                >
                  {i + 1}
                </a>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}

// ---- Sub-components ----
function SummaryCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "primary" | "rank" }) {
  return (
    <div className="card p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${tone === "rank" ? "text-amber-500" : "text-primary"}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function QuestionReview({ q, index, lang }: { q: ReviewQuestion; index: number; lang: "en" | "both" }) {
  const showHi = lang === "both";
  const optText = (o: { key: string; text: string; textHi: string | null }) =>
    showHi && o.textHi ? `${o.text} / ${o.textHi}` : o.text;
  const stem = showHi && q.questionTextHindi ? `${q.questionText} / ${q.questionTextHindi}` : q.questionText;
  const explanation = showHi && q.explanationHindi ? `${q.explanation} / ${q.explanationHindi}` : q.explanation;
  const srcLabel =
    q.explanationSource === "AI_GENERATED"
      ? { text: "🤖 AI-generated", cls: "bg-primary/10 text-primary" }
      : q.explanationSource === "HUMAN_VERIFIED"
        ? { text: "✅ Human-verified", cls: "bg-success/10 text-success" }
        : q.explanationSource === "PDF"
          ? { text: "📄 From PDF", cls: "bg-muted text-muted-foreground" }
          : null;

  const badge = q.isSkipped
    ? { text: "Skipped", cls: "bg-muted text-muted-foreground" }
    : q.isCorrect
      ? { text: "Correct", cls: "bg-success/15 text-success" }
      : { text: "Wrong", cls: "bg-danger/15 text-danger" };

  return (
    <div id={`q-${index}`} className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Q{index + 1} · {q.marks || 2} marks{q.examName ? ` · ${q.examName}` : ""}
          {q.year ? ` · ${q.year}` : ""}
          {q.chapter ? ` · ${q.chapter}` : ""}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">⏱ {fmtTime(q.timeSpentSeconds || 0)}</span>
          {/* v5 §40 — fast-wrong / slow-wrong / guess analysis (real timing) */}
          {!q.isSkipped && q.timeSpentSeconds != null && q.timeSpentSeconds > 0 && (
            q.isCorrect && q.timeSpentSeconds < 10 ? (
              <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-600">⚡ fast</span>
            ) : !q.isCorrect && q.timeSpentSeconds >= 120 ? (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-600">🐢 slow-wrong</span>
            ) : !q.isCorrect && q.timeSpentSeconds < 10 ? (
              <span className="rounded-full bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-bold text-fuchsia-600">🎲 guess</span>
            ) : null
          )}
          {q.difficulty && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              q.difficulty === "EASY" ? "bg-success/10 text-success" : q.difficulty === "HARD" ? "bg-danger/10 text-danger" : "bg-muted text-muted-foreground"
            }`}>
              {q.difficulty}
            </span>
          )}
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.cls}`}>{badge.text}</span>
        </div>
      </div>

      <h3 className="mt-3 text-sm font-medium leading-relaxed">{stem}</h3>

      <div className="mt-3 space-y-2">
        {q.options.map((o) => {
          const isSelected = q.selectedOption === o.key;
          const isCorrectOpt = q.correctAnswer === o.key;
          let cls = "border-border bg-card";
          if (isCorrectOpt) cls = "border-success bg-success/10";
          if (isSelected && !isCorrectOpt) cls = "border-danger bg-danger/10";
          return (
            <div key={o.key} className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${cls}`}>
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                isCorrectOpt ? "border-success text-success" : isSelected ? "border-danger text-danger" : "border-border"
              }`}>
                {o.key}
              </span>
              <span className="leading-relaxed">{optText(o)}</span>
              {isCorrectOpt && <span className="ml-auto text-xs font-bold text-success">✓ Answer</span>}
              {isSelected && !isCorrectOpt && <span className="ml-auto text-xs font-bold text-danger">Your choice</span>}
            </div>
          );
        })}
      </div>

      {explanation && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">💡 Explanation: </span>
          {srcLabel && (
            <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${srcLabel.cls}`}>
              {srcLabel.text}
            </span>
          )}
          <span className="block pt-1">{explanation}</span>
        </div>
      )}
    </div>
  );
}
