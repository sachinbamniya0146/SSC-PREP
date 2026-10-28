"use client";
/**
 * "Aaj" (today) screen of the Study Plan board.
 *
 * Everything on it is read from GET /study-plan/today: the exam date and days left, the pace estimate, today's three tasks
 * (practice questions, daily revision, chapters) with the real numbers done so far, the last 7 days, and per-subject progress.
 * No number is invented here; the screen only draws what the server sent.
 */
import * as React from "react";
import BiMessage from "@/components/BiMessage";
import { useT } from "@/lib/i18n";

type Bi = { en: string; hi: string };

export type PlanTodayData = {
  exam: { name: string };
  targetDate: string;
  daysLeft: number;
  revisionReserveDays: number;
  progress: { total: number; complete: number; weak: number; selfMarked: number; pending: number; pct: number };
  today: {
    chaptersToStudy: { id: string; name: string; subject: string; status: string }[];
    chaptersPerDay: number;
    practiceQuestions: number;
    practiceSets: number;
    pyqTestsPerWeek: number;
    answeredToday: number;
    chaptersDoneToday: number;
  };
  streakDays: number;
  goalDaysThisWeek: number;
  week: { day: string; answered: number; goalMet: boolean; isToday: boolean }[];
  pace: { status: "NO_DATA" | "JUST_STARTED" | "AHEAD" | "ON_TRACK" | "BEHIND"; expectedChapters: number; coveredChapters: number; delta: number; elapsedDays: number; totalDays: number };
  subjectProgress: { id: string; name: string; nameHindi: string | null; total: number; complete: number; weak: number }[];
  revision?: {
    available: boolean;
    testId?: string | null;
    doneToday?: boolean;
    scorePct?: number | null;
    chapters?: { id: string; name: string; subject: string }[];
    subjects?: string[];
    completeChapters?: number;
    notRevisedInWeek?: number;
    syllabusCycleDays?: number;
    message?: Bi;
  } | null;
  message: Bi;
};

const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const weekday = (day: string) => new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" });

function Bar({ pct, tone = "bg-primary", label }: { pct: number; tone?: string; label: string }) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={label}>
      <div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: `${p}%` }} />
    </div>
  );
}

function Task({
  done,
  title,
  detail,
  pct,
  action,
  children,
}: {
  done: boolean;
  title: string;
  detail: React.ReactNode;
  pct?: number;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
            done ? "border-success bg-success text-success-foreground" : "border-border text-transparent"
          }`}
        >
          ✓
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className={`text-sm font-semibold ${done ? "text-muted-foreground line-through decoration-1" : ""}`}>{title}</p>
            {!done && action}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
          {pct !== undefined && (
            <div className="mt-2">
              <Bar pct={pct} tone={done ? "bg-success" : "bg-primary"} label={title} />
            </div>
          )}
          {children}
        </div>
      </div>
    </li>
  );
}

const actionCls = "inline-flex min-h-[32px] items-center rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90";

export default function PlanToday({ data, onOpenChapters }: { data: PlanTodayData; onOpenChapters: () => void }) {
  const tr = useT();
  const t = data.today;
  const rv = data.revision;

  const practiceDone = t.answeredToday >= t.practiceQuestions;
  const practicePct = t.practiceQuestions ? (t.answeredToday / t.practiceQuestions) * 100 : 0;
  const chaptersTarget = t.chaptersPerDay;
  const chaptersDone = chaptersTarget === 0 || t.chaptersDoneToday >= chaptersTarget;
  const revisionApplies = !!rv?.available;
  const revisionDone = !!rv?.doneToday;
  const tasks = [practiceDone, ...(revisionApplies ? [revisionDone] : []), ...(chaptersTarget > 0 ? [chaptersDone] : [])];
  const doneCount = tasks.filter(Boolean).length;

  // week strip scale: the tallest bar is the larger of the daily target and the best day of the week
  const maxBar = Math.max(t.practiceQuestions, ...data.week.map((d) => d.answered), 1);

  const p = data.pace;
  const paceChip =
    p.status === "AHEAD"
      ? { cls: "border-success/40 bg-success/10", text: tr(`${p.delta} chapters ahead of plan`, `Plan se ${p.delta} chapter aage`) }
      : p.status === "ON_TRACK"
        ? { cls: "border-primary/40 bg-primary/10", text: tr("On track", "Sahi raste par") }
        : p.status === "BEHIND"
          ? { cls: "border-warning/50 bg-warning/10", text: tr(`${-p.delta} chapters behind — ${t.chaptersPerDay}/day catches you up`, `${-p.delta} chapter peeche — roz ${t.chaptersPerDay} karoge to pakad lo`) }
          : p.status === "JUST_STARTED"
            ? { cls: "border-border bg-muted/50", text: tr("Plan just started — begin with one chapter today", "Plan abhi shuru hua — aaj ek chapter se shuru karo") }
            : null;

  return (
    <div className="mt-4 space-y-4">
      {/* ---- hero: exam date, days left, syllabus progress, pace ---- */}
      <section className="rounded-2xl border border-border bg-card p-5" aria-label={tr("Plan summary", "Plan summary")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">{data.exam.name}</p>
            <p className="mt-0.5 text-3xl font-bold tabular-nums">
              {data.daysLeft} <span className="text-base font-semibold">{tr("days left", "din baaki")}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tr("Target date", "Target date")} {fmtDate(data.targetDate)} ·{" "}
              <a href="/study-plan?edit=1" className="font-semibold text-primary underline">{tr("Change", "Badlein")}</a>
            </p>
          </div>
          <div className="shrink-0 rounded-xl border border-border bg-background px-3 py-2 text-center">
            <p className="text-xl font-extrabold leading-none tabular-nums text-accent">🔥 {data.streakDays}</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{tr("day streak", "din streak")}</p>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between text-xs">
            <span className="font-semibold">{tr("Syllabus done", "Syllabus complete")}</span>
            <span className="tabular-nums text-muted-foreground">
              {data.progress.complete}/{data.progress.total} {tr("chapters", "chapters")} · {data.progress.pct}%
            </span>
          </div>
          <Bar pct={data.progress.pct} tone="bg-success" label={tr("Syllabus done", "Syllabus complete")} />
          {(data.progress.selfMarked > 0 || data.progress.weak > 0) && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {data.progress.selfMarked > 0 && `🕘 ${data.progress.selfMarked} ${tr("waiting for their test", "test ka intezaar")}`}
              {data.progress.selfMarked > 0 && data.progress.weak > 0 && " · "}
              {data.progress.weak > 0 && `⚠️ ${data.progress.weak} ${tr("weak — practise again", "weak — dobara practice karo")}`}
            </p>
          )}
        </div>
        {paceChip && (
          <p className={`mt-3 rounded-lg border px-3 py-2 text-xs font-medium ${paceChip.cls}`}>
            {paceChip.text}
            {p.status !== "JUST_STARTED" && (
              <span className="mt-0.5 block font-normal text-muted-foreground">
                {tr(`Estimate: ${p.coveredChapters} covered, ${p.expectedChapters} expected by today`, `Andaza: ${p.coveredChapters} cover hue, aaj tak ${p.expectedChapters} hone chahiye the`)}
                {data.revisionReserveDays > 0 && ` · ${tr(`last ${data.revisionReserveDays} days = revision + mocks`, `aakhri ${data.revisionReserveDays} din = revision + mocks`)}`}
              </span>
            )}
          </p>
        )}
      </section>

      {/* ---- today's tasks ---- */}
      <section className="rounded-2xl border border-border bg-card p-5" aria-label={tr("Today's tasks", "Aaj ke kaam")}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">{tr("Today's plan", "Aaj ka plan")}</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${doneCount === tasks.length ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
            {doneCount}/{tasks.length} {tr("done", "ho gaye")}
          </span>
        </div>
        <ul className="divide-y divide-border">
          <Task
            done={practiceDone}
            title={tr(`Practice ${t.practiceQuestions} questions`, `${t.practiceQuestions} sawal practice karo`)}
            detail={
              <>
                <span className="tabular-nums">{t.answeredToday}/{t.practiceQuestions}</span> {tr("answered today", "aaj solve hue")} · {t.practiceSets} {tr("sets of 25", "sets (25 ke)")}
              </>
            }
            pct={practicePct}
            action={<a href="/question-bank-practice" className={actionCls}>{tr("Practice", "Practice")}</a>}
          />
          {revisionApplies && (
            <Task
              done={revisionDone}
              title={tr("Daily revision — 50 questions", "Roz ka revision — 50 sawal")}
              detail={
                revisionDone
                  ? `${tr("Done", "Ho gaya")}${rv?.scorePct != null ? ` · ${tr("score", "score")} ${rv.scorePct}%` : ""} 🎉`
                  : `${rv?.subjects?.join(" · ") ?? ""} — ${rv?.chapters?.length ?? 0} ${tr("of your", "aapke")} ${rv?.completeChapters ?? 0} ${tr("completed chapters", "complete chapters me se")}`
              }
              action={
                rv?.testId ? <a href={`/test?plantest=${rv.testId}`} className={actionCls}>{tr("Start revision", "Revision shuru")}</a> : undefined
              }
            >
              {!revisionDone && (rv?.chapters?.length ?? 0) > 0 && (
                <details className="mt-1.5 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    {tr("Which chapters?", "Kaun se chapters?")}
                    {rv?.notRevisedInWeek ? ` · ${rv.notRevisedInWeek} ${tr("not revised for 7 days", "7 din se revise nahi hue")}` : ""}
                  </summary>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {rv?.chapters?.map((c) => (
                      <li key={c.id} className="rounded-md bg-muted px-2 py-0.5 text-[11px]">{c.name}</li>
                    ))}
                  </ul>
                </details>
              )}
            </Task>
          )}
          {chaptersTarget > 0 && (
            <Task
              done={chaptersDone}
              title={tr(`Finish ${chaptersTarget} chapter${chaptersTarget > 1 ? "s" : ""}`, `${chaptersTarget} chapter khatam karo`)}
              detail={
                <>
                  <span className="tabular-nums">{t.chaptersDoneToday}/{chaptersTarget}</span> {tr("marked today — tomorrow's 9 AM test checks them", "aaj mark hue — kal 9 AM ka test inhe check karega")}
                </>
              }
              pct={(t.chaptersDoneToday / chaptersTarget) * 100}
              action={<button type="button" onClick={onOpenChapters} className={actionCls}>{tr("Mark chapters", "Chapters mark karo")}</button>}
            />
          )}
        </ul>
        {!revisionApplies && rv && rv.message && (
          <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">🔁 {tr(rv.message.en, rv.message.hi)}</p>
        )}
        {chaptersTarget === 0 && (
          <p className="mt-3 text-xs text-muted-foreground">{tr("Every chapter is complete 🎉 Spend the days on full mocks and revision.", "Saare chapters complete 🎉 Ab full mocks aur revision par lago.")}</p>
        )}
      </section>

      {/* ---- last 7 days ---- */}
      <section className="rounded-2xl border border-border bg-card p-5" aria-label={tr("Last 7 days", "Pichhle 7 din")}>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold">{tr("Last 7 days", "Pichhle 7 din")}</h2>
          <span className="text-xs text-muted-foreground">
            {data.goalDaysThisWeek}/7 {tr(`days reached ${t.practiceQuestions} questions`, `din ${t.practiceQuestions} sawal poore hue`)}
          </span>
        </div>
        <div
          className="relative grid grid-cols-7 gap-2"
          role="img"
          aria-label={`${tr("Questions answered per day", "Roz kitne sawal solve hue")}: ${data.week.map((d) => `${weekday(d.day)} ${d.answered}`).join(", ")}`}
        >
          {data.week.map((d) => {
            const h = d.answered > 0 ? Math.max(6, Math.round((d.answered / maxBar) * 100)) : 0;
            return (
              <div key={d.day} className="flex flex-col items-center gap-1">
                <span className="text-[10px] tabular-nums text-muted-foreground">{d.answered || ""}</span>
                <div className="relative flex h-20 w-full items-end overflow-hidden rounded-md bg-muted/60">
                  <div
                    className={`w-full rounded-md transition-all duration-500 ${d.goalMet ? "bg-success" : d.isToday ? "bg-primary" : "bg-muted-foreground/40"}`}
                    style={{ height: `${h}%` }}
                  />
                </div>
                <span className={`text-[10px] font-semibold ${d.isToday ? "text-primary" : "text-muted-foreground"}`}>{d.isToday ? tr("Today", "Aaj") : weekday(d.day)}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-success align-middle" /> {tr("target reached", "target poora")}
          <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-sm bg-primary align-middle" /> {tr("today", "aaj")}
        </p>
      </section>

      {/* ---- chapters to study today ---- */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-bold">📖 {tr("Chapters to study today", "Aaj padhne wale chapters")}</h2>
        {t.chaptersToStudy.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{tr("All chapters are complete! 🎉 Now take full mocks.", "Sab chapters complete! 🎉 Ab full mocks do.")}</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {t.chaptersToStudy.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {c.status === "WEAK" && "⚠️ "}
                  {c.name} <span className="text-xs text-muted-foreground">· {c.subject}</span>
                </span>
                <a href={`/question-bank-practice?${qs({ chapterId: c.id })}`} className="shrink-0 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                  {tr("Practice", "Practice")}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- subject-wise progress ---- */}
      {data.subjectProgress.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-5" aria-label={tr("Subject-wise progress", "Subject-wise progress")}>
          <h2 className="text-sm font-bold">{tr("Subject-wise progress", "Subject-wise progress")}</h2>
          <ul className="mt-3 space-y-3">
            {data.subjectProgress.map((s) => (
              <li key={s.id}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate font-semibold">{s.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {s.complete}/{s.total}
                    {s.weak > 0 && <span className="ml-2 text-warning">⚠️ {s.weak}</span>}
                  </span>
                </div>
                <Bar pct={s.total ? (s.complete / s.total) * 100 : 0} tone="bg-success" label={s.name} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <BiMessage msg={data.message} />

      <div className="grid grid-cols-2 gap-3 text-center text-sm">
        <a href="/question-bank-practice" className="rounded-xl border border-border bg-card p-4">
          <div className="text-2xl font-bold">{t.practiceQuestions}</div>
          <div className="text-xs text-muted-foreground">{tr("practice questions / day", "practice sawal / din")}</div>
        </a>
        <a href="/year-wise" className="rounded-xl border border-border bg-card p-4">
          <div className="text-2xl font-bold">{t.pyqTestsPerWeek}</div>
          <div className="text-xs text-muted-foreground">{tr("PYQ mocks / week", "PYQ mocks / hafta")}</div>
        </a>
      </div>
    </div>
  );
}
