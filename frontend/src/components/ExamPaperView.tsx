"use client";
import * as React from "react";
import DiagramVenn from "@/components/DiagramVenn";
import { StemMedia, QFigure } from "@/components/QuestionMedia";
import { ReviewLangToggle, type ReviewLang } from "@/components/SolutionPanel";
import { CheckIcon } from "@/components/TickBox";
import { useT } from "@/lib/i18n";

/**
 * Question-paper view of the exam screen (session 29, roadmap 4.6): all the questions of the open section on ONE scroll, like the printed
 * paper, so a student can answer in any order without tapping "next". It is only a different way to look at the same state: it
 * changes nothing about timing, locking or saving. Every tap goes through the same handlers as the one-question view (the page passes
 * them in), which already respect the strict sectional timers, the autosave and the offline queue.
 */

export type PaperViewQuestion = {
  id: string;
  questionText: string;
  questionTextHindi?: string | null;
  questionDiagramType?: string | null;
  questionDiagramLabels?: (string | null)[] | null;
  questionImageUrl?: string | null;
  options: { key: string; text: string; textHi?: string | null; diagramType?: string | null; diagramLabels?: (string | null)[] | null; imageUrl?: string | null }[];
  paperQuestionNo?: number | null;
  marks?: number;
  negativeMarks?: number;
};

const PAGE = 25; // never mount hundreds of questions at once on a phone

export function ExamPaperView({
  items,
  activeIdx,
  answers,
  isMarked,
  lang,
  onLang,
  onPick,
  onClear,
  onMark,
  onClose,
  onReview,
  clockText,
  clockClass,
  sectionLabel,
}: {
  items: { q: PaperViewQuestion; i: number }[];
  activeIdx: number;
  answers: Record<string, string | undefined>;
  isMarked: (qid: string) => boolean;
  lang: ReviewLang;
  onLang: (l: ReviewLang) => void;
  onPick: (i: number, qid: string, key: string) => void;
  onClear: (i: number, qid: string) => void;
  onMark: (i: number, qid: string) => void;
  onClose: () => void;
  onReview: () => void;
  clockText: string;
  clockClass: string;
  sectionLabel: string;
}) {
  const tr = useT();
  const where = Math.max(0, items.findIndex((x) => x.i === activeIdx));
  const [page, setPage] = React.useState(Math.floor(where / PAGE));
  const pages = Math.max(1, Math.ceil(items.length / PAGE));
  const safePage = Math.min(page, pages - 1);
  const shown = items.slice(safePage * PAGE, safePage * PAGE + PAGE);
  const answered = items.filter((x) => !!answers[x.q.id]).length;
  const topRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    topRef.current?.scrollTo?.({ top: 0 });
  }, [safePage]);

  return (
    <div ref={topRef} className="fixed inset-0 z-[35] overflow-y-auto bg-background" role="region" aria-label={tr("Question paper view", "Question paper view")}>
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur" style={{ paddingTop: "max(0.25rem, env(safe-area-inset-top))" }}>
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">📄 {tr("Question paper", "Question paper")}{sectionLabel ? ` · ${sectionLabel}` : ""}</p>
            <p className="text-[11px] text-muted-foreground">{tr(`${answered} of ${items.length} answered`, `${items.length} me se ${answered} attempt`)}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-lg border px-2.5 py-1 font-mono text-sm font-bold tabular-nums ${clockClass}`} role="timer" aria-label={tr("Time left", "Bacha samay")}>{clockText}</span>
            <button type="button" onClick={onClose} className="rounded-lg border border-primary bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">
              {tr("One by one", "Ek ek karke")}
            </button>
          </div>
        </div>
        <div className="mx-auto max-w-3xl px-3 pb-2"><ReviewLangToggle lang={lang} onChange={onLang} /></div>
      </div>

      <div className="mx-auto max-w-3xl space-y-3 px-2 pb-32 pt-3 sm:px-3">
        {shown.map(({ q, i }) => {
          const marked = isMarked(q.id);
          return (
            <article key={q.id} id={`pv-${i}`} className={`card p-3 sm:p-5 ${i === activeIdx ? "ring-1 ring-primary/50" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold text-muted-foreground">
                  {tr("Q", "Q")}{q.paperQuestionNo != null ? q.paperQuestionNo : i + 1}
                  <span className="ml-2 rounded-md bg-success/15 px-2 py-0.5 text-[11px] text-success">+{q.marks ?? 1} / −{q.negativeMarks ?? 0.25}</span>
                </p>
                {marked && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-600">⚑ {tr("Marked", "Marked")}</span>}
              </div>
              {(lang !== "hi" || !q.questionTextHindi) && <h2 className="mt-2 break-words text-[15px] font-semibold leading-relaxed">{q.questionText}</h2>}
              {q.questionTextHindi && lang !== "en" && (
                <p className={lang === "hi" ? "mt-2 break-words font-hindi text-[15px] font-semibold leading-relaxed" : "mt-1.5 border-l-2 border-primary/40 pl-3 font-hindi text-sm leading-relaxed text-muted-foreground"}>{q.questionTextHindi}</p>
              )}
              <StemMedia diagramType={q.questionDiagramType} diagramLabels={q.questionDiagramLabels} imageUrl={q.questionImageUrl} />
              <div className="mt-3 space-y-2" role="radiogroup" aria-label={tr("Answer options", "Jawab ke options")}>
                {q.options.map((o) => {
                  const active = answers[q.id] === o.key;
                  return (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => onPick(i, q.id, o.key)}
                      role="radio"
                      aria-checked={active}
                      aria-label={`${tr("Option", "Option")} ${o.key}${active ? ` — ${tr("selected", "chuna hua")}` : ""}`}
                      className={`flex min-h-[48px] w-full touch-manipulation items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-[15px] transition active:scale-[0.99] ${active ? "border-primary bg-primary text-primary-foreground shadow-md" : "border-border bg-card hover:bg-muted"}`}
                    >
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${active ? "border-primary-foreground bg-primary-foreground text-primary" : "border-border"}`}>{o.key}</span>
                      <span className="min-w-0 flex-1">
                        {o.diagramType ? (
                          <span className="flex justify-center p-1"><DiagramVenn type={o.diagramType} labels={o.diagramLabels} size={110} /></span>
                        ) : o.imageUrl ? (
                          <span className="flex justify-center p-1"><QFigure src={o.imageUrl} alt={`Option ${o.key}`} className="max-h-32" /></span>
                        ) : (
                          <>
                            {(lang !== "hi" || !o.textHi) && <span>{o.text}</span>}
                            {o.textHi && lang !== "en" && (
                              <span className={`mt-1 block border-l-2 pl-3 font-hindi ${active ? "border-primary-foreground/50 text-primary-foreground/90" : "border-border text-muted-foreground"}`}>{o.textHi}</span>
                            )}
                          </>
                        )}
                      </span>
                      <span aria-hidden="true" className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${active ? "border-primary-foreground bg-primary-foreground text-primary" : "border-border text-transparent"}`}>
                        <CheckIcon className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                <button type="button" onClick={() => onMark(i, q.id)} aria-pressed={marked} className="btn btn-outline min-h-[40px] touch-manipulation text-xs">{marked ? "⚑ Unmark" : "⚑ Mark"}</button>
                <button type="button" onClick={() => onClear(i, q.id)} disabled={!answers[q.id]} className="btn btn-outline min-h-[40px] touch-manipulation text-xs disabled:opacity-40">{tr("Clear response", "Jawab hatao")}</button>
              </div>
            </article>
          );
        })}

        <button type="button" onClick={onReview} className="btn btn-outline min-h-[44px] w-full font-semibold">{tr("Review & Submit", "Review aur Submit")}</button>

        {pages > 1 && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="btn btn-outline min-h-[44px] flex-1 disabled:opacity-40">← {tr("Previous", "Pichhle")}</button>
            <span className="shrink-0 text-xs text-muted-foreground">{safePage + 1} / {pages}</span>
            <button type="button" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} className="btn btn-outline min-h-[44px] flex-1 disabled:opacity-40">{tr("Next", "Agle")} →</button>
          </div>
        )}
      </div>
    </div>
  );
}
