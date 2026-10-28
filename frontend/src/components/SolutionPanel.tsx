"use client";

/**
 * Shared post-test review building blocks (Oct 2026):
 *  - useReviewLang / ReviewLangToggle : English | हिंदी | Both, remembered on the device
 *  - ReviewQuestionBody               : the FULL question + every option, bilingual, with your / correct markers
 *  - SolutionPanel                    : detailed solution (answer, steps, shortcut, why other options are wrong,
 *                                       common mistake, key concepts) in English / Hindi, read from the stored solution
 *                                       of the question, with a source badge.
 * Used by the in-test results screen AND /results/[attemptId], so both look and behave the same.
 */
import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";
import DiagramVenn from "@/components/DiagramVenn";
import { QFigure, RichText, StemMedia } from "@/components/QuestionMedia";

export type ReviewLang = "en" | "hi" | "both";
const LANG_KEY = "ssc_review_lang";

export function useReviewLang(): [ReviewLang, (l: ReviewLang) => void] {
  const [lang, setLang] = React.useState<ReviewLang>("both");
  React.useEffect(() => {
    try {
      const v = localStorage.getItem(LANG_KEY);
      if (v === "en" || v === "hi" || v === "both") setLang(v);
    } catch {
      /* ignore */
    }
  }, []);
  const set = React.useCallback((l: ReviewLang) => {
    setLang(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);
  return [lang, set];
}

export function ReviewLangToggle({ lang, onChange, className = "" }: { lang: ReviewLang; onChange: (l: ReviewLang) => void; className?: string }) {
  const items: { v: ReviewLang; label: string }[] = [
    { v: "en", label: "English" },
    { v: "hi", label: "हिंदी" },
    { v: "both", label: "EN + हिं" },
  ];
  return (
    <div role="group" aria-label="Language" className={`inline-flex rounded-lg bg-muted p-0.5 text-xs ${className}`}>
      {items.map((i) => (
        <button
          key={i.v}
          type="button"
          onClick={() => onChange(i.v)}
          aria-pressed={lang === i.v}
          className={`rounded-md px-2.5 py-1 font-semibold transition ${lang === i.v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

/** English and/or Hindi text stacked (never joined with " / " on one line). Falls back to whichever exists. */
export function Bilingual({ en, hi, lang, className = "", hiClassName = "" }: { en?: string | null; hi?: string | null; lang: ReviewLang; className?: string; hiClassName?: string }) {
  const showEn = lang === "en" || lang === "both" || !hi;
  const showHi = (lang === "hi" || lang === "both") && !!hi;
  const enText = showEn ? en : null;
  if (!enText && !showHi) return <span className={className}>{en || hi}</span>;
  return (
    <span className={`block ${className}`}>
      {enText && <span className="block">{enText}</span>}
      {showHi && (
        <span className={`block font-hindi ${enText ? "mt-1 border-l-2 border-primary/40 pl-2.5 text-muted-foreground" : ""} ${hiClassName}`}>{hi}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- question + options

export type ReviewOption = {
  key: string;
  text: string;
  textHi?: string | null;
  diagramType?: string | null;
  diagramLabels?: (string | null)[] | null;
  imageUrl?: string | null;
};

export function ReviewQuestionBody(props: {
  questionText: string;
  questionTextHindi?: string | null;
  diagramType?: string | null;
  diagramLabels?: (string | null)[] | null;
  imageUrl?: string | null;
  options: ReviewOption[];
  selected?: string | null;
  correct?: string | null;
  lang: ReviewLang;
}) {
  const { options, selected, lang } = props;
  const correct = (props.correct || "").trim().toUpperCase();
  const sel = (selected || "").trim().toUpperCase();
  return (
    <div>
      <h3 className="break-words text-sm font-semibold leading-relaxed sm:text-base">
        <Bilingual en={props.questionText} hi={props.questionTextHindi} lang={lang} />
      </h3>
      <StemMedia diagramType={props.diagramType} diagramLabels={props.diagramLabels} imageUrl={props.imageUrl} />
      <div className="mt-3 space-y-2">
        {options.map((o) => {
          const k = (o.key || "").trim().toUpperCase();
          const isCorrect = k === correct;
          const isSel = k === sel;
          const cls = isCorrect ? "border-success bg-success/10" : isSel ? "border-danger bg-danger/10" : "border-border bg-card";
          return (
            <div key={o.key} className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${cls}`}>
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                  isCorrect ? "border-success bg-success text-success-foreground" : isSel ? "border-danger bg-danger text-danger-foreground" : "border-input"
                }`}
              >
                {o.key}
              </span>
              <span className="min-w-0 flex-1 leading-relaxed">
                {o.diagramType ? (
                  <DiagramVenn type={o.diagramType} labels={o.diagramLabels} size={120} />
                ) : o.imageUrl ? (
                  <QFigure src={o.imageUrl} alt={`Option ${o.key}`} className="max-h-32" />
                ) : (
                  <Bilingual en={o.text} hi={o.textHi} lang={lang} />
                )}
              </span>
              <span className="ml-1 flex shrink-0 flex-col items-end gap-1 text-[11px] font-bold">
                {isCorrect && <span className="rounded-full bg-success/15 px-2 py-0.5 text-success">✓ Correct</span>}
                {isSel && !isCorrect && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-danger">Your answer</span>}
                {isSel && isCorrect && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">You chose</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- solution parsing

export type ParsedSolution = {
  answer?: string;
  steps: string;
  shortcut?: string;
  others: { option: string; reason: string }[];
  mistake?: string;
  concepts: string[];
  structured: boolean;
};

const MARK = /^##(ANSWER|STEPS|SHORTCUT|OTHERS|MISTAKE|CONCEPTS)\s*$/;

/** Splits a stored solution into sections. Old / plain explanations simply become one "steps" block. */
export function parseSolution(text?: string | null): ParsedSolution {
  const out: ParsedSolution = { steps: "", others: [], concepts: [], structured: false };
  const raw = (text ?? "").trim();
  if (!raw) return out;
  if (!/^##(ANSWER|STEPS)\s*$/m.test(raw)) {
    out.steps = raw;
    return out;
  }
  out.structured = true;
  const buckets: Record<string, string[]> = {};
  let cur = "";
  for (const line of raw.split("\n")) {
    const m = line.trim().match(MARK);
    if (m) {
      cur = m[1];
      buckets[cur] = [];
    } else if (cur) {
      buckets[cur].push(line);
    }
  }
  const j = (k: string) => (buckets[k] || []).join("\n").trim();
  out.answer = j("ANSWER") || undefined;
  out.steps = j("STEPS");
  out.shortcut = j("SHORTCUT") || undefined;
  out.mistake = j("MISTAKE") || undefined;
  out.others = j("OTHERS")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Da-d])[).:\-]\s*(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ option: m[1].toUpperCase(), reason: m[2].trim() }));
  out.concepts = j("CONCEPTS")
    .split("\n")
    .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean);
  return out;
}

type AiData = {
  explanation?: string | null;
  explanationHindi?: string | null;
  source?: string | null;
};

const L = {
  answer: ["Correct answer", "सही उत्तर"],
  steps: ["Step-by-step solution", "चरण-दर-चरण हल"],
  shortcut: ["Shortcut / trick", "शॉर्टकट / ट्रिक"],
  others: ["Why the other options are wrong", "बाकी विकल्प गलत क्यों हैं"],
  mistake: ["Common mistake", "आम गलती"],
  concepts: ["Key concepts", "मुख्य बातें"],
} as const;

function SolutionBody({ s, hindi }: { s: ParsedSolution; hindi: boolean }) {
  const t = (k: keyof typeof L) => L[k][hindi ? 1 : 0];
  const body = hindi ? "font-hindi" : "";
  return (
    <div className={`space-y-3 text-sm leading-relaxed ${body}`}>
      {s.answer && (
        <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-success">{t("answer")}</p>
          <p className="mt-0.5 font-semibold">{s.answer}</p>
        </div>
      )}
      {s.steps && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{t("steps")}</p>
          <RichText text={s.steps} className="mt-1 text-foreground/90" />
        </div>
      )}
      {s.shortcut && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-warning">⚡ {t("shortcut")}</p>
          <RichText text={s.shortcut} className="mt-0.5" />
        </div>
      )}
      {s.others.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{t("others")}</p>
          <ul className="mt-1.5 space-y-1.5">
            {s.others.map((o) => (
              <li key={o.option} className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-danger/40 bg-danger/10 text-[11px] font-bold text-danger">{o.option}</span>
                <span className="text-muted-foreground">{o.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.mistake && (
        <div className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-danger">⚠️ {t("mistake")}</p>
          <p className="mt-0.5">{s.mistake}</p>
        </div>
      )}
      {s.concepts.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">📌 {t("concepts")}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {s.concepts.map((c) => (
              <span key={c} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{c}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the panel

export function SolutionPanel({
  questionId,
  correctKey,
  correctLabel,
  explanation,
  explanationHindi,
  source,
  lang,
}: {
  questionId: string;
  correctKey?: string | null;
  correctLabel?: string | null;
  explanation?: string | null;
  explanationHindi?: string | null;
  source?: string | null;
  lang: ReviewLang;
}) {
  const [data, setData] = React.useState<AiData | null>(
    explanation || explanationHindi ? { explanation, explanationHindi, source } : null,
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [noSolution, setNoSolution] = React.useState(false); // 404 = this question has no stored solution (retry is pointless)

  // props can arrive after first render (post-submit fetch) - adopt them when we have nothing yet
  React.useEffect(() => {
    if ((explanation || explanationHindi) && !data) setData({ explanation, explanationHindi, source });
  }, [explanation, explanationHindi, source, data]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAuth(`${API_BASE}/explanations/questions/${questionId}`);
      const d = await res.json().catch(() => ({}));
      if (res.ok && (d?.explanation || d?.explanationHindi)) setData({ explanation: d.explanation, explanationHindi: d.explanationHindi, source: d.source ?? null });
      else {
        setNoSolution(res.status === 404);
        setError(d?.message || "The solution is not available yet.");
      }
    } catch {
      setError(typeof navigator !== "undefined" && !navigator.onLine ? "You are offline. The solution will load when you are back online." : "Network error. The solution could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [questionId]);

  // the page did not pass a solution: read the stored one once, automatically
  const started = React.useRef(false);
  React.useEffect(() => {
    if (!data && !started.current) {
      started.current = true;
      void load();
    }
  }, [data, load]);

  const src = data?.source ?? source ?? null;
  const badge =
    src === "AI_GENERATED" ? { t: "🤖 AI generated", c: "bg-primary/10 text-primary" }
    : src === "COMMUNITY_VERIFIED" ? { t: "✅ Verified by students", c: "bg-success/10 text-success" }
    : src === "HUMAN_VERIFIED" ? { t: "✅ Verified by team", c: "bg-success/10 text-success" }
    : src === "PDF" ? { t: "📄 From paper", c: "bg-muted text-muted-foreground" }
    : null;

  const en = parseSolution(data?.explanation);
  const hi = parseSolution(data?.explanationHindi);
  const hasEn = !!(en.steps || en.answer);
  const hasHi = !!(hi.steps || hi.answer);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-bold">💡 Solution</h4>
        {badge && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.c}`}>{badge.t}</span>}
        {correctKey && (
          <span className="ml-auto rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-bold text-success">
            Answer: {correctKey}
            {correctLabel ? ` — ${correctLabel}` : ""}
          </span>
        )}
      </div>

      {loading && (
        <div className="mt-3 space-y-2" aria-busy="true">
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-5/6" />
          <p className="pt-1 text-xs text-muted-foreground">Loading solution…</p>
        </div>
      )}

      {error && !loading && (
        <div className="mt-3 rounded-lg border border-danger/25 bg-danger/5 p-3 text-xs">
          <p className="text-muted-foreground">{error}</p>
          {!noSolution && (
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 rounded-md border border-primary/40 px-3 py-1 font-semibold text-primary hover:bg-primary/10"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {data && !loading && (
        <div className="mt-3 space-y-4">
          {(lang === "en" || lang === "both" || !hasHi) && hasEn && <SolutionBody s={en} hindi={false} />}
          {(lang === "hi" || lang === "both") && hasHi && (
            <div className={lang === "both" && hasEn ? "border-t border-border pt-4" : ""}>
              <SolutionBody s={hi} hindi />
            </div>
          )}
          {lang === "hi" && !hasHi && hasEn && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">The Hindi version of this solution is not available yet, so the English one is shown.</p>
          )}
        </div>
      )}
    </div>
  );
}
