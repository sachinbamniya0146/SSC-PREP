"use client";

/**
 * Vocabulary quiz / revision result: every question with ALL its options,
 * the correct one marked, the student's pick marked, "N options" shown, and the
 * solution in English and/or हिंदी (same language toggle as the exam review).
 */
import * as React from "react";
import { CheckIcon } from "@/components/TickBox";
import { Bilingual, ReviewLangToggle, useReviewLang, type ReviewLang } from "@/components/SolutionPanel";
import { useT } from "@/lib/i18n";

export type VocabReviewItem = {
  id: string;
  questionText: string;
  options: { key: string; text: string }[];
  givenAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean;
  explanation?: string | null;
  explanationHindi?: string | null;
};

const norm = (s?: string | null) => (s || "").trim().toUpperCase();

export function VocabReviewCard({ r, index, lang }: { r: VocabReviewItem; index: number; lang: ReviewLang }) {
  const tr = useT();
  const correct = norm(r.correctAnswer);
  const given = norm(r.givenAnswer);
  const options = Array.isArray(r.options) ? r.options : [];
  const correctOpt = options.find((o) => norm(o.key) === correct);
  const hasSolution = !!(r.explanation || r.explanationHindi);

  return (
    <article className={`rounded-xl border p-3 text-sm sm:p-4 ${r.isCorrect ? "border-emerald-500/30" : given ? "border-danger/30" : "border-amber-500/30"}`}>
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
        <span className="rounded-md bg-muted px-2 py-0.5">Q{index + 1}</span>
        <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
          {options.length} {tr("options", "options")}
        </span>
        <span className={`rounded-md px-2 py-0.5 ${r.isCorrect ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : given ? "bg-danger/10 text-danger" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>
          {r.isCorrect ? tr("Correct", "Sahi") : given ? tr("Wrong", "Galat") : tr("Skipped", "Chhoda")}
        </span>
      </div>

      <p className="mt-2 break-words font-semibold leading-relaxed">{r.questionText}</p>

      <ul className="mt-3 space-y-2" aria-label={tr("Options", "Options")}>
        {options.map((o) => {
          const k = norm(o.key);
          const isCorrect = k === correct;
          const isPicked = k === given;
          const tone = isCorrect ? "border-emerald-500 bg-emerald-500/10" : isPicked ? "border-danger bg-danger/10" : "border-border bg-card";
          return (
            <li key={o.key} className={`flex items-start gap-3 rounded-xl border p-2.5 ${tone}`}>
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                  isCorrect ? "border-emerald-600 bg-emerald-600 text-white" : isPicked ? "border-danger bg-danger text-danger-foreground" : "border-input"
                }`}
              >
                {isCorrect ? <CheckIcon className="h-3.5 w-3.5" /> : o.key}
              </span>
              <span className="min-w-0 flex-1 break-words leading-relaxed">
                <span className="mr-1.5 font-semibold text-muted-foreground">{o.key}.</span>
                {o.text}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1 text-[10px] font-bold">
                {isCorrect && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">✓ {tr("Correct answer", "Sahi jawab")}</span>}
                {isPicked && !isCorrect && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-danger">{tr("Your answer", "Aapka jawab")}</span>}
                {isPicked && isCorrect && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">{tr("You chose", "Aapne chuna")}</span>}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-xs text-muted-foreground">
        {given ? <>{tr("Your answer", "Aapka jawab")}: <b>{given}</b> · </> : <>{tr("You skipped this question", "Aapne ye sawal chhoda")} · </>}
        {tr("Correct", "Sahi")}: <b className="text-emerald-600 dark:text-emerald-400">{correct}{correctOpt ? ` — ${correctOpt.text}` : ""}</b>
      </p>

      {hasSolution && (
        <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed">
          <p className="mb-1 font-bold">💡 {tr("Solution", "Solution")}</p>
          <Bilingual en={r.explanation} hi={r.explanationHindi} lang={lang} />
          {lang === "hi" && !r.explanationHindi && r.explanation && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">{tr("Hindi solution is not added yet — showing English.", "Hindi solution abhi nahi hai — English dikha rahe hain.")}</p>
          )}
        </div>
      )}
    </article>
  );
}

export function VocabReviewList({ items }: { items: VocabReviewItem[] }) {
  const tr = useT();
  const [lang, setLang] = useReviewLang();
  const hasHindi = items.some((i) => !!i.explanationHindi);
  return (
    <section className="mt-6 space-y-3" aria-label={tr("Review", "Review")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold">{tr("Review — every option with the solution", "Review — har option solution ke saath")}</h2>
        {hasHindi && <ReviewLangToggle lang={lang} onChange={setLang} />}
      </div>
      {items.map((r, i) => (
        <VocabReviewCard key={r.id} r={r} index={i} lang={lang} />
      ))}
    </section>
  );
}
