"use client";
import { fetchAuth } from "@/lib/api";

import * as React from "react";
import { useParams } from "next/navigation";
import { API_BASE } from "@/lib/api";
import DiagramVenn from "@/components/DiagramVenn";
import WeakTopicPractice from "@/components/WeakTopicPractice";
import SubjectChapterAnalysis from "@/components/SubjectChapterAnalysis";
import SolutionVerify from "@/components/SolutionVerify";
import { ScoreHero, ScoreComparison, TimeAnalysis, SubjectBars, RetryPanel } from "@/components/ResultsInsights";
import { StemMedia, QFigure, RichText } from "@/components/QuestionMedia";
import { useT } from "@/lib/i18n";
import { SolutionPanel, ReviewQuestionBody, ReviewLangToggle, useReviewLang, type ReviewLang } from "@/components/SolutionPanel";

type ReviewQuestion = {
  questionId: string;
  questionText: string;
  questionTextHindi: string | null;
  // Session 22 — Venn/figure diagram support (see DiagramVenn.tsx)
  questionDiagramType?: string | null;
  questionDiagramLabels?: (string | null)[] | null;
  // Session 24 — non-Venn diagram stem image
  questionImageUrl?: string | null;
  options: { key: string; text: string; textHi: string | null; diagramType?: string | null; diagramLabels?: (string | null)[] | null; imageUrl?: string | null }[];
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
  topic?: string | null;
  subTopic?: string | null;
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

const apiBase = () => API_BASE;
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
  const [lang, setLang] = useReviewLang();
  // v6 §6 — per-template stats (real cutoff P90 + top-5 toppers)
  const [stats, setStats] = React.useState<any>(null);
  // NEW (Sep 29 2026): topics the student got wrong in THIS attempt + Study-Plan verdict.
  const [planVerdict, setPlanVerdict] = React.useState<any>(null);

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
        fetchAuth(`${apiBase()}/study-plan/attempt/${params.attemptId}/verdict`, { headers: authHeaders() })
          .then((r) => (r.ok ? r.json().catch(() => null) : null))
          .then((v) => v && v.chapters && setPlanVerdict(v))
          .catch(() => null);
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

  // v6 §6 — chapter breakdown, weakest-first (chapter/subject labels)
  const chapterMap = new Map<string, { correct: number; total: number; time: number }>();
  const sectionMap = new Map<string, { correct: number; total: number; score: number; time: number }>();
  // NEW (Sep 21 2026) — TRUE topic/sub-topic breakdown (drills below chapter
  // level, straight from each question's real topic/subTopic). Older
  // questions with no topic set are grouped under "Other (no topic set)" so
  // they're never silently dropped from the analysis.
  const realTopicMap = new Map<string, { correct: number; total: number; time: number }>();
  const subTopicMap = new Map<string, { correct: number; total: number; time: number }>();
  questions.forEach((q) => {
    const t = q.chapter || q.subject || "General";
    const cur = chapterMap.get(t) || { correct: 0, total: 0, time: 0 };
    cur.total += 1;
    if (q.isCorrect) cur.correct += 1;
    cur.time += q.timeSpentSeconds || 0;
    chapterMap.set(t, cur);
    // section-wise (subject) aggregation for exam-style breakdown
    const s = q.subject || "General";
    const sc = sectionMap.get(s) || { correct: 0, total: 0, score: 0, time: 0 };
    sc.total += 1;
    if (q.isCorrect) { sc.correct += 1; sc.score += q.marks || 2; }
    else if (q.selectedOption) sc.score -= q.negativeMarks || 0.5;
    sc.time += q.timeSpentSeconds || 0;
    sectionMap.set(s, sc);
    if (q.topic) {
      const rt = realTopicMap.get(q.topic) || { correct: 0, total: 0, time: 0 };
      rt.total += 1;
      if (q.isCorrect) rt.correct += 1;
      rt.time += q.timeSpentSeconds || 0;
      realTopicMap.set(q.topic, rt);
      if (q.subTopic) {
        const st = subTopicMap.get(`${q.topic} › ${q.subTopic}`) || { correct: 0, total: 0, time: 0 };
        st.total += 1;
        if (q.isCorrect) st.correct += 1;
        st.time += q.timeSpentSeconds || 0;
        subTopicMap.set(`${q.topic} › ${q.subTopic}`, st);
      }
    }
  });
  const sections = Array.from(sectionMap.entries()).map(([name, v]) => ({
    name,
    ...v,
    acc: v.total ? Math.round((v.correct / v.total) * 100) : 0,
  }));
  const topics = Array.from(chapterMap.entries())
    .map(([name, v]) => ({ name, ...v, acc: v.total ? Math.round((v.correct / v.total) * 100) : 0 }))
    .sort((a, b) => a.acc - b.acc);
  const realTopics = Array.from(realTopicMap.entries())
    .map(([name, v]) => ({ name, ...v, acc: v.total ? Math.round((v.correct / v.total) * 100) : 0 }))
    .sort((a, b) => a.acc - b.acc);
  const subTopics = Array.from(subTopicMap.entries())
    .map(([name, v]) => ({ name, ...v, acc: v.total ? Math.round((v.correct / v.total) * 100) : 0 }))
    .sort((a, b) => a.acc - b.acc);
  // Jump to a question in the review list (switches the filter back to "all" first so the anchor exists).
  const jumpTo = (i: number) => {
    setFilter("all");
    window.setTimeout(() => {
      document.getElementById(`q-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };
  const totalTimeSec = questions.reduce((a, q) => a + (q.timeSpentSeconds || 0), 0);
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
            <ReviewLangToggle lang={lang} onChange={setLang} />
            <a href="/test" className="btn border border-border px-4 py-1.5 text-sm hover:bg-muted">New Test</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">📊 Result Review</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tpl.title} · {fmt(detail.submittedAt)}
        </p>

        {/* Summary: score ring, rank, percentile, accuracy, time */}
        <div className="mt-6">
          <ScoreHero
            title={tpl.title}
            score={detail.score}
            max={maxScore}
            rank={detail.rank}
            percentile={detail.percentile}
            accuracy={detail.accuracyPercent}
            correct={detail.totalCorrect}
            wrong={detail.totalWrong}
            skipped={detail.totalSkipped}
            totalTimeSec={totalTimeSec}
          />
        </div>

        {/* Study-Plan test verdict: chapters <90% are un-marked as weak (Sep 29 2026) */}
        {planVerdict && (
          <div className="card mt-4 border-primary/30 bg-primary/5 p-5">
            <p className="text-sm font-bold">🗓️ Study Plan verdict</p>
            <p className="mt-1 text-sm">{planVerdict.message?.en}</p>
            <p className="text-sm text-muted-foreground">{planVerdict.message?.hi}</p>
            <div className="mt-3 space-y-1 text-sm">
              {planVerdict.chapters.map((c: any) => (
                <div key={c.chapterId} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{c.name}</span>
                  <span className={`shrink-0 font-bold ${c.status === "COMPLETE" ? "text-emerald-600" : c.status === "WEAK" ? "text-red-600" : "text-muted-foreground"}`}>{c.pct}% {c.status === "COMPLETE" ? "✅ complete" : c.status === "WEAK" ? "⚠️ weak" : ""}</span>
                </div>
              ))}
            </div>
            <a href="/study-plan/board" className="mt-3 inline-block text-xs font-semibold text-primary underline">Open my prep board →</a>
          </div>
        )}

        {/* What to do next: weak topics of THIS test (wrong + skipped) with custom practice */}
        <WeakTopicPractice className="mt-4" attemptId={String(params.attemptId)} />

        {/* You vs average vs cut-off vs topper */}
        <div className="mt-4">
          <ScoreComparison
            score={detail.score}
            max={maxScore}
            avgScore={stats && stats.attempts > 0 ? Number(stats.avgScore) : null}
            cutoffScore={stats && stats.attempts > 0 ? Number(stats.cutoffScore) : null}
            hasEnoughData={!!stats?.hasEnoughData}
            topperScore={detail.topper?.score ?? null}
            attempts={stats?.attempts}
          />
        </div>

        {/* Practice only the mistakes of this attempt */}
        <div className="mt-4">
          <RetryPanel questions={questions} />
        </div>

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

        {/* Time per question + subject-wise bars */}
        <div className="mt-4 space-y-4">
          <TimeAnalysis questions={questions} onJump={jumpTo} />
          <SubjectBars questions={questions} />
        </div>

        {/* Subject-wise analysis -> tap a subject for its chapters -> tap a chapter for topics / sub-topics */}
        <SubjectChapterAnalysis questions={questions} />

        {/* NEW (Sep 21 2026) — TRUE Topic (and Sub-topic) deep analysis, drilled
            below chapter level. Only rendered when at least one question in
            this attempt actually carries a topic (older PYQ sets may not). */}
        {realTopics.length > 0 && (
          <div className="card mt-4 p-5">
            <h2 className="text-sm font-bold">🏷️ Topic-wise Deep Analysis <span className="font-normal text-muted-foreground">(weakest first)</span></h2>
            <div className="mt-3 space-y-2">
              {realTopics.map((t) => (
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
            {subTopics.length > 0 && (
              <>
                <h3 className="mt-5 text-xs font-bold text-muted-foreground">Sub-topic wise</h3>
                <div className="mt-2 space-y-2">
                  {subTopics.map((t) => (
                    <div key={t.name} className="flex items-center gap-3 text-sm">
                      <span className="w-48 truncate text-xs text-muted-foreground">{t.name}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${t.acc < 40 ? "bg-danger" : t.acc < 70 ? "bg-warning" : "bg-success"}`}
                          style={{ width: `${t.acc}%` }}
                        />
                      </div>
                      <span className="w-24 text-right text-xs text-muted-foreground">{t.correct}/{t.total} · {t.acc}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

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
                <button
                  key={q.questionId}
                  type="button"
                  onClick={() => jumpTo(i)}
                  aria-label={`Go to question ${i + 1}`}
                  className={`flex h-8 items-center justify-center rounded-md text-xs font-bold ${cls}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}

// ---- Sub-components ----
// Shape returned by GET /ai-explanation/questions/:id — same contract the
// review page already uses (see frontend/src/app/review/page.tsx).
type AIExplanation = {
  explanation: string;
  explanationHindi: string;
  stepByStepSolution: string;
  stepByStepSolutionHindi: string;
  keyConcepts: string[];
  keyConceptsHindi: string[];
  source?: string;
};

function QuestionReview({ q, index, lang }: { q: ReviewQuestion; index: number; lang: ReviewLang }) {
  const tr = useT();
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
          {q.topic ? ` › ${q.topic}` : ""}
          {q.subTopic ? ` › ${q.subTopic}` : ""}
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

      <div className="mt-3">
        <ReviewQuestionBody
          questionText={q.questionText}
          questionTextHindi={q.questionTextHindi}
          diagramType={q.questionDiagramType}
          diagramLabels={q.questionDiagramLabels}
          imageUrl={q.questionImageUrl}
          options={q.options}
          selected={q.selectedOption}
          correct={q.correctAnswer}
          lang={lang}
        />
      </div>

      <div className="mt-4">
        <SolutionPanel
          questionId={q.questionId}
          correctKey={q.correctAnswer}
          correctLabel={q.options.find((o) => o.key === q.correctAnswer)?.text ?? null}
          explanation={q.explanation}
          explanationHindi={q.explanationHindi}
          source={q.explanationSource}
          lang={lang}
        />
      </div>
    </div>
  );
}
