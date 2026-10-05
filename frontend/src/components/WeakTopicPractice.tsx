"use client";
import * as React from "react";
import { fetchAuth, API_BASE } from "@/lib/api";
import { useT } from "@/lib/i18n";

type WeakTopic = {
  subjectId: string | null;
  subject: string;
  chapterId: string | null;
  chapter: string;
  topicId: string | null;
  topic: string;
  subTopicId: string | null;
  subTopic: string;
  wrongCount: number;
  practiceAvailable: number;
  practiceQuestions: number;
};

type Props = {
  /** Server-scored attempt (mock / daily test) — weak topics come from its wrong + skipped answers. */
  attemptId?: string;
  /** Practice / sectional sets have no server attempt: pass the ids of the questions the student missed. */
  questionIds?: string[];
  className?: string;
};

const keyOf = (t: WeakTopic) => `${t.chapterId ?? ""}|${t.topicId ?? ""}|${t.subTopicId ?? ""}`;
const labelOf = (t: WeakTopic) => [t.topic, t.subTopic].filter(Boolean).join(" › ") || t.chapter || "General";

/**
 * "What to do next" after a test: lists the weak topic / sub-topic of every question the student got wrong or
 * skipped (grouped Subject → Chapter), lets them pick any of them with their own question count, and starts ONE
 * custom practice set from the selection.
 */
export default function WeakTopicPractice({ attemptId, questionIds, className = "" }: Props) {
  const t = useT();
  const [topics, setTopics] = React.useState<WeakTopic[] | null>(null);
  const [picked, setPicked] = React.useState<Record<string, number>>({}); // key -> question count (absent = not selected)
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const idsKey = (questionIds ?? []).join(",");
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let res: Response | null = null;
        if (attemptId) {
          res = await fetchAuth(`${API_BASE}/bank/practice/from-attempt/${attemptId}`);
        } else if (questionIds && questionIds.length) {
          res = await fetchAuth(`${API_BASE}/bank/practice/weak-from-questions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ questionIds }),
          });
        }
        const d = res && res.ok ? await res.json().catch(() => null) : null;
        if (!cancelled) setTopics(Array.isArray(d?.topics) ? d.topics : []);
      } catch {
        if (!cancelled) setTopics([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, idsKey]);

  const grouped = React.useMemo(() => {
    const out: { subject: string; chapters: { chapter: string; rows: WeakTopic[] }[] }[] = [];
    for (const row of topics ?? []) {
      const sName = row.subject || t("Other", "Other");
      let s = out.find((x) => x.subject === sName);
      if (!s) out.push((s = { subject: sName, chapters: [] }));
      const cName = row.chapter || t("General", "General");
      let c = s.chapters.find((x) => x.chapter === cName);
      if (!c) s.chapters.push((c = { chapter: cName, rows: [] }));
      c.rows.push(row);
    }
    return out;
  }, [topics, t]);

  if (topics === null) {
    return (
      <div className={`card p-5 ${className}`}>
        <p className="text-sm text-muted-foreground">{t("Finding your weak topics…", "Aapke weak topics dhoondh rahe hain…")}</p>
      </div>
    );
  }
  if (topics.length === 0) return null; // nothing wrong/skipped with tagged topics -> nothing to practise

  const practicable = topics.filter((x) => x.practiceAvailable > 0);
  const selectedRows = practicable.filter((x) => picked[keyOf(x)] != null);
  const totalQs = selectedRows.reduce((n, x) => n + (picked[keyOf(x)] ?? 0), 0);

  const toggle = (row: WeakTopic) => {
    const k = keyOf(row);
    setPicked((p) => {
      const n = { ...p };
      if (n[k] != null) delete n[k];
      else n[k] = Math.max(1, Math.min(10, row.practiceAvailable, Math.max(5, row.wrongCount * 3)));
      return n;
    });
  };
  const setCount = (row: WeakTopic, v: number) => {
    const max = Math.min(50, row.practiceAvailable);
    setPicked((p) => ({ ...p, [keyOf(row)]: Math.max(1, Math.min(max, Math.floor(v) || 1)) }));
  };
  const selectAll = () => {
    const n: Record<string, number> = {};
    for (const row of practicable) n[keyOf(row)] = Math.max(1, Math.min(10, row.practiceAvailable, Math.max(5, row.wrongCount * 3)));
    setPicked(n);
  };

  const start = async () => {
    if (!selectedRows.length || busy) return;
    setBusy(true);
    setError("");
    try {
      const items = selectedRows.map((row) => ({
        ...(row.subTopicId ? { subTopicId: row.subTopicId } : row.topicId ? { topicId: row.topicId } : { chapterId: row.chapterId! }),
        count: picked[keyOf(row)],
      }));
      const r = await fetchAuth(`${API_BASE}/bank/practice/custom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(
          d?.code === "PREMIUM_REQUIRED"
            ? t("Free practice limit reached for today — get Premium for unlimited practice.", "Aaj ka free practice limit khatam — unlimited practice ke liye Premium lein.")
            : d?.message || t("Could not start practice. Please try again.", "Practice start nahi hui. Dobara try karein."),
        );
        return;
      }
      sessionStorage.setItem("ssc_sectional_set", JSON.stringify(d));
      sessionStorage.setItem("ssc_sectional_subject", d.chapterName || "Weak-topic practice");
      window.location.href = "/test?sectional=1";
    } catch {
      setError(t("Network error — please try again.", "Network error — dobara try karein."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`card border-amber-500/30 bg-amber-500/5 p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold">🎯 {t("Your weak topics from this test", "Is test ke aapke weak topics")}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(
              "Tick the topics you want to practise and choose how many questions for each. We build one practice set from your choices.",
              "Jo topics practice karne hain unhe tick karein aur har ek ke liye questions ki sankhya chunein. Aapke choice se ek practice set ban jayega.",
            )}
          </p>
        </div>
        {practicable.length > 1 && (
          <button onClick={selectAll} className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted">
            {t("Select all", "Sab chunein")}
          </button>
        )}
      </div>

      <div className="mt-3 space-y-4">
        {grouped.map((s) => (
          <div key={s.subject}>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{s.subject}</p>
            {s.chapters.map((c) => (
              <div key={c.chapter} className="mt-1.5">
                <p className="text-[11px] font-semibold text-muted-foreground">{c.chapter}</p>
                <div className="mt-1 space-y-1.5">
                  {c.rows.map((row) => {
                    const k = keyOf(row);
                    const on = picked[k] != null;
                    const none = row.practiceAvailable <= 0;
                    const max = Math.min(50, row.practiceAvailable);
                    return (
                      <div key={k} className={`flex items-center gap-3 rounded-lg border bg-background p-2.5 text-sm ${on ? "border-primary" : "border-border"}`}>
                        <input type="checkbox" checked={on} disabled={none} onChange={() => toggle(row)} className="h-4 w-4 shrink-0 accent-primary" aria-label={labelOf(row)} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{labelOf(row)}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {row.wrongCount} {t("missed in this test", "is test me galat/skip")} ·{" "}
                            {none ? t("practice questions coming soon", "practice questions jald aayenge") : `${row.practiceAvailable} ${t("practice questions available", "practice questions available")}`}
                          </p>
                        </div>
                        {on && (
                          <div className="flex shrink-0 items-center gap-1" aria-label={t("Number of questions", "Questions ki sankhya")}>
                            <button onClick={() => setCount(row, picked[k] - 1)} className="h-7 w-7 rounded-md border border-border font-bold hover:bg-muted" aria-label="−">−</button>
                            <input
                              type="number"
                              min={1}
                              max={max}
                              value={picked[k]}
                              onChange={(e) => setCount(row, Number(e.target.value))}
                              className="h-7 w-12 rounded-md border border-border bg-background text-center text-sm"
                            />
                            <button onClick={() => setCount(row, picked[k] + 1)} className="h-7 w-7 rounded-md border border-border font-bold hover:bg-muted" aria-label="+">+</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {error && <p className="mt-3 text-xs font-medium text-danger">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {selectedRows.length
            ? `${selectedRows.length} ${t("topics", "topics")} · ${totalQs} ${t("questions", "questions")}`
            : t("Select at least one topic to start.", "Shuru karne ke liye kam se kam ek topic chunein.")}
        </p>
        <button
          onClick={start}
          disabled={!selectedRows.length || busy}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? t("Preparing…", "Taiyaar ho raha hai…") : t("Start practice", "Practice shuru karein")}
          {selectedRows.length ? ` (${totalQs})` : ""}
        </button>
      </div>
    </div>
  );
}
