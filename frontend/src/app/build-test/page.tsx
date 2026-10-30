"use client";

import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { loadTargetExamId, saveTargetExamId } from "@/lib/target-exam";
import { AppShell, PageHeading, EmptyState, ErrorNote, ChoiceChip } from "@/components/AppShell";

type Exam = { id: string; name: string; count: number };
type TopicNode = { id: string; name: string; nameHindi?: string | null; available: number; pyq: number };
type ChapterNode = { id: string; name: string; nameHindi?: string | null; available: number; pyq: number; topics: TopicNode[] };
type SubjectNode = { id: string; name: string; nameHindi?: string | null; available: number; chapters: ChapterNode[] };
type Catalog = { examId: string | null; pyqBased: boolean; subjects: SubjectNode[] };

const MAX_Q = 100;
const bi = (n: { name: string; nameHindi?: string | null }) => (n.nameHindi && n.nameHindi.trim() && n.nameHindi.trim() !== n.name.trim() ? `${n.name} · ${n.nameHindi.trim()}` : n.name);

/** + / - counter for one chapter or topic. */
function Stepper({ value, max, onChange, label }: { value: number; max: number; onChange: (v: number) => void; label: string }) {
  const cap = Math.min(max, MAX_Q);
  return (
    <div className="flex shrink-0 items-center gap-1" role="group" aria-label={label}>
      <button type="button" className="btn btn-outline btn-sm h-8 w-8 px-0" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0} aria-label="-1">−</button>
      <input
        inputMode="numeric"
        aria-label={label}
        className="h-8 w-12 rounded-md border border-border bg-background text-center text-sm"
        value={value}
        onChange={(e) => {
          const n = Math.floor(Number(e.target.value.replace(/\D/g, "")));
          onChange(Number.isFinite(n) ? Math.min(cap, Math.max(0, n)) : 0);
        }}
      />
      <button type="button" className="btn btn-outline btn-sm h-8 w-8 px-0" onClick={() => onChange(Math.min(cap, value + 1))} disabled={value >= cap} aria-label="+1">+</button>
    </div>
  );
}

export default function BuildTestPage() {
  const t = useT();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [needsLogin, setNeedsLogin] = React.useState(false);
  const [exams, setExams] = React.useState<Exam[]>([]);
  const [examId, setExamId] = React.useState("");
  const [targetId, setTargetId] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"smart" | "custom">("smart");
  const [catalog, setCatalog] = React.useState<Catalog | null>(null);
  const [catLoading, setCatLoading] = React.useState(false);
  // picks: key "t:<topicId>" or "c:<chapterId>" -> count
  const [picks, setPicks] = React.useState<Record<string, number>>({});
  const [openSubject, setOpenSubject] = React.useState("");
  const [openChapter, setOpenChapter] = React.useState("");
  const [minutes, setMinutes] = React.useState("");
  const [starting, setStarting] = React.useState(false);
  const [savedTarget, setSavedTarget] = React.useState(false);
  type Quota = { premium: boolean; smart: { limit: number | null; left: number | null }; custom: { limit: number | null; leftToday: number | null }; priceInr: number };
  const [quota, setQuota] = React.useState<Quota | null>(null);
  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/tests/builder/quota`);
        if (r.ok) setQuota(await r.json());
      } catch { /* the page works without the counter; the server still enforces the limit */ }
    })();
  }, []);
  const outOfFree = !!quota && !quota.premium && (mode === "smart" ? (quota.smart.left ?? 1) <= 0 : (quota.custom.leftToday ?? 1) <= 0);

  React.useEffect(() => {
    (async () => {
      try {
        const [r, target] = await Promise.all([fetchAuth(`${API_BASE}/bank/meta`), loadTargetExamId()]);
        if (!r.ok) {
          if (r.status === 401) setNeedsLogin(true);
          else setError("LOAD");
          return;
        }
        const d = await r.json();
        const list: Exam[] = Array.isArray(d?.exams) ? d.exams : [];
        setExams(list);
        setTargetId(target);
        const urlExam = new URLSearchParams(window.location.search).get("exam");
        if (urlExam && list.some((e) => e.id === urlExam)) setExamId(urlExam);
        else if (target && list.some((e) => e.id === target)) setExamId(target);
        else if (list.length === 1) setExamId(list[0].id);
      } catch {
        setError("NETWORK");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // the topic list depends on the exam: only topics its previous-year papers asked are offered
  React.useEffect(() => {
    setPicks({});
    setCatalog(null);
    setOpenSubject("");
    setOpenChapter("");
    if (!examId) return;
    let cancelled = false;
    setCatLoading(true);
    (async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/tests/builder/catalog?examId=${encodeURIComponent(examId)}`);
        if (!r.ok || cancelled) return;
        setCatalog(await r.json());
      } catch {
        /* the custom tab shows an empty state */
      } finally {
        if (!cancelled) setCatLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId]);

  const total = Object.values(picks).reduce((a, b) => a + b, 0);
  const defaultMin = Math.min(180, Math.max(10, Math.round(total * 0.6)));
  const setPick = (key: string, v: number) => setPicks((p) => { const n = { ...p }; if (v <= 0) delete n[key]; else n[key] = v; return n; });

  const start = async () => {
    if (!examId || starting || outOfFree) return;
    if (mode === "custom" && (total <= 0 || total > MAX_Q)) return;
    setStarting(true);
    setError("");
    try {
      const items = Object.entries(picks).map(([k, count]) => (k.startsWith("t:") ? { topicId: k.slice(2), count } : { chapterId: k.slice(2), count }));
      const cfg = { mode, examId, ...(mode === "custom" ? { items } : {}), ...(minutes.trim() ? { durationMinutes: Number(minutes) } : {}) };
      sessionStorage.setItem("ssc_built_config", JSON.stringify(cfg));
      window.location.href = "/test?built=1";
    } catch {
      setError("START");
      setStarting(false);
    }
  };

  const makeTarget = async () => {
    if (!examId) return;
    const ok = await saveTargetExamId(examId);
    if (ok) { setTargetId(examId); setSavedTarget(true); }
  };

  const errorText = error === "NETWORK" ? t("Could not reach the server. Check your internet.", "Server tak nahi pahunch paye. Internet check karein.") : error === "START" ? t("Could not start the test. Please try again.", "Test shuru nahi ho paya. Dobara try karein.") : t("Could not load. Please try again.", "Load nahi ho paya. Dobara try karein.");

  return (
    <AppShell width="lg">
      <PageHeading
        title={t("Build a test", "Apna test banao")}
        subtitle={t("A smart mock for your exam, or your own test from the topics you choose.", "Apne exam ka smart mock, ya apne chune hue topics se apna test.")}
      />

      {quota && (
        <div className={`card mb-4 flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm ${outOfFree ? "border-warning/40 bg-warning/5" : ""}`} role="status">
          {quota.premium ? (
            <span className="font-semibold text-success">{t("Your plan: unlimited smart mocks and custom tests", "Aapka plan: unlimited smart mock aur custom test")}</span>
          ) : (
            <>
              <span>
                {t("Free: ", "Free: ")}
                <b>{quota.smart.left}</b> {t("of", "me se")} {quota.smart.limit} {t("smart mocks left", "smart mock bache")} · <b>{quota.custom.leftToday}</b> {t("of", "me se")} {quota.custom.limit} {t("custom tests left today", "custom test aaj bache")}
              </span>
              <a className="btn btn-outline btn-sm" href="/premium">{t(`Unlimited from ₹${quota.priceInr}`, `Unlimited ₹${quota.priceInr} se`)}</a>
            </>
          )}
        </div>
      )}

      {needsLogin ? (
        <EmptyState title={t("Please log in", "Pehle login karein")} action={<a className="btn btn-primary" href="/login">{t("Log in", "Login")}</a>} />
      ) : loading ? (
        <div className="card p-6 text-sm text-muted-foreground">{t("Loading…", "Load ho raha hai…")}</div>
      ) : error && exams.length === 0 ? (
        <ErrorNote onRetry={() => window.location.reload()}>{errorText}</ErrorNote>
      ) : exams.length === 0 ? (
        <EmptyState title={t("No exam has questions yet", "Abhi kisi exam me sawal nahi hain")} />
      ) : (
        <div className="space-y-4">
          <section className="card p-4 sm:p-5" aria-label={t("Exam", "Exam")}>
            <h2 className="mb-2 text-base font-semibold">{t("1. Your exam", "1. Aapka exam")}</h2>
            <div className="flex flex-wrap gap-2">
              {exams.map((e) => (
                <ChoiceChip key={e.id} selected={examId === e.id} onClick={() => { setExamId(e.id); setSavedTarget(false); }}>
                  {e.name}{targetId === e.id ? " ★" : ""}
                </ChoiceChip>
              ))}
            </div>
            {examId && targetId !== examId ? (
              <button type="button" onClick={makeTarget} className="mt-3 text-xs text-primary underline">
                {savedTarget ? t("Saved as your target exam ✓", "Target exam save ho gaya ✓") : t("Make this my target exam (★)", "Ise mera target exam banao (★)")}
              </button>
            ) : null}
          </section>

          {examId ? (
            <section className="card p-4 sm:p-5" aria-label={t("Type of test", "Test ka type")}>
              <h2 className="mb-2 text-base font-semibold">{t("2. Type of test", "2. Test ka type")}</h2>
              <div className="flex flex-wrap gap-2">
                <ChoiceChip selected={mode === "smart"} onClick={() => setMode("smart")}>{t("Smart mock (exam-wise)", "Smart mock (exam ke hisaab se)")}</ChoiceChip>
                <ChoiceChip selected={mode === "custom"} onClick={() => setMode("custom")}>{t("Custom test (my topics)", "Custom test (mere topics)")}</ChoiceChip>
              </div>

              {mode === "smart" ? (
                <div className="mt-4 space-y-3 text-sm">
                  <p className="text-muted-foreground">
                    {t(
                      "Sections, marks and negative marking follow this exam. Questions come only from topics this exam really asked in previous years, in the same proportion — a topic it never asked is never included.",
                      "Sections, marks aur negative marking is exam ke hisaab se. Sawal sirf un topics se jo is exam me pichhle saalon me aaye, usi anupaat me — jo topic kabhi nahi aaya wo nahi aata.",
                    )}
                  </p>
                  <label className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t("Minutes (optional)", "Minutes (optional)")}</span>
                    <input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder={t("exam's own time", "exam ka apna time")} className="h-9 w-32 rounded-md border border-border bg-background px-2" />
                  </label>
                  <button type="button" className="btn btn-primary" onClick={start} disabled={starting || outOfFree}>{starting ? t("Starting…", "Shuru ho raha hai…") : t("Start smart mock", "Smart mock shuru karein")}</button>
                </div>
              ) : (
                <div className="mt-4">
                  {catLoading ? (
                    <p className="text-sm text-muted-foreground">{t("Loading topics…", "Topics load ho rahe hain…")}</p>
                  ) : !catalog || catalog.subjects.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("No topic has questions for this exam yet.", "Is exam ke liye abhi kisi topic me sawal nahi hain.")}</p>
                  ) : (
                    <>
                      <p className="mb-3 text-xs text-muted-foreground">
                        {catalog.pyqBased
                          ? t("Only topics this exam asked in previous years are listed. Numbers = questions available.", "Sirf wahi topics jo is exam me pichhle saalon me aaye. Number = available sawal.")
                          : t("Topics that have questions are listed. Numbers = questions available.", "Jin topics me sawal hain wahi dikhte hain. Number = available sawal.")}
                      </p>
                      <div className="space-y-2">
                        {catalog.subjects.map((s) => (
                          <div key={s.id} className="rounded-lg border border-border">
                            <button type="button" className="flex w-full items-center justify-between px-3 py-2.5 text-left" onClick={() => { setOpenSubject(openSubject === s.id ? "" : s.id); setOpenChapter(""); }}>
                              <span className="font-semibold">{bi(s)}</span>
                              <span className="text-xs text-muted-foreground">{s.available} {openSubject === s.id ? "▾" : "▸"}</span>
                            </button>
                            {openSubject === s.id ? (
                              <div className="space-y-1.5 border-t border-border px-3 py-2">
                                {s.chapters.map((c) => (
                                  <div key={c.id} className="rounded-md border border-border/60">
                                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                                      <button type="button" className="min-w-0 flex-1 text-left text-sm font-medium" onClick={() => setOpenChapter(openChapter === c.id ? "" : c.id)}>
                                        {bi(c)} <span className="text-xs text-muted-foreground">({c.available})</span> {c.topics.length ? (openChapter === c.id ? "▾" : "▸") : ""}
                                      </button>
                                      <Stepper value={picks[`c:${c.id}`] ?? 0} max={c.available} onChange={(v) => setPick(`c:${c.id}`, v)} label={`${c.name}`} />
                                    </div>
                                    {openChapter === c.id && c.topics.length ? (
                                      <div className="space-y-1 border-t border-border/60 px-3 py-2">
                                        {c.topics.map((tp) => (
                                          <div key={tp.id} className="flex items-center justify-between gap-2">
                                            <span className="min-w-0 flex-1 text-sm">{bi(tp)} <span className="text-xs text-muted-foreground">({tp.available})</span></span>
                                            <Stepper value={picks[`t:${tp.id}`] ?? 0} max={tp.available} onChange={(v) => setPick(`t:${tp.id}`, v)} label={tp.name} />
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>

                      <div className="sticky bottom-2 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-sm">
                        <div className="text-sm">
                          <span className="font-semibold">{total}</span> {t("questions", "sawal")}
                          {total > MAX_Q ? <span className="ml-2 text-danger">{t(`max ${MAX_Q}`, `max ${MAX_Q}`)}</span> : null}
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                          <span>{t("Minutes", "Minutes")}</span>
                          <input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder={String(total ? defaultMin : 0)} className="h-9 w-20 rounded-md border border-border bg-background px-2" />
                        </label>
                        <button type="button" className="btn btn-primary" onClick={start} disabled={starting || outOfFree || total <= 0 || total > MAX_Q}>
                          {starting ? t("Starting…", "Shuru ho raha hai…") : t("Start test", "Test shuru karein")}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {error && exams.length > 0 ? <div className="mt-3"><ErrorNote>{errorText}</ErrorNote></div> : null}
            </section>
          ) : null}
        </div>
      )}
    </AppShell>
  );
}
