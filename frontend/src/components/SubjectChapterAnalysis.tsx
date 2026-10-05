"use client";
import * as React from "react";
import { useT } from "@/lib/i18n";

export type AnalysisQuestion = {
  subject?: string | null;
  chapter?: string | null;
  topic?: string | null;
  subTopic?: string | null;
  isCorrect?: boolean | null;
  selectedOption?: string | null;
  isSkipped?: boolean | null;
  marks?: number | null;
  negativeMarks?: number | null;
  timeSpentSeconds?: number | null;
};

type Agg = { total: number; correct: number; wrong: number; skipped: number; score: number; time: number };
const empty = (): Agg => ({ total: 0, correct: 0, wrong: 0, skipped: 0, score: 0, time: 0 });

function add(a: Agg, q: AnalysisQuestion) {
  a.total += 1;
  a.time += q.timeSpentSeconds || 0;
  if (q.isCorrect) {
    a.correct += 1;
    a.score += q.marks ?? 2;
  } else if (q.selectedOption && !q.isSkipped) {
    a.wrong += 1;
    a.score -= q.negativeMarks ?? 0.5;
  } else {
    a.skipped += 1;
  }
}
const acc = (a: Agg) => (a.correct + a.wrong > 0 ? Math.round((a.correct / (a.correct + a.wrong)) * 100) : 0);
const tone = (p: number) => (p < 40 ? "bg-danger" : p < 70 ? "bg-warning" : "bg-success");
const toneText = (p: number) => (p < 40 ? "text-danger" : p < 70 ? "text-warning" : "text-success");
const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

function Bar({ p, thin }: { p: number; thin?: boolean }) {
  return (
    <div className={`w-full overflow-hidden rounded-full bg-muted ${thin ? "h-1.5" : "h-2"}`}>
      <div className={`h-full rounded-full ${tone(p)}`} style={{ width: `${p}%` }} />
    </div>
  );
}

/**
 * Subject-wise analysis with drill-down: tap a subject to see its chapters, tap a chapter to see its topics and
 * sub-topics. Accuracy = correct / attempted; skipped questions are shown separately (they are not "wrong").
 * Subjects/chapters are sorted weakest-first so the student sees what to fix first.
 */
export default function SubjectChapterAnalysis({ questions }: { questions: AnalysisQuestion[] }) {
  const t = useT();
  const [openSubject, setOpenSubject] = React.useState<string | null>(null);
  const [openChapter, setOpenChapter] = React.useState<string | null>(null);

  const tree = React.useMemo(() => {
    const subjects = new Map<string, { agg: Agg; chapters: Map<string, { agg: Agg; topics: Map<string, Agg> }> }>();
    for (const q of questions) {
      const sName = q.subject || "General";
      const cName = q.chapter || "General";
      const tName = q.topic ? (q.subTopic ? `${q.topic} › ${q.subTopic}` : q.topic) : null;
      let s = subjects.get(sName);
      if (!s) subjects.set(sName, (s = { agg: empty(), chapters: new Map() }));
      add(s.agg, q);
      let c = s.chapters.get(cName);
      if (!c) s.chapters.set(cName, (c = { agg: empty(), topics: new Map() }));
      add(c.agg, q);
      if (tName) {
        let tp = c.topics.get(tName);
        if (!tp) c.topics.set(tName, (tp = empty()));
        add(tp, q);
      }
    }
    return [...subjects.entries()]
      .map(([name, s]) => ({
        name,
        agg: s.agg,
        chapters: [...s.chapters.entries()]
          .map(([cn, c]) => ({ name: cn, agg: c.agg, topics: [...c.topics.entries()].map(([tn, a]) => ({ name: tn, agg: a })).sort((a, b) => acc(a.agg) - acc(b.agg)) }))
          .sort((a, b) => acc(a.agg) - acc(b.agg)),
      }))
      .sort((a, b) => acc(a.agg) - acc(b.agg));
  }, [questions]);

  if (!tree.length) return null;

  return (
    <div className="card mt-4 p-5">
      <h2 className="text-sm font-bold">
        📊 {t("Subject-wise Analysis", "Subject-wise Analysis")}{" "}
        <span className="font-normal text-muted-foreground">({t("weakest first — tap a subject to see chapters", "weakest pehle — chapters dekhne ke liye subject par tap karein")})</span>
      </h2>
      <div className="mt-3 space-y-2">
        {tree.map((s) => {
          const sOpen = openSubject === s.name;
          const sAcc = acc(s.agg);
          return (
            <div key={s.name} className="rounded-xl border border-border">
              <button
                onClick={() => {
                  setOpenSubject(sOpen ? null : s.name);
                  setOpenChapter(null);
                }}
                className="flex w-full items-center gap-3 p-3 text-left"
                aria-expanded={sOpen}
              >
                <span className="text-xs text-muted-foreground">{sOpen ? "▼" : "▶"}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{s.name}</p>
                    <span className={`text-sm font-bold ${toneText(sAcc)}`}>{sAcc}%</span>
                  </div>
                  <Bar p={sAcc} />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {s.agg.correct} {t("correct", "sahi")} · {s.agg.wrong} {t("wrong", "galat")} · {s.agg.skipped} {t("skipped", "skip")} · {s.agg.score.toFixed(1)} {t("marks", "marks")} · ⏱ {fmt(s.agg.time)}
                  </p>
                </div>
              </button>

              {sOpen && (
                <div className="space-y-1.5 border-t border-border bg-muted/30 p-3">
                  {s.chapters.map((c) => {
                    const key = `${s.name}::${c.name}`;
                    const cOpen = openChapter === key;
                    const cAcc = acc(c.agg);
                    return (
                      <div key={key} className="rounded-lg border border-border bg-background">
                        <button onClick={() => setOpenChapter(cOpen ? null : key)} className="flex w-full items-center gap-3 p-2.5 text-left" aria-expanded={cOpen}>
                          <span className="text-[10px] text-muted-foreground">{c.topics.length ? (cOpen ? "▼" : "▶") : "•"}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-xs font-semibold">{c.name}</p>
                              <span className={`text-xs font-bold ${toneText(cAcc)}`}>{cAcc}%</span>
                            </div>
                            <Bar p={cAcc} thin />
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {c.agg.correct}/{c.agg.total} {t("correct", "sahi")} · {c.agg.wrong} {t("wrong", "galat")} · {c.agg.skipped} {t("skipped", "skip")}
                            </p>
                          </div>
                        </button>
                        {cOpen && c.topics.length > 0 && (
                          <div className="space-y-1.5 border-t border-border px-3 py-2">
                            {c.topics.map((tp) => {
                              const p = acc(tp.agg);
                              return (
                                <div key={tp.name} className="flex items-center gap-2 text-[11px]">
                                  <span className="w-40 shrink-0 truncate text-muted-foreground sm:w-56">{tp.name}</span>
                                  <Bar p={p} thin />
                                  <span className="w-20 shrink-0 text-right text-muted-foreground">
                                    {tp.agg.correct}/{tp.agg.total} · {p}%
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
