"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { AppShell, PageHeading, EmptyState, ErrorNote } from "@/components/AppShell";

type Period = "today" | "week" | "month" | "year" | "all";
type Tot = { questions: number; correct: number; wrong: number; accuracy: number };
type Bucket = { key: string; questions: number; correct: number };
type Chapter = { chapterId: string | null; chapter: string; chapterHindi: string | null; questions: number; correct: number; wrong: number; accuracy: number };
type Subject = { subjectId: string | null; subject: string; subjectHindi: string | null; questions: number; correct: number; wrong: number; accuracy: number; chapters: Chapter[] };
type Overview = {
  period: Period;
  totals: Record<Period, Tot>;
  firstDay: string | null;
  activeDays: number;
  series: { daily: Bucket[]; weekly: Bucket[]; monthly: Bucket[] };
  subjects: Subject[];
};

const PERIODS: { id: Period; en: string; hi: string }[] = [
  { id: "today", en: "Today", hi: "Aaj" },
  { id: "week", en: "This week", hi: "Is hafte" },
  { id: "month", en: "This month", hi: "Is mahine" },
  { id: "year", en: "This year", hi: "Is saal" },
  { id: "all", en: "Since I started", hi: "Shuru se ab tak" },
];

const bi = (en: string, hi: string | null) => (hi && hi.trim() && hi.trim() !== en.trim() ? `${en} · ${hi.trim()}` : en);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function label(kind: "daily" | "weekly" | "monthly", key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return kind === "monthly" ? `${MONTHS[m - 1]} ${String(y).slice(2)}` : `${d} ${MONTHS[m - 1]}`;
}
function niceDate(key: string | null): string {
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function Bars({ data, kind, tr }: { data: Bucket[]; kind: "daily" | "weekly" | "monthly"; tr: (en: string, hi: string) => string }) {
  const max = Math.max(1, ...data.map((b) => b.questions));
  return (
    <div>
      <div className="flex h-40 items-end gap-[3px]" role="img" aria-label={tr("Questions solved per period", "Har period me solve kiye sawal")}>
        {data.map((b) => {
          const h = Math.round((b.questions / max) * 100);
          const rightH = b.questions > 0 ? Math.round((b.correct / b.questions) * h) : 0;
          return (
            <div key={b.key} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`${label(kind, b.key)}: ${b.questions} (${b.correct} ${tr("right", "sahi")})`}>
              <div className="w-full rounded-t bg-danger/40" style={{ height: `${Math.max(0, h - rightH)}%` }} />
              <div className="w-full bg-success/70" style={{ height: `${rightH}%`, minHeight: b.questions > 0 && rightH === 0 && h === 0 ? 2 : undefined }} />
              {b.questions === 0 && <div className="h-[2px] w-full bg-border" />}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{label(kind, data[0].key)}</span>
        <span>{label(kind, data[data.length - 1].key)}</span>
      </div>
    </div>
  );
}

export default function ProgressPage() {
  const t = useT();
  const [period, setPeriod] = React.useState<Period>("week");
  const [kind, setKind] = React.useState<"daily" | "weekly" | "monthly">("daily");
  const [data, setData] = React.useState<Overview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [needsLogin, setNeedsLogin] = React.useState(false);
  const [openSubject, setOpenSubject] = React.useState<string>("");

  const load = React.useCallback(async (p: Period) => {
    setLoading(true);
    setError(false);
    try {
      if (!localStorage.getItem("ssc_access_token")) {
        setNeedsLogin(true);
        return;
      }
    } catch {
      /* private mode: let the request decide */
    }
    try {
      setData(await api<Overview>(`/study-stats?period=${p}`));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load(period);
  }, [load, period]);

  const tot = data?.totals[period];
  const series = data ? data.series[kind] : [];
  const kinds: { id: "daily" | "weekly" | "monthly"; en: string; hi: string }[] = [
    { id: "daily", en: "30 days", hi: "30 din" },
    { id: "weekly", en: "12 weeks", hi: "12 hafte" },
    { id: "monthly", en: "12 months", hi: "12 mahine" },
  ];

  return (
    <AppShell width="lg">
      <PageHeading
        title={t("My progress", "Meri progress")}
        subtitle={t("How many questions you solved: by day, week, month, year, and by subject and chapter.", "Kitne sawal solve kiye: din, hafta, mahina, saal, aur subject-chapter wise.")}
      />

      {needsLogin ? (
        <EmptyState title={t("Please log in", "Pehle login karein")} action={<a className="btn btn-primary" href="/login">{t("Log in", "Login")}</a>} />
      ) : error ? (
        <ErrorNote onRetry={() => void load(period)}>{t("Could not load your progress.", "Progress load nahi hui.")}</ErrorNote>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label={t("Period", "Period")}>
            {PERIODS.map((p) => (
              <button key={p.id} role="tab" aria-selected={period === p.id} onClick={() => setPeriod(p.id)} className={`btn btn-sm ${period === p.id ? "btn-primary" : "btn-outline"}`}>
                {t(p.en, p.hi)}
                {data ? <span className="ml-1.5 opacity-80">{data.totals[p.id].questions}</span> : null}
              </button>
            ))}
          </div>

          {loading && !data ? (
            <div className="card p-6 text-sm text-muted-foreground">{t("Loading…", "Load ho raha hai…")}</div>
          ) : data && data.totals.all.questions === 0 ? (
            <EmptyState
              title={t("No questions solved yet", "Abhi tak koi sawal solve nahi hua")}
              body={t("Take a practice set or a test. Every answered question is counted here.", "Practice set ya test do. Har answer kiya hua sawal yahan ginta hai.")}
              action={<a className="btn btn-primary" href="/question-bank-practice">{t("Start practice", "Practice shuru karo")}</a>}
            />
          ) : data && tot ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  [String(tot.questions), t("solved", "solve kiye")],
                  [String(tot.correct), t("right", "sahi")],
                  [String(tot.wrong), t("wrong", "galat")],
                  [`${tot.accuracy}%`, t("accuracy", "accuracy")],
                ].map(([v, l]) => (
                  <div key={l} className="card px-3 py-4 text-center">
                    <p className="text-2xl font-extrabold tabular-nums sm:text-3xl">{v}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{l}</p>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {data.firstDay ? t(`You started on ${niceDate(data.firstDay)} · ${data.activeDays} days of study`, `Aapne ${niceDate(data.firstDay)} se shuru kiya · ${data.activeDays} din padhai`) : ""}
              </p>

              <section className="card mt-5 p-4" aria-label={t("Chart", "Chart")}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-bold">{t("Questions solved", "Solve kiye sawal")}</h2>
                  <div className="flex gap-1">
                    {kinds.map((k) => (
                      <button key={k.id} onClick={() => setKind(k.id)} className={`btn btn-sm ${kind === k.id ? "btn-primary" : "btn-outline"}`}>{t(k.en, k.hi)}</button>
                    ))}
                  </div>
                </div>
                <Bars data={series} kind={kind} tr={t} />
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="mr-3"><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-success/70" />{t("right", "sahi")}</span>
                  <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-danger/40" />{t("wrong", "galat")}</span>
                </p>
              </section>

              <section className="mt-5" aria-label={t("By subject and chapter", "Subject aur chapter wise")}>
                <h2 className="mb-2 text-sm font-bold">{t("By subject and chapter", "Subject aur chapter wise")} · {t(PERIODS.find((p) => p.id === period)!.en, PERIODS.find((p) => p.id === period)!.hi)}</h2>
                {data.subjects.length === 0 ? (
                  <div className="card p-4 text-sm text-muted-foreground">{t("Nothing solved in this period.", "Is period me kuch solve nahi hua.")}</div>
                ) : (
                  <ul className="space-y-2">
                    {data.subjects.map((s) => {
                      const key = s.subjectId ?? "-";
                      const open = openSubject === key;
                      return (
                        <li key={key} className="card overflow-hidden">
                          <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" aria-expanded={open} onClick={() => setOpenSubject(open ? "" : key)}>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold">{bi(s.subject, s.subjectHindi)}</span>
                              <span className="text-xs text-muted-foreground">{s.questions} {t("solved", "solve")} · {s.correct} {t("right", "sahi")} · {s.wrong} {t("wrong", "galat")}</span>
                            </span>
                            <span className="shrink-0 text-sm font-bold tabular-nums">{s.accuracy}%</span>
                          </button>
                          {open && (
                            <ul className="divide-y divide-border border-t border-border">
                              {s.chapters.map((c) => (
                                <li key={c.chapterId ?? c.chapter} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                                  <span className="min-w-0">
                                    <span className="block truncate">{bi(c.chapter, c.chapterHindi)}</span>
                                    <span className="text-xs text-muted-foreground">{c.questions} {t("solved", "solve")} · {c.correct} {t("right", "sahi")} · {c.wrong} {t("wrong", "galat")}</span>
                                  </span>
                                  <span className="flex shrink-0 items-center gap-2">
                                    <span className={`font-semibold tabular-nums ${c.accuracy < 60 ? "text-danger" : "text-success"}`}>{c.accuracy}%</span>
                                    {c.chapterId && c.accuracy < 60 && <a className="btn btn-outline btn-sm" href={`/question-bank-practice?chapterId=${encodeURIComponent(c.chapterId)}`}>{t("Practice", "Practice")}</a>}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <p className="mt-5 text-sm">
                <a className="font-semibold text-primary underline" href="/weak-topics">{t("See my weak topics and practice them →", "Meri kamzor topics dekho aur practice karo →")}</a>
              </p>
            </>
          ) : null}
        </>
      )}
    </AppShell>
  );
}
