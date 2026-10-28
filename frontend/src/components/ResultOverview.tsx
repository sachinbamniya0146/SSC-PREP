"use client";
import * as React from "react";
import { useT } from "@/lib/i18n";

/**
 * Result screen, top part (session 29, roadmap 4.5): notices that explain WHY a number is what it is, and a section-wise score table.
 * Pure display of data the review endpoint already returns (no new endpoint). Mobile first: the table fits 360 px without sideways scroll.
 */

export type OverviewQuestion = {
  isCorrect: boolean;
  isSkipped: boolean;
  selectedOption: string | null;
  timeSpentSeconds: number;
  marks: number;
  negativeMarks: number;
  subject: string | null;
  sectionIndex?: number | null;
  keyChanged?: boolean;
};

export type OverviewAttempt = {
  status?: string | null;
  expiresAt?: string | null;
  score: number;
  rescoredAt?: string | null;
  scoreBeforeRescore?: number | null;
  rescoreNote?: string | null;
  tabSwitches?: number | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmtDur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

/* ------------------------------------------------------------------------------------------------ notices */

export function ResultNotices({ attempt, questions }: { attempt: OverviewAttempt; questions: OverviewQuestion[] }) {
  const tr = useT();
  const auto = attempt.status === "AUTO_SUBMITTED";
  const rescored = !!attempt.rescoredAt && attempt.scoreBeforeRescore != null;
  const staleKeys = questions.filter((q) => q.keyChanged).length;
  const tabs = Number(attempt.tabSwitches) || 0;
  if (!auto && !rescored && staleKeys === 0 && tabs === 0) return null;
  return (
    <div className="mt-4 space-y-3" aria-label="Result notes">
      {auto && (
        <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-4 text-sm">
          <p className="font-semibold">ⓘ {tr("This attempt was submitted for you", "Yeh attempt tumhare liye auto-submit hua")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {tr(
              "You did not press Submit, so the score uses the answers that were saved before the time ended. Questions you never answered count as skipped.",
              "Tumne Submit nahi dabaya, isliye score time khatam hone se pehle save hue answers se bana hai. Jo sawal kabhi attempt nahi hue wo skipped gine gaye.",
            )}
          </p>
        </div>
      )}
      {tabs > 0 && (
        <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
          <p className="font-semibold">👀 {tr(`You left the test window ${tabs} time(s)`, `Tum test window se ${tabs} baar bahar gaye`)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {tr("No marks are cut for this. In the real exam, stay on the test screen.", "Isse koi marks nahi kate. Asli exam me test screen par hi raho.")}
          </p>
        </div>
      )}
      {rescored && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="font-semibold">
            ♻️ {tr("Score corrected", "Score sudhara gaya")}: {attempt.scoreBeforeRescore} → {attempt.score}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {tr(
              "The answer key of some question(s) was corrected after you finished, so the score and your rank were updated.",
              "Kuch sawalon ki answer key tumhare test ke baad sahi ki gayi, isliye score aur rank update hue.",
            )}
            {attempt.rescoreNote ? ` ${attempt.rescoreNote}` : ""}
          </p>
        </div>
      )}
      {staleKeys > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="font-semibold">⚠️ {tr(`${staleKeys} answer key(s) changed after your test`, `${staleKeys} sawal ki answer key test ke baad badli`)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {tr(
              "The review shows the NEW right option. Your score has not been re-scored yet and still uses the old key; it is marked on those questions below.",
              "Review me NAYA sahi option dikh raha hai. Tumhara score abhi re-score nahi hua, purani key se hi hai; neeche un sawalon par nishaan hai.",
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ section table */

type Row = { key: string; name: string; right: number; wrong: number; skipped: number; score: number; time: number; total: number };

export function SectionScoreTable({
  questions,
  plan,
  onFilter,
}: {
  questions: OverviewQuestion[];
  plan?: { sections: { index: number; name: string }[] } | null;
  onFilter?: (f: "wrong" | "skipped" | "correct") => void;
}) {
  const tr = useT();
  const { rows, total } = React.useMemo(() => {
    const map = new Map<string, Row>();
    const order: string[] = [];
    const planned = !!plan && plan.sections.length > 0 && questions.some((q) => q.sectionIndex != null);
    if (planned) for (const s of plan!.sections) { const k = `s${s.index}`; map.set(k, { key: k, name: s.name, right: 0, wrong: 0, skipped: 0, score: 0, time: 0, total: 0 }); order.push(k); }
    for (const q of questions) {
      const k = planned ? `s${q.sectionIndex ?? -1}` : `u:${q.subject || "General"}`;
      let row = map.get(k);
      if (!row) {
        row = { key: k, name: planned ? "Other" : q.subject || "General", right: 0, wrong: 0, skipped: 0, score: 0, time: 0, total: 0 };
        map.set(k, row);
        order.push(k);
      }
      row.total += 1;
      row.time += q.timeSpentSeconds || 0;
      if (q.isCorrect) { row.right += 1; row.score += q.marks || 0; }
      else if (q.isSkipped || !q.selectedOption) row.skipped += 1;
      else { row.wrong += 1; row.score -= q.negativeMarks || 0; }
    }
    const rows = order.map((k) => map.get(k)!).filter((r) => r.total > 0);
    const total = rows.reduce((a, r) => ({ ...a, right: a.right + r.right, wrong: a.wrong + r.wrong, skipped: a.skipped + r.skipped, score: a.score + r.score, time: a.time + r.time, total: a.total + r.total }), { key: "all", name: "Total", right: 0, wrong: 0, skipped: 0, score: 0, time: 0, total: 0 } as Row);
    return { rows, total };
  }, [questions, plan]);

  if (rows.length === 0) return null;
  const cell = "px-2 py-2 text-center tabular-nums";
  const tap = (f: "wrong" | "skipped" | "correct", n: number, cls: string) =>
    onFilter && n > 0 ? (
      <button type="button" onClick={() => onFilter(f)} className={`min-w-[1.75rem] rounded-md px-1.5 py-0.5 font-bold underline decoration-dotted underline-offset-2 ${cls}`}>{n}</button>
    ) : (
      <span className={n > 0 ? `font-bold ${cls}` : "text-muted-foreground"}>{n}</span>
    );
  return (
    <section className="card mt-4 p-4 sm:p-5" aria-label="Section-wise result">
      <h2 className="text-sm font-bold">📋 {tr("Section-wise result", "Section-wise result")}</h2>
      <p className="mt-1 text-[11px] text-muted-foreground">{tr("Tap a number to see only those questions below.", "Number par tap karo, neeche sirf wahi sawal dikhenge.")}</p>
      <div className="-mx-1 mt-3 overflow-x-auto">
        <table className="w-full min-w-[19rem] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2 text-left font-semibold">{tr("Section", "Section")}</th>
              <th className={`${cell} font-semibold`} title="Right">✓</th>
              <th className={`${cell} font-semibold`} title="Wrong">✗</th>
              <th className={`${cell} font-semibold`} title="Skipped">–</th>
              <th className={`${cell} font-semibold`}>{tr("Marks", "Marks")}</th>
              <th className={`${cell} font-semibold`}>⏱</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-border/60">
                <td className="max-w-[7.5rem] px-2 py-2 text-left font-medium sm:max-w-none"><span className="block truncate">{r.name}</span><span className="text-[10px] text-muted-foreground">{r.total} Q</span></td>
                <td className={cell}>{tap("correct", r.right, "text-success")}</td>
                <td className={cell}>{tap("wrong", r.wrong, "text-danger")}</td>
                <td className={cell}>{tap("skipped", r.skipped, "text-muted-foreground")}</td>
                <td className={`${cell} font-bold`}>{r2(r.score)}</td>
                <td className={`${cell} text-muted-foreground`}>{fmtDur(r.time)}</td>
              </tr>
            ))}
            {rows.length > 1 && (
              <tr className="bg-muted/50 font-bold">
                <td className="px-2 py-2 text-left">{tr("Total", "Total")}</td>
                <td className={cell}>{total.right}</td>
                <td className={cell}>{total.wrong}</td>
                <td className={cell}>{total.skipped}</td>
                <td className={cell}>{r2(total.score)}</td>
                <td className={`${cell} text-muted-foreground`}>{fmtDur(total.time)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
