"use client";
/**
 * Visual pieces of the /results/[attemptId] screen:
 *  - ScoreHero        score ring + rank / percentile / accuracy / time
 *  - ScoreComparison  you vs class average vs cut-off vs topper
 *  - TimeAnalysis     time-per-question bar chart + slow / guess diagnosis
 *  - SubjectBars      stacked correct / wrong / skipped per subject
 *  - RetryPanel       "practice only my wrong questions" (stashes a practice set for /test)
 *
 * All colours come from the design-system tokens so light and dark mode both work. No chart library: plain SVG/CSS.
 */
import * as React from "react";
import { useT } from "@/lib/i18n";

export type InsightQuestion = {
  questionId: string;
  questionText: string;
  questionTextHindi?: string | null;
  questionDiagramType?: string | null;
  questionDiagramLabels?: (string | null)[] | null;
  questionImageUrl?: string | null;
  options: { key: string; text: string; textHi?: string | null; diagramType?: string | null; diagramLabels?: (string | null)[] | null; imageUrl?: string | null }[];
  selectedOption: string | null;
  correctAnswer?: string;
  isCorrect: boolean;
  isSkipped: boolean;
  timeSpentSeconds: number;
  explanation?: string | null;
  explanationHindi?: string | null;
  examName?: string;
  chapter?: string | null;
  subject?: string | null;
  year?: number | null;
  shift?: string | null;
  marks: number;
  negativeMarks: number;
  // set by the server for strict-sectional attempts (index into the attempt's section plan)
  sectionIndex?: number | null;
};

export const fmtDur = (s: number) => {
  const t = Math.max(0, Math.round(s));
  if (t >= 3600) return `${Math.floor(t / 3600)}h ${Math.floor((t % 3600) / 60)}m`;
  if (t >= 60) return `${Math.floor(t / 60)}m ${t % 60}s`;
  return `${t}s`;
};

const clampPct = (v: number) => Math.min(100, Math.max(0, v));

/* ----------------------------------------------------------------------------------------------- Score hero */

export function ScoreHero(props: {
  title: string;
  submittedAt?: string;
  score: number;
  max: number;
  rank?: number | null;
  percentile?: number | null;
  accuracy: number;
  correct: number;
  wrong: number;
  skipped: number;
  totalTimeSec: number;
}) {
  const tr = useT();
  const { score, max, rank, percentile, accuracy, correct, wrong, skipped, totalTimeSec } = props;
  const total = Math.max(correct + wrong + skipped, 1);
  const pct = max > 0 ? clampPct((score / max) * 100) : 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <section className="card overflow-hidden" aria-label="Score summary">
      <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-[auto_1fr] md:items-center">
        <div className="mx-auto flex flex-col items-center">
          <div className="relative h-36 w-36">
            <svg viewBox="0 0 128 128" className="-rotate-90" width="144" height="144" role="img" aria-label={`Score ${score} out of ${max}`}>
              <circle cx="64" cy="64" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="12" />
              <circle
                cx="64"
                cy="64"
                r={r}
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={c}
                strokeDashoffset={c * (1 - pct / 100)}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-extrabold tabular-nums leading-none">{Number.isInteger(score) ? score : score.toFixed(2)}</span>
              <span className="mt-1 text-xs text-muted-foreground">/ {max} · {pct.toFixed(0)}%</span>
            </div>
          </div>
          <p className="mt-2 text-xs font-semibold text-muted-foreground">{tr("Your score", "Aapka score")}</p>
        </div>

        <div className="min-w-0">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={tr("Rank", "Rank")} value={rank ? `#${rank}` : "—"} sub={tr("in this test", "is test me")} />
            <Stat label={tr("Percentile", "Percentile")} value={percentile != null ? `${percentile}` : "—"} sub={tr("vs all attempts", "sab attempts me")} />
            <Stat label={tr("Accuracy", "Accuracy")} value={`${accuracy}%`} sub={tr("on attempted", "attempted par")} />
            <Stat label={tr("Time taken", "Time laga")} value={fmtDur(totalTimeSec)} sub={totalTimeSec > 0 ? `${fmtDur(totalTimeSec / total)} / Q` : "—"} />
          </div>

          {percentile != null && (
            <div className="mt-4">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>0</span>
                <span>{tr(`You beat ${percentile}% of students`, `Aapne ${percentile}% students ko peeche chhoda`)}</span>
                <span>100</span>
              </div>
              <div className="relative mt-1 h-2.5 w-full rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${clampPct(percentile)}%` }} />
                <span
                  className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow"
                  style={{ left: `${clampPct(percentile)}%` }}
                />
              </div>
            </div>
          )}

          <div className="mt-4">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${correct} correct, ${wrong} wrong, ${skipped} skipped`}>
              <div className="h-full bg-success" style={{ width: `${(correct / total) * 100}%` }} />
              <div className="h-full bg-danger" style={{ width: `${(wrong / total) * 100}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-success" /> {correct} {tr("correct", "sahi")}</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-danger" /> {wrong} {tr("wrong", "galat")}</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/30" /> {skipped} {tr("skipped", "skip")}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-extrabold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

/* ------------------------------------------------------------------------------------- Score comparison */

export function ScoreComparison(props: {
  score: number;
  max: number;
  avgScore?: number | null;
  cutoffScore?: number | null;
  cutoffLabel?: string;
  hasEnoughData?: boolean;
  topperScore?: number | null;
  attempts?: number;
}) {
  const tr = useT();
  const { score, max, avgScore, cutoffScore, topperScore, hasEnoughData, attempts } = props;
  const rows: { label: string; value: number; tone: string; note?: string }[] = [
    { label: tr("You", "Aap"), value: score, tone: "bg-primary" },
  ];
  if (avgScore != null) rows.push({ label: tr("Average", "Average"), value: avgScore, tone: "bg-info" });
  if (cutoffScore != null && hasEnoughData) rows.push({ label: tr("Cut-off (P90)", "Cut-off (P90)"), value: cutoffScore, tone: "bg-warning" });
  if (topperScore != null) rows.push({ label: tr("Topper", "Topper"), value: topperScore, tone: "bg-success" });
  if (rows.length < 2) return null;
  const gap = topperScore != null ? Math.max(0, Number((topperScore - score).toFixed(2))) : null;
  const scale = Math.max(max, ...rows.map((r) => r.value), 1);
  return (
    <section className="card p-5" aria-label="Score comparison">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold">🏆 {tr("You vs the class", "Aap vs baaki students")}</h2>
          {attempts != null && attempts > 0 && (
            <p className="text-xs text-muted-foreground">{tr(`Based on ${attempts} attempts of this test`, `Is test ke ${attempts} attempts ke basis par`)}</p>
          )}
        </div>
        {gap != null && (
          <p className="text-right text-xs text-muted-foreground">
            {tr("Gap to topper", "Topper se gap")}: <b className="text-base text-primary">{gap}</b> {tr("marks", "marks")}
          </p>
        )}
      </div>
      <div className="mt-4 space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-3 text-sm">
            <span className="truncate text-xs font-semibold text-muted-foreground">{r.label}</span>
            <div className="h-3 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${r.tone}`} style={{ width: `${clampPct((r.value / scale) * 100)}%` }} />
            </div>
            <span className="text-right text-xs font-bold tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------ Time analysis */

export function TimeAnalysis({ questions, onJump }: { questions: InsightQuestion[]; onJump?: (index: number) => void }) {
  const tr = useT();
  const d = React.useMemo(() => {
    const times = questions.map((q) => q.timeSpentSeconds || 0);
    const total = times.reduce((a, b) => a + b, 0);
    const timed = times.filter((t) => t > 0).length;
    const avg = timed ? total / timed : 0;
    const max = Math.max(...times, 1);
    const avgOf = (f: (q: InsightQuestion) => boolean) => {
      const list = questions.filter(f).map((q) => q.timeSpentSeconds || 0).filter((t) => t > 0);
      return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
    };
    const slowLimit = Math.max(90, avg * 2);
    const slowWrong = questions.filter((q) => !q.isSkipped && !q.isCorrect && (q.timeSpentSeconds || 0) >= slowLimit).length;
    const guesses = questions.filter((q) => !q.isSkipped && !q.isCorrect && (q.timeSpentSeconds || 0) > 0 && (q.timeSpentSeconds || 0) < 10).length;
    const lostTime = questions.filter((q) => !q.isCorrect).reduce((a, q) => a + (q.timeSpentSeconds || 0), 0);
    const slowest = questions
      .map((q, i) => ({ i, t: q.timeSpentSeconds || 0, ok: q.isCorrect, skipped: q.isSkipped }))
      .sort((a, b) => b.t - a.t)
      .slice(0, 5)
      .filter((x) => x.t > 0);
    return { total, timed, avg, max, avgCorrect: avgOf((q) => q.isCorrect), avgWrong: avgOf((q) => !q.isCorrect && !q.isSkipped), slowWrong, guesses, lostPct: total ? Math.round((lostTime / total) * 100) : 0, slowest, slowLimit };
  }, [questions]);

  if (d.timed === 0) {
    return (
      <section className="card p-5" aria-label="Time analysis">
        <h2 className="text-sm font-bold">⏱ {tr("Time per question", "Har question par time")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{tr("Time was not recorded for this attempt.", "Is attempt me time record nahi hua.")}</p>
      </section>
    );
  }

  const n = questions.length;
  const barW = n > 60 ? 8 : n > 30 ? 12 : 18;
  const insight =
    d.slowWrong > 0
      ? tr(`${d.slowWrong} wrong answer(s) took very long (${fmtDur(d.slowLimit)}+). Skip such questions first and come back later.`, `${d.slowWrong} galat answer me bahut time laga (${fmtDur(d.slowLimit)}+). Aise questions pehle skip karke baad me aao.`)
      : d.guesses > 0
        ? tr(`${d.guesses} wrong answer(s) were under 10 seconds — likely guesses. Read the question fully first.`, `${d.guesses} galat answer 10 sec se kam me diye — shayad guess. Question poora padho.`)
        : tr("Your time was spread well — no obvious time sinks.", "Time achhe se baanta gaya — koi bada time-waste nahi.");

  return (
    <section className="card p-5" aria-label="Time analysis">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold">⏱ {tr("Time per question", "Har question par time")}</h2>
        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-success" /> {tr("correct", "sahi")}</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-danger" /> {tr("wrong", "galat")}</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/40" /> {tr("skipped", "skip")}</span>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto pb-1">
        <div className="relative h-36" style={{ minWidth: n * (barW + 3) }}>
          {/* average line */}
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-foreground/40" style={{ bottom: `${(d.avg / d.max) * 100}%` }}>
            <span className="absolute -top-4 left-0 rounded bg-background px-1 text-[10px] font-semibold text-muted-foreground">avg {fmtDur(d.avg)}</span>
          </div>
          <div className="absolute inset-0 flex items-end gap-[3px]">
            {questions.map((q, i) => {
              const t = q.timeSpentSeconds || 0;
              const tone = q.isSkipped ? "bg-muted-foreground/40" : q.isCorrect ? "bg-success" : "bg-danger";
              return (
                <button
                  key={q.questionId}
                  type="button"
                  onClick={() => onJump?.(i)}
                  title={`Q${i + 1} · ${fmtDur(t)} · ${q.isSkipped ? "skipped" : q.isCorrect ? "correct" : "wrong"}`}
                  aria-label={`Question ${i + 1}, ${fmtDur(t)}`}
                  className={`flex-1 rounded-t-sm transition hover:opacity-70 ${tone}`}
                  style={{ height: `${Math.max(t > 0 ? 3 : 1, (t / d.max) * 100)}%`, minWidth: barW }}
                />
              );
            })}
          </div>
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground" style={{ minWidth: n * (barW + 3) }}>
          <span>Q1</span>
          <span>Q{n}</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini label={tr("Total time", "Total time")} value={fmtDur(d.total)} />
        <Mini label={tr("Avg / question", "Avg / question")} value={fmtDur(d.avg)} />
        <Mini label={tr("Avg on correct", "Sahi par avg")} value={d.avgCorrect ? fmtDur(d.avgCorrect) : "—"} tone="text-success" />
        <Mini label={tr("Avg on wrong", "Galat par avg")} value={d.avgWrong ? fmtDur(d.avgWrong) : "—"} tone="text-danger" />
      </div>

      <p className="mt-4 rounded-xl border border-info/20 bg-info/5 p-3 text-sm">
        💡 {insight} <span className="text-muted-foreground">{tr(`${d.lostPct}% of your time went on questions you didn't get right.`, `Aapka ${d.lostPct}% time unn questions par gaya jo sahi nahi hue.`)}</span>
      </p>

      {d.slowest.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-bold text-muted-foreground">{tr("SLOWEST QUESTIONS", "SABSE ZYADA TIME")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {d.slowest.map((x) => (
              <button
                key={x.i}
                type="button"
                onClick={() => onJump?.(x.i)}
                className="rounded-full border border-border px-3 py-1 text-xs font-semibold hover:bg-muted"
              >
                Q{x.i + 1} · {fmtDur(x.t)} · <span className={x.skipped ? "text-muted-foreground" : x.ok ? "text-success" : "text-danger"}>{x.skipped ? "skipped" : x.ok ? "✓" : "✗"}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3 text-center">
      <p className={`text-lg font-extrabold tabular-nums ${tone || ""}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ Subject bars */

export function SubjectBars({ questions }: { questions: InsightQuestion[] }) {
  const tr = useT();
  const rows = React.useMemo(() => {
    const m = new Map<string, { c: number; w: number; s: number; time: number; score: number }>();
    for (const q of questions) {
      const k = q.subject || "General";
      const r = m.get(k) || { c: 0, w: 0, s: 0, time: 0, score: 0 };
      r.time += q.timeSpentSeconds || 0;
      if (q.isCorrect) { r.c++; r.score += q.marks || 2; }
      else if (q.isSkipped || !q.selectedOption) r.s++;
      else { r.w++; r.score -= q.negativeMarks || 0; }
      m.set(k, r);
    }
    return Array.from(m.entries())
      .map(([name, r]) => {
        const total = r.c + r.w + r.s;
        return { name, ...r, total, acc: r.c + r.w ? Math.round((r.c / (r.c + r.w)) * 100) : 0 };
      })
      .sort((a, b) => a.acc - b.acc);
  }, [questions]);
  if (rows.length === 0) return null;
  return (
    <section className="card p-5" aria-label="Subject-wise performance">
      <h2 className="text-sm font-bold">📚 {tr("Subject-wise performance", "Subject-wise performance")} <span className="font-normal text-muted-foreground">({tr("weakest first", "weakest pehle")})</span></h2>
      <div className="mt-4 space-y-4">
        {rows.map((r) => (
          <div key={r.name}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="font-semibold">{r.name}</span>
              <span className="text-xs text-muted-foreground">
                {r.score.toFixed(r.score % 1 ? 2 : 0)} {tr("marks", "marks")} · {r.acc}% {tr("accuracy", "accuracy")} · {fmtDur(r.total ? r.time / r.total : 0)}/Q
              </span>
            </div>
            <div className="mt-1.5 flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${r.c} correct, ${r.w} wrong, ${r.s} skipped`}>
              <div className="h-full bg-success" style={{ width: `${(r.c / r.total) * 100}%` }} />
              <div className="h-full bg-danger" style={{ width: `${(r.w / r.total) * 100}%` }} />
              <div className="h-full bg-muted-foreground/30" style={{ width: `${(r.s / r.total) * 100}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {r.c} {tr("correct", "sahi")} · {r.w} {tr("wrong", "galat")} · {r.s} {tr("skipped", "skip")}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------------- Section clock (strict timers) */

/**
 * Strict-sectional attempts only (SSC CGL 2026 style): per section, how many marks, how the time was used against the
 * section's own timer, and whether time was left on the table. A section that ended with minutes to spare is the
 * clearest "you could have re-checked" signal; one that ran dry shows where the clock is being lost.
 */
export function SectionTimeCard({ questions, plan }: { questions: InsightQuestion[]; plan: SectionPlanLike }) {
  const tr = useT();
  const rows = React.useMemo(
    () =>
      plan.sections.map((sec) => {
        const qs = questions.filter((q) => q.sectionIndex === sec.index);
        let c = 0, w = 0, sk = 0, used = 0, score = 0;
        for (const q of qs) {
          used += q.timeSpentSeconds || 0;
          if (q.isCorrect) { c++; score += q.marks || 0; }
          else if (q.isSkipped || !q.selectedOption) sk++;
          else { w++; score -= q.negativeMarks || 0; }
        }
        const allotted = Math.round((sec.endMs - sec.startMs) / 1000);
        const usedClamped = Math.min(used, allotted);
        const left = Math.max(0, allotted - used);
        const attempted = c + w;
        return { sec, c, w, sk, score, allotted, used: usedClamped, left, attempted, total: qs.length, perQ: attempted ? used / attempted : 0, ideal: qs.length ? allotted / qs.length : 0 };
      }),
    [questions, plan],
  );
  if (rows.every((r) => r.total === 0)) return null;
  return (
    <section className="card p-5" aria-label="Section-wise time">
      <h2 className="text-sm font-bold">⏱ {tr("Section-wise time", "Section-wise samay")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {tr("Each section had its own timer. Times are approximate (time spent on each question's screen).", "Har section ka apna timer tha. Samay lagbhag hai (har sawal ki screen par bita samay).")}
      </p>
      <div className="mt-4 space-y-4">
        {rows.map((r) => {
          const pct = r.allotted ? Math.round((r.used / r.allotted) * 100) : 0;
          const spare = r.allotted ? r.left / r.allotted : 0;
          const verdict =
            r.total === 0
              ? null
              : spare >= 0.2
                ? { tone: "text-warning", en: `About ${fmtDur(r.left)} was left unused — use it to re-check marked and risky questions.`, hi: `Lagbhag ${fmtDur(r.left)} bach gaya — marked aur risky sawal dobara check karne me lagao.` }
                : r.sk > 0 && spare < 0.05
                  ? { tone: "text-danger", en: `The clock ran out with ${r.sk} question(s) skipped — attempt the quick ones first.`, hi: `Timer khatam ho gaya aur ${r.sk} sawal skip rahe — pehle aasaan sawal karo.` }
                  : { tone: "text-success", en: "Time was used well.", hi: "Samay ka achha use hua." };
          return (
            <div key={r.sec.index}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="font-semibold">{r.sec.name}</span>
                <span className="text-xs text-muted-foreground">
                  {r.score.toFixed(r.score % 1 ? 2 : 0)} {tr("marks", "marks")} · {r.c}✓ {r.w}✗ {r.sk}○
                </span>
              </div>
              <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${pct}% of the section time used`}>
                <div className="h-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {fmtDur(r.used)} / {fmtDur(r.allotted)} · {tr("avg", "avg")} {fmtDur(r.perQ)}/{tr("attempted Q", "attempted sawal")} ({tr("ideal", "ideal")} ~{fmtDur(r.ideal)}/Q)
              </p>
              {verdict && <p className={`mt-0.5 text-[11px] font-semibold ${verdict.tone}`}>{tr(verdict.en, verdict.hi)}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Subset of the server's frozen SectionPlan that the results screen needs. */
export type SectionPlanLike = { sections: { index: number; name: string; startMs: number; endMs: number }[] };

/* --------------------------------------------------------------------------------------- Retry wrong only */

export function RetryPanel({ questions }: { questions: InsightQuestion[] }) {
  const tr = useT();
  const wrongQs = questions.filter((q) => !q.isSkipped && !q.isCorrect);
  const skippedQs = questions.filter((q) => q.isSkipped);
  const [err, setErr] = React.useState("");
  if (wrongQs.length + skippedQs.length === 0) return null;

  const start = (list: InsightQuestion[], title: string) => {
    try {
      const set = list.map((q) => ({
        id: q.questionId,
        questionText: q.questionText,
        questionTextHindi: q.questionTextHindi ?? null,
        questionDiagramType: q.questionDiagramType ?? null,
        questionDiagramLabels: q.questionDiagramLabels ?? null,
        questionImageUrl: q.questionImageUrl ?? null,
        options: q.options,
        chapter: q.chapter || q.subject || "",
        examName: q.examName,
        year: q.year,
        shift: q.shift,
        marks: q.marks,
        negativeMarks: q.negativeMarks,
        // this is the student's own, already-submitted attempt, so showing the answer in the retry is fine
        correctAnswer: q.correctAnswer,
        explanation: q.explanation ?? null,
        explanationHindi: q.explanationHindi ?? null,
      }));
      sessionStorage.setItem("ssc_sectional_set", JSON.stringify({ title, questions: set }));
      window.location.href = "/test";
    } catch {
      setErr(tr("Could not start the retry (browser storage is blocked).", "Retry start nahi hua (browser storage blocked hai)."));
    }
  };

  return (
    <section className="card border-primary/30 bg-primary/5 p-5" aria-label="Retry mistakes">
      <h2 className="text-sm font-bold">↻ {tr("Fix your mistakes", "Apni galtiyan sudharo")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {tr("Practice only the questions you got wrong — the fastest way to improve.", "Sirf wahi questions practice karo jo galat hue — improve hone ka sabse tez tareeka.")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {wrongQs.length > 0 && (
          <button onClick={() => start(wrongQs, "Retry — wrong answers")} className="btn btn-primary">
            ↻ {tr("Retry wrong only", "Sirf galat dobara")} ({wrongQs.length})
          </button>
        )}
        {wrongQs.length > 0 && skippedQs.length > 0 && (
          <button onClick={() => start([...wrongQs, ...skippedQs], "Retry — wrong + skipped")} className="btn btn-outline">
            {tr("Wrong + skipped", "Galat + skip")} ({wrongQs.length + skippedQs.length})
          </button>
        )}
        {wrongQs.length === 0 && skippedQs.length > 0 && (
          <button onClick={() => start(skippedQs, "Retry — skipped questions")} className="btn btn-primary">
            {tr("Attempt skipped questions", "Skip kiye questions karo")} ({skippedQs.length})
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-xs text-danger" role="alert">{err}</p>}
    </section>
  );
}
