"use client";

// Study Plan v2 board (NEW — Sep 29 2026)
//
//  Aaj    — days left, today's chapters/practice/PYQ target from the exam date.
//  Chapters — tick the chapters you finished; a customised full-pattern test on
//            exactly those chapters is scheduled for tomorrow 9:00 AM (IST).
//  Test   — live countdown, what to revise (subject > chapters), Start at 9 AM.
//  Weak   — exam-wise / subject-wise accuracy down to sub-topic, with a
//            one-tap "strengthen" practice link. Chapters under 90% are weak.
import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";
import BiMessage from "@/components/BiMessage";

type Bi = { en: string; hi: string };
type Chapter = { id: string; name: string; nameHindi?: string | null; questionCount: number; testable: boolean; status: "PENDING" | "SELF_MARKED" | "COMPLETE" | "WEAK"; lastScorePct: number | null };
type Board = {
  exam: { id: string; name: string };
  summary: { total: number; complete: number; weak: number; selfMarked: number; pending: number };
  plan: { daysLeft: number } | null;
  subjects: { id: string; name: string; nameHindi?: string | null; chapters: Chapter[] }[];
};
type Today = {
  exam: { name: string };
  daysLeft: number;
  revisionReserveDays: number;
  progress: { total: number; complete: number; weak: number; pct: number };
  today: { chaptersToStudy: { id: string; name: string; subject: string; status: string }[]; chaptersPerDay: number; practiceQuestions: number; practiceSets: number; pyqTestsPerWeek: number };
  message: Bi;
};
type UpcomingTest = {
  id: string;
  status: string;
  examName: string;
  scheduledFor: string;
  msLeft: number;
  canStart: boolean;
  chapterCount: number;
  subjects: { subjectId: string; subject: string; chapters: { id: string; name: string }[] }[];
  message: Bi;
};
type Weak = {
  exams: { id: string; name: string; attempted: number; accuracyPct: number }[];
  targetPct: number;
  subjects: { id: string; name: string; accuracyPct: number; attempted: number; chapters: WeakChapter[] }[];
};
type WeakChapter = { id: string; name: string; accuracyPct: number; attempted: number; level: string; flaggedWeak: boolean; practice: Record<string, string>; topics: WeakTopic[] };
type WeakTopic = { id: string; name: string; accuracyPct: number; attempted: number; level: string; practice: Record<string, string>; subTopics: { id: string; name: string; accuracyPct: number; attempted: number; level: string; practice: Record<string, string> }[] };

const lvl = (l: string) => (l === "STRONG" ? "text-emerald-600" : l === "AVERAGE" ? "text-amber-600" : "text-red-600");
const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();
const cd = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function StudyPlanBoardPage() {
  const [tab, setTab] = React.useState<"today" | "chapters" | "test" | "weak">("today");
  const [noPlan, setNoPlan] = React.useState<Bi | null>(null);
  const [today, setToday] = React.useState<Today | null>(null);
  const [board, setBoard] = React.useState<Board | null>(null);
  const [upcoming, setUpcoming] = React.useState<UpcomingTest | null>(null);
  const [lastResult, setLastResult] = React.useState<{ id: string; scorePct: number | null } | null>(null);
  const [lastDetail, setLastDetail] = React.useState<{ scorePct: number | null; message: Bi; chapters: { chapterId: string; name: string; pct: number; correct: number; total: number; status: string }[] } | null>(null);
  const [weak, setWeak] = React.useState<Weak | null>(null);
  const [weakExam, setWeakExam] = React.useState("");
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [now, setNow] = React.useState(Date.now());
  const [loadedAt, setLoadedAt] = React.useState(Date.now());

  const get = async (path: string) => {
    const r = await fetchAuth(`${API_BASE}${path}`);
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, d };
  };

  const loadAll = React.useCallback(async () => {
    setError("");
    const t = await get("/study-plan/today");
    if (!t.ok) {
      if (t.d?.code === "NO_PLAN") setNoPlan(t.d.messages);
      else setError(t.d?.message || "Load nahi hua");
      return;
    }
    setNoPlan(null);
    setToday(t.d);
    const [b, u] = await Promise.all([get("/study-plan/chapters"), get("/study-plan/test/upcoming")]);
    if (b.ok) setBoard(b.d);
    if (u.ok) {
      setUpcoming(u.d.test);
      setLastResult(u.d.lastResult);
      setLoadedAt(Date.now());
    }
  }, []);
  React.useEffect(() => {
    loadAll();
  }, [loadAll]);

  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  React.useEffect(() => {
    if (upcoming || !lastResult) return;
    get(`/study-plan/test/${lastResult.id}/result`).then((r) => r.ok && setLastDetail(r.d));
  }, [upcoming, lastResult]);

  const loadWeak = React.useCallback(async (examId: string) => {
    const w = await get(`/study-plan/weak${examId ? `?examId=${examId}` : ""}`);
    if (w.ok) setWeak(w.d);
  }, []);
  React.useEffect(() => {
    if (tab === "weak") loadWeak(weakExam);
  }, [tab, weakExam, loadWeak]);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const mark = async (complete: boolean) => {
    if (!picked.size) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetchAuth(`${API_BASE}/study-plan/chapters/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterIds: [...picked], complete }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.messages?.en || d?.message || "Mark nahi hua");
      setPicked(new Set());
      await loadAll();
      if (complete) setTab("test");
    } catch (e: any) {
      setError(e.message || "Failed");
    } finally {
      setBusy(false);
    }
  };

  const msLeft = upcoming ? Math.max(0, upcoming.msLeft - (now - loadedAt)) : 0;
  const canStart = !!upcoming && msLeft === 0;

  const tabBtn = (id: typeof tab, label: string) => (
    <button key={id} onClick={() => setTab(id)} className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold ${tab === id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{label}</button>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <a href="/study-plan" className="text-sm font-semibold">← Study Plan</a>
          <span className="text-sm font-bold">🗓️ My Prep Board</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">
        {noPlan ? (
          <div className="text-center">
            <BiMessage msg={noPlan} tone="warn" />
            <a href="/study-plan" className="btn mt-4 inline-block bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">Set target exam & date →</a>
          </div>
        ) : (
          <>
            <div className="flex gap-2">{tabBtn("today", "Aaj")}{tabBtn("chapters", "Chapters")}{tabBtn("test", "9 AM Test")}{tabBtn("weak", "Weak")}</div>
            {error && <p className="mt-3 text-sm text-danger">{error}</p>}

            {/* ------------------------------------------------ Aaj / Today */}
            {tab === "today" && today && (
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">{today.exam.name}</p>
                      <p className="text-3xl font-bold">{today.daysLeft} <span className="text-base font-semibold">days left</span></p>
                    </div>
                    <p className="text-sm font-semibold">{today.progress.complete}/{today.progress.total} chapters ✅</p>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-emerald-500" style={{ width: `${today.progress.pct}%` }} /></div>
                  {today.revisionReserveDays > 0 && <p className="mt-2 text-xs text-muted-foreground">Last {today.revisionReserveDays} days = revision + full mocks.</p>}
                </div>
                <BiMessage msg={today.message} />
                <div className="rounded-xl border border-border bg-card p-4">
                  <h2 className="text-sm font-bold">📖 Aaj padhne wale chapters</h2>
                  {today.today.chaptersToStudy.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">Sab chapters complete! 🎉 Ab full mocks do.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {today.today.chaptersToStudy.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate">{c.status === "WEAK" && "⚠️ "}{c.name} <span className="text-xs text-muted-foreground">· {c.subject}</span></span>
                          <a href={`/question-bank-practice?${qs({ chapterId: c.id })}`} className="shrink-0 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">Practice</a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 text-center text-sm">
                  <a href="/question-bank-practice" className="rounded-xl border border-border bg-card p-4"><div className="text-2xl font-bold">{today.today.practiceQuestions}</div><div className="text-xs text-muted-foreground">practice questions / day ({today.today.practiceSets} sets)</div></a>
                  <a href="/year-wise" className="rounded-xl border border-border bg-card p-4"><div className="text-2xl font-bold">{today.today.pyqTestsPerWeek}</div><div className="text-xs text-muted-foreground">PYQ mocks / week</div></a>
                </div>
              </div>
            )}

            {/* ------------------------------------------------- Chapters */}
            {tab === "chapters" && board && (
              <div className="mt-4">
                <p className="text-xs text-muted-foreground">Jo chapters aapne complete kar liye unhe tick karein — unka test kal subah 9 AM ko aayega. / Tick the chapters you finished — their test comes tomorrow 9 AM.</p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
                  <span className="text-emerald-600">✅ {board.summary.complete} complete</span><span className="text-blue-600">🕘 {board.summary.selfMarked} awaiting test</span><span className="text-red-600">⚠️ {board.summary.weak} weak</span><span className="text-muted-foreground">⬜ {board.summary.pending} pending</span>
                </div>
                <div className="mt-4 space-y-4">
                  {board.subjects.map((s) => (
                    <div key={s.id} className="rounded-xl border border-border bg-card p-4">
                      <h2 className="text-sm font-bold">{s.name}</h2>
                      <div className="mt-2 space-y-1">
                        {s.chapters.map((c) => {
                          const locked = c.status === "COMPLETE" || c.status === "SELF_MARKED";
                          return (
                            <label key={c.id} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${!c.testable ? "opacity-40" : "hover:bg-muted/50"}`}>
                              <input type="checkbox" disabled={!c.testable || busy || c.status === "COMPLETE"} checked={picked.has(c.id) || locked} onChange={() => (c.status === "SELF_MARKED" ? (setPicked(new Set([c.id])), mark(false)) : toggle(c.id))} />
                              <span className="min-w-0 flex-1 truncate">{c.name}</span>
                              {c.status === "COMPLETE" && <span className="text-xs text-emerald-600">✅ {c.lastScorePct ?? ""}%</span>}
                              {c.status === "SELF_MARKED" && <span className="text-xs text-blue-600">🕘 test scheduled</span>}
                              {c.status === "WEAK" && <span className="text-xs text-red-600">⚠️ weak {c.lastScorePct ?? ""}%</span>}
                              {!c.testable && <span className="text-[10px] text-muted-foreground">no questions yet</span>}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                {picked.size > 0 && (
                  <div className="sticky bottom-3 mt-4 rounded-xl border border-primary/40 bg-background p-3 shadow-lg">
                    <button onClick={() => mark(true)} disabled={busy} className="btn w-full bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                      {busy ? "Saving…" : `Mark ${picked.size} chapter(s) complete & schedule tomorrow's 9 AM test`}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ---------------------------------------------------- Test */}
            {tab === "test" && (
              <div className="mt-4 space-y-4">
                {!upcoming ? (
                  <div className="rounded-xl border border-border bg-card p-5 text-center text-sm">
                    <p>Koi test scheduled nahi hai. Chapters tab me complete chapters mark karein.</p>
                    <p className="mt-1 text-muted-foreground">No test scheduled. Mark finished chapters in the Chapters tab.</p>
                  </div>
                )}
                {!upcoming && lastDetail && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-border bg-card p-4 text-center"><p className="text-xs text-muted-foreground">Last Study-Plan test</p><p className="text-3xl font-bold">{lastDetail.scorePct}%</p></div>
                    <BiMessage msg={lastDetail.message} tone={lastDetail.chapters.some((c) => c.status === "WEAK") ? "warn" : "success"} />
                    <div className="rounded-xl border border-border bg-card p-4 text-sm">
                      {lastDetail.chapters.map((c) => (
                        <div key={c.chapterId} className="flex items-center justify-between py-1">
                          <span className="min-w-0 truncate">{c.name}</span>
                          <span className={`shrink-0 font-bold ${c.status === "COMPLETE" ? "text-emerald-600" : c.status === "WEAK" ? "text-red-600" : "text-muted-foreground"}`}>{c.correct}/{c.total} · {c.pct}% {c.status === "COMPLETE" ? "✅" : c.status === "WEAK" ? "⚠️ weak" : ""}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {upcoming && (
                  <>
                    <div className="rounded-2xl border border-primary/40 bg-primary/5 p-6 text-center">
                      <p className="text-xs text-muted-foreground">{upcoming.examName} · {upcoming.chapterCount} chapters</p>
                      {canStart ? <p className="mt-1 text-2xl font-bold text-emerald-600">Test is open ✅</p> : <p className="mt-1 font-mono text-4xl font-bold">{cd(msLeft)}</p>}
                      <p className="mt-1 text-xs text-muted-foreground">{canStart ? "Full exam pattern · real timer" : "tak test khulega / until the test opens (9:00 AM)"}</p>
                      <a
                        href={canStart ? `/test?plantest=${upcoming.id}` : undefined}
                        aria-disabled={!canStart}
                        className={`btn mt-4 inline-block px-6 py-3 text-sm font-semibold ${canStart ? "bg-primary text-primary-foreground" : "pointer-events-none bg-muted text-muted-foreground"}`}
                      >
                        {upcoming.status === "IN_PROGRESS" ? "▶ Resume test" : "▶ Start test"}
                      </a>
                    </div>
                    <BiMessage msg={upcoming.message} />
                    <div className="rounded-xl border border-border bg-card p-4">
                      <h2 className="text-sm font-bold">📚 Ye padh lo (revise now)</h2>
                      <div className="mt-2 space-y-3">
                        {upcoming.subjects.map((s) => (
                          <div key={s.subjectId}>
                            <p className="text-xs font-bold text-primary">{s.subject}</p>
                            <ul className="mt-1 list-inside list-disc text-sm">
                              {s.chapters.map((c) => <li key={c.id}>{c.name}</li>)}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ----------------------------------------------------- Weak */}
            {tab === "weak" && (
              <div className="mt-4">
                {weak && weak.exams.length > 0 && (
                  <select value={weakExam} onChange={(e) => setWeakExam(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    <option value="">All exams</option>
                    {weak.exams.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.accuracyPct}% ({e.attempted} Qs)</option>)}
                  </select>
                )}
                {!weak || weak.subjects.length === 0 ? (
                  <p className="mt-6 text-center text-sm text-muted-foreground">Abhi koi test data nahi. Kuch tests do — phir yahan weak topics dikhenge. / Take a few tests to see weak topics here.</p>
                ) : (
                  <div className="mt-4 space-y-4">
                    {weak.subjects.map((s) => (
                      <div key={s.id} className="rounded-xl border border-border bg-card p-4">
                        <div className="flex items-center justify-between"><h2 className="text-sm font-bold">{s.name}</h2><span className="text-sm font-bold">{s.accuracyPct}%</span></div>
                        <div className="mt-2 space-y-2">
                          {s.chapters.map((c) => (
                            <details key={c.id} className="rounded-lg border border-border/60 px-3 py-2">
                              <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm">
                                <span className="min-w-0 truncate">{c.flaggedWeak && "⚠️ "}{c.name}</span>
                                <span className={`shrink-0 font-bold ${lvl(c.level)}`}>{c.accuracyPct}%</span>
                              </summary>
                              <a href={`/question-bank-practice?${qs(c.practice)}`} className="mt-2 inline-block rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">💪 Strengthen chapter (25 Qs)</a>
                              <div className="mt-2 space-y-1">
                                {c.topics.map((t) => (
                                  <div key={t.id} className="text-xs">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="min-w-0 truncate">{t.name}</span>
                                      <span className="flex shrink-0 items-center gap-2"><b className={lvl(t.level)}>{t.accuracyPct}%</b><a href={`/question-bank-practice?${qs(t.practice)}`} className="text-primary underline">practice</a></span>
                                    </div>
                                    {t.subTopics.map((st) => (
                                      <div key={st.id} className="ml-4 flex items-center justify-between gap-2 text-muted-foreground">
                                        <span className="min-w-0 truncate">↳ {st.name}</span>
                                        <span className="flex shrink-0 items-center gap-2"><b className={lvl(st.level)}>{st.accuracyPct}%</b><a href={`/question-bank-practice?${qs(st.practice)}`} className="text-primary underline">practice</a></span>
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            </details>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
