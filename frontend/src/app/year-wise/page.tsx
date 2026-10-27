"use client";

import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { AppShell, PageHeading, EmptyState, ErrorNote, ChoiceChip } from "@/components/AppShell";

type Exam = { id: string; name: string; slug: string; count: number };
type YearRow = { year: number; questionCount: number };
type ShiftRow = { shift: string; questionCount: number };
type TierRow = { tier: string; questionCount: number };
type Subject = { id: string; name: string; slug: string; questionCount: number };
type Chapter = { id: string; name: string; slug: string; count: number };
type TopicRow = { id: string; name: string; slug: string; count: number };

/** Numbered step heading. The flow really is a sequence (exam → year → shift → scope), so numbers carry meaning. */
function Step({ n, title, hint, done, children }: { n: number; title: string; hint?: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="card p-4 sm:p-5" aria-label={title}>
      <div className="mb-3 flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            done ? "bg-success text-success-foreground" : "bg-primary/10 text-primary"
          }`}
          aria-hidden
        >
          {done ? "✓" : n}
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-6">{title}</h2>
          {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function YearWisePage() {
  const t = useT();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [needsLogin, setNeedsLogin] = React.useState(false);
  const [starting, setStarting] = React.useState(false);

  const [exams, setExams] = React.useState<Exam[]>([]);
  const [examId, setExamId] = React.useState("");

  const [years, setYears] = React.useState<YearRow[]>([]);
  const [yearsLoading, setYearsLoading] = React.useState(false);
  const [year, setYear] = React.useState<number | null>(null);

  // Shift picker (tests.service.ts yearWiseStart()): `null` = not chosen yet, `""` = student explicitly chose
  // "all shifts combined", otherwise the exact shift string.
  // Tier step (26 Oct 2026): shown only when the year has questions of more than one tier. null = not chosen, "" = all tiers.
  const [tiers, setTiers] = React.useState<TierRow[]>([]);
  const [tier, setTier] = React.useState<string | null>(null);
  const [shifts, setShifts] = React.useState<ShiftRow[]>([]);
  const [shift, setShift] = React.useState<string | null>(null);

  const [subjects, setSubjects] = React.useState<Subject[]>([]);
  const [selectedSubjects, setSelectedSubjects] = React.useState<Set<string>>(new Set());
  const [chapters, setChapters] = React.useState<Chapter[]>([]);
  const [selectedChapters, setSelectedChapters] = React.useState<Set<string>>(new Set());
  const [topics, setTopics] = React.useState<TopicRow[]>([]);
  const [selectedTopics, setSelectedTopics] = React.useState<Set<string>>(new Set());
  const [customOpen, setCustomOpen] = React.useState(false);

  // Narrows subject / chapter / topic counts (and hides empty ones) to the exact paper chosen. `shift` is
  // null while undecided and "" for "all shifts combined"; both mean "no shift narrowing".
  // `tier` ("" = both tiers combined, null = not chosen yet) narrows the counts to that tier's papers too.
  const paperQuery = year ? `&year=${year}${tier ? `&tier=${encodeURIComponent(tier)}` : ""}${shift ? `&shift=${encodeURIComponent(shift)}` : ""}` : "";

  // A different paper (year / shift) has different subjects and chapters: drop picks that may no longer exist.
  React.useEffect(() => {
    setSelectedSubjects(new Set());
    setSelectedChapters(new Set());
    setSelectedTopics(new Set());
  }, [paperQuery]);

  // Step 1: exams
  const loadExams = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetchAuth(`${API_BASE}/bank/meta`);
      if (!r.ok) {
        if (r.status === 401) setNeedsLogin(true);
        else setError("LOAD");
        return;
      }
      const d = await r.json();
      const list: Exam[] = (Array.isArray(d?.exams) ? d.exams : []).filter((e: Exam) => e.count > 0);
      setExams(list);
      // Honour ?exam=<id> (deep links from the dashboard), otherwise leave the choice to the student.
      const urlExam = new URLSearchParams(window.location.search).get("exam");
      if (urlExam && list.some((e) => e.id === urlExam)) setExamId(urlExam);
      else if (list.length === 1) setExamId(list[0].id);
    } catch {
      setError("NETWORK");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadExams();
  }, [loadExams]);

  // Step 2: years for the chosen exam. Changing the exam clears everything below it.
  React.useEffect(() => {
    setYear(null);
    setYears([]);
    setShift(null);
    setShifts([]);
    setSubjects([]);
    setSelectedSubjects(new Set());
    setChapters([]);
    setSelectedChapters(new Set());
    setTopics([]);
    setSelectedTopics(new Set());
    setCustomOpen(false);
    if (!examId) return;
    let cancelled = false;
    setYearsLoading(true);
    (async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/bank/years?examId=${examId}`);
        if (!r.ok || cancelled) return;
        const d = await r.json();
        if (!cancelled) setYears(Array.isArray(d) ? d : []);
      } catch {
        /* keep list empty: UI shows "no years yet" */
      } finally {
        if (!cancelled) setYearsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId]);

  // Tier step: tiers that exist for exam + year. One tier (or none tagged) skips the step automatically.
  React.useEffect(() => {
    setTier(null);
    setTiers([]);
    if (!examId || !year) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/bank/tiers?examId=${examId}&year=${year}`);
        if (!r.ok || cancelled) return;
        const d = await r.json();
        const list: TierRow[] = Array.isArray(d) ? d : [];
        if (cancelled) return;
        setTiers(list);
        if (list.length <= 1) setTier(list[0]?.tier ?? "");
      } catch {
        setTier("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId, year]);

  // Step 3/4: shifts for exam + year (+ tier). A year with one shift (or none tagged) skips this step automatically.
  React.useEffect(() => {
    setShift(null);
    setShifts([]);
    if (!examId || !year || tier === null) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/bank/shifts?examId=${examId}&year=${year}${tier ? `&tier=${tier}` : ""}`);
        if (!r.ok || cancelled) return;
        const d = await r.json();
        const list: ShiftRow[] = Array.isArray(d) ? d : [];
        if (cancelled) return;
        setShifts(list);
        if (list.length === 1) setShift(list[0].shift);
      } catch {
        /* start() still works without shift narrowing */
      }
    })();
    return () => {
      cancelled = true;
    };
    // `tier` MUST be a dependency: picking a tier chip has to (re)load that tier's shifts (27 Oct 2026 fix —
    // before this the shift step never appeared after choosing a tier).
  }, [examId, year, tier]);

  // Subjects for the optional customise step (loaded only once a year is chosen).
  React.useEffect(() => {
    if (!examId || !year) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/bank/subjects?examId=${examId}${paperQuery}`);
        if (!r.ok || cancelled) return;
        const d = await r.json();
        const list: Subject[] = Array.isArray(d) ? d : [];
        if (!cancelled) setSubjects(list.filter((s) => s.questionCount > 0));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId, year, paperQuery]);

  // Chapters when subjects are (de)selected (one fetch per subject, merged).
  React.useEffect(() => {
    if (selectedSubjects.size === 0) {
      setChapters([]);
      setSelectedChapters(new Set());
      setTopics([]);
      setSelectedTopics(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(
          Array.from(selectedSubjects).map((sid) =>
            fetchAuth(`${API_BASE}/bank/chapters?subjectId=${sid}&examId=${examId}${paperQuery}`).then((r) => (r.ok ? r.json() : [])),
          ),
        );
        if (!cancelled) setChapters(([] as Chapter[]).concat(...results.filter(Array.isArray)));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSubjects, examId, paperQuery]);

  // Topics when chapters are (de)selected. examId is sent so counts match what yearWiseStart() will actually compose.
  React.useEffect(() => {
    if (selectedChapters.size === 0) {
      setTopics([]);
      setSelectedTopics(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(
          Array.from(selectedChapters).map((cid) =>
            fetchAuth(`${API_BASE}/bank/topics?chapterId=${cid}&examId=${examId}${paperQuery}`).then((r) => (r.ok ? r.json() : [])),
          ),
        );
        if (!cancelled) setTopics(([] as TopicRow[]).concat(...results.filter(Array.isArray)));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedChapters, examId, paperQuery]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const exam = exams.find((e) => e.id === examId);
  const yearRow = years.find((y) => y.year === year);
  const multiTier = tiers.length > 1;
  const tierReady = !!year && tier !== null;
  const multiShift = shifts.length > 1;
  const shiftReady = tierReady && (!multiShift || shift !== null);
  const stepOffset = multiTier ? 1 : 0;
  // Exact question pool of the chosen paper (before any subject/chapter/topic narrowing).
  const shiftRow = shift ? shifts.find((s) => s.shift === shift) : undefined;
  // No shift picked: the year's total, or the chosen tier's total when a tier was picked.
  const tierRow = tier ? tiers.find((x) => x.tier === tier) : undefined;
  const paperCount = shiftRow ? shiftRow.questionCount : tierRow ? tierRow.questionCount : yearRow?.questionCount;

  const start = async (full: boolean) => {
    if (!examId || !year) return;
    setStarting(true);
    setError("");
    try {
      // Same shape /test?yearwise=1 reads from sessionStorage. "" (all shifts) is sent as undefined so the
      // backend's opts.shift stays falsy, exactly as before.
      const cfg = {
        examId,
        year,
        shift: shift || undefined,
        tier: tier || undefined,
        full,
        subjectIds: full ? [] : Array.from(selectedSubjects),
        chapterIds: full ? [] : Array.from(selectedChapters),
        topicIds: full ? [] : Array.from(selectedTopics),
      };
      sessionStorage.setItem("ssc_yearwise_config", JSON.stringify(cfg));
      window.location.href = "/test?yearwise=1";
    } catch {
      setError("START");
      setStarting(false);
    }
  };

  const errorText =
    error === "NETWORK"
      ? t("Could not reach the server. Check your internet.", "Server tak nahi pahunch paye. Internet check karein.")
      : error === "START"
        ? t("Could not start the test. Please try again.", "Test shuru nahi ho paya. Dobara try karein.")
        : t("Exams could not be loaded.", "Exams load nahi ho paye.");

  const scopeSummary =
    selectedTopics.size > 0
      ? t(`${selectedTopics.size} topic(s)`, `${selectedTopics.size} topic`)
      : selectedChapters.size > 0
        ? t(`${selectedChapters.size} chapter(s)`, `${selectedChapters.size} chapter`)
        : selectedSubjects.size > 0
          ? t(`${selectedSubjects.size} subject(s)`, `${selectedSubjects.size} subject`)
          : t("All subjects", "Sab subjects");

  const paperLabel = [exam?.name, year, tier ? (tier === "TIER_2" ? "Tier 2" : "Tier 1") : "", shift ? shift : shifts.length > 1 && shift === "" ? t("all shifts", "sab shifts") : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <AppShell>
      <PageHeading
        title={t("Year-wise PYQ test", "Year-wise PYQ test")}
        subtitle={t(
          "Pick one exam, one year and one shift to attempt that exact paper. Or narrow it down to the subjects, chapters and topics you want.",
          "Ek exam, ek saal aur ek shift chun kar wahi exact paper dein. Ya apne pasand ke subject, chapter aur topic tak seemit karein.",
        )}
        actions={<a href="/mocks" className="btn btn-outline btn-sm">{t("Mock tests", "Mock tests")}</a>}
      />

      {loading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading">
          <div className="card space-y-3 p-5">
            <div className="skeleton h-4 w-32" />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="skeleton h-16" />
              <div className="skeleton h-16" />
            </div>
          </div>
        </div>
      ) : null}

      {!loading && needsLogin ? (
        <EmptyState
          title={t("Log in to start a year-wise test", "Year-wise test ke liye login karein")}
          action={<a href="/login" className="btn btn-primary">{t("Log in", "Login")}</a>}
        />
      ) : null}

      {!loading && !needsLogin && error && exams.length === 0 ? (
        <ErrorNote onRetry={loadExams} retryLabel={t("Try again", "Dobara try karein")}>{errorText}</ErrorNote>
      ) : null}

      {!loading && !needsLogin && !error && exams.length === 0 ? (
        <EmptyState
          icon="📅"
          title={t("No previous-year papers yet", "Abhi koi pichle saal ka paper nahi hai")}
          body={t("Exams show up here once their PYQs are published.", "PYQ publish hote hi exams yahan dikhenge.")}
          action={<a href="/mocks" className="btn btn-outline">{t("Browse mock tests", "Mock tests dekhein")}</a>}
        />
      ) : null}

      {!loading && !needsLogin && exams.length > 0 ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_20rem] lg:items-start">
          <div className="space-y-4">
            <Step n={1} title={t("Exam", "Exam")} done={!!examId}>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {exams.map((e) => (
                  <ChoiceChip key={e.id} tile selected={examId === e.id} onClick={() => setExamId(e.id)}>
                    <p className="font-semibold">{e.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{e.count.toLocaleString()} {t("questions", "sawal")}</p>
                  </ChoiceChip>
                ))}
              </div>
            </Step>

            {examId ? (
              <Step n={2} title={t("Year", "Saal")} done={!!year}>
                {yearsLoading ? (
                  <div className="flex gap-2" aria-busy="true">
                    {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-10 w-20" />)}
                  </div>
                ) : years.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("No years are tagged for this exam yet.", "Is exam ke liye abhi koi saal tag nahi hai.")}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {years.map((y) => (
                      <ChoiceChip key={y.year} selected={year === y.year} onClick={() => setYear(y.year)}>
                        {y.year} <span className="text-xs text-muted-foreground">({y.questionCount})</span>
                      </ChoiceChip>
                    ))}
                  </div>
                )}
              </Step>
            ) : null}

            {year && multiTier ? (
              <Step
                n={3}
                title={t("Tier", "Tier")}
                hint={t(
                  "Tier 1 and Tier 2 are different papers. Pick one, or combine both.",
                  "Tier 1 aur Tier 2 alag paper hote hain. Ek chunein, ya dono milakar practice karein.",
                )}
                done={tier !== null}
              >
                <div className="flex flex-wrap gap-2">
                  {tiers.map((x) => (
                    <ChoiceChip key={x.tier} selected={tier === x.tier} onClick={() => setTier(x.tier)}>
                      {x.tier === "TIER_2" ? "Tier 2" : "Tier 1"} <span className="text-xs text-muted-foreground">({x.questionCount})</span>
                    </ChoiceChip>
                  ))}
                  <ChoiceChip selected={tier === ""} onClick={() => setTier("")}>
                    {t("Both tiers combined", "Dono tier milakar")}
                  </ChoiceChip>
                </div>
              </Step>
            ) : null}

            {year && tierReady && multiShift ? (
              <Step
                n={3 + stepOffset}
                title={t("Shift", "Shift")}
                hint={t(
                  "A real SSC paper is one shift (up to 100 questions). Pick one, or combine every shift into a longer practice set.",
                  "Asli SSC paper ek shift ka hota hai (100 sawal tak). Ek chunein, ya sab shifts ko milakar lamba practice set banayein.",
                )}
                done={shift !== null}
              >
                <div className="flex flex-wrap gap-2">
                  {shifts.map((s) => (
                    <ChoiceChip key={s.shift} selected={shift === s.shift} onClick={() => setShift(s.shift)}>
                      {s.shift} <span className="text-xs text-muted-foreground">({s.questionCount})</span>
                    </ChoiceChip>
                  ))}
                  <ChoiceChip selected={shift === ""} onClick={() => setShift("")}>
                    {t("All shifts combined", "Sab shifts milakar")}
                  </ChoiceChip>
                </div>
              </Step>
            ) : null}

            {shiftReady && subjects.length > 0 ? (
              <Step
                n={(multiShift ? 4 : 3) + stepOffset}
                title={t("Narrow it down (optional)", "Seemit karein (optional)")}
                hint={t("Leave this closed to attempt the whole paper.", "Poora paper dene ke liye ise band rehne dein.")}
              >
                <button
                  type="button"
                  onClick={() => setCustomOpen((v) => !v)}
                  aria-expanded={customOpen}
                  className="btn btn-outline btn-sm"
                >
                  {customOpen ? t("Hide subject, chapter and topic", "Subject, chapter, topic chhupayein") : t("Choose subject, chapter and topic", "Subject, chapter, topic chunein")}
                </button>

                {customOpen ? (
                  <div className="mt-4 space-y-5">
                    <div>
                      <p className="mb-2 text-xs font-semibold text-muted-foreground">{t("Subjects", "Subjects")}</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {subjects.map((s) => (
                          <ChoiceChip key={s.id} selected={selectedSubjects.has(s.id)} onClick={() => toggle(selectedSubjects, setSelectedSubjects, s.id)}>
                            {s.name} <span className="text-xs text-muted-foreground">({s.questionCount})</span>
                          </ChoiceChip>
                        ))}
                      </div>
                    </div>
                    {chapters.length > 0 ? (
                      <div>
                        <p className="mb-2 text-xs font-semibold text-muted-foreground">{t("Chapters", "Chapters")}</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {chapters.map((c) => (
                            <ChoiceChip key={c.id} selected={selectedChapters.has(c.id)} onClick={() => toggle(selectedChapters, setSelectedChapters, c.id)}>
                              {c.name} <span className="text-xs text-muted-foreground">({c.count})</span>
                            </ChoiceChip>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {topics.length > 0 ? (
                      <div>
                        <p className="mb-2 text-xs font-semibold text-muted-foreground">{t("Topics", "Topics")}</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {topics.map((tp) => (
                            <ChoiceChip key={tp.id} selected={selectedTopics.has(tp.id)} onClick={() => toggle(selectedTopics, setSelectedTopics, tp.id)}>
                              {tp.name} <span className="text-xs text-muted-foreground">({tp.count})</span>
                            </ChoiceChip>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => start(false)}
                      disabled={starting || selectedSubjects.size === 0}
                      className="btn btn-outline w-full"
                    >
                      {starting ? t("Preparing…", "Taiyaar ho raha hai…") : t("Start customised test", "Customised test shuru karein")}
                    </button>
                    {selectedSubjects.size === 0 ? (
                      <p className="text-center text-xs text-muted-foreground">
                        {t("Pick at least one subject, or attempt the full paper from the summary.", "Kam se kam ek subject chunein, ya summary se poora paper dein.")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </Step>
            ) : null}
          </div>

          {/* Summary + primary action: always visible on desktop, below the steps on phones. */}
          <aside className="card space-y-4 p-5 lg:sticky lg:top-24" aria-label={t("Your paper", "Aapka paper")}>
            <p className="text-xs font-semibold text-muted-foreground">{t("Your paper", "Aapka paper")}</p>
            {!year ? (
              <p className="text-sm text-muted-foreground">{t("Choose an exam and a year to see the paper here.", "Yahan paper dekhne ke liye exam aur saal chunein.")}</p>
            ) : (
              <>
                <div className="rounded-lg bg-muted/60 px-3.5 py-3 text-sm">
                  <p className="font-semibold">{paperLabel}</p>
                  <p className="mt-0.5 text-muted-foreground">
                    {!tierReady
                      ? t("Choose a tier to continue", "Aage badhne ke liye tier chunein")
                      : !shiftReady
                      ? t("Choose a shift to continue", "Aage badhne ke liye shift chunein")
                      : `${paperCount != null ? `${paperCount} ${t("questions", "sawal")} · ` : ""}${scopeSummary}`}
                  </p>
                </div>
                {error ? <ErrorNote>{errorText}</ErrorNote> : null}
                <button
                  type="button"
                  onClick={() => start(true)}
                  disabled={starting || !shiftReady}
                  className="btn btn-primary btn-lg w-full"
                >
                  {starting
                    ? t("Preparing your test…", "Test taiyaar ho raha hai…")
                    : shift
                      ? t(`Attempt ${year} ${shift} paper`, `${year} ${shift} paper dein`)
                      : t(`Attempt full ${year} paper`, `Poora ${year} paper dein`)}
                </button>
                <p className="text-xs text-muted-foreground">
                  {t("Timed like the real exam. Your answers autosave and the result opens right after you submit.", "Asli exam jaisa timer. Jawab autosave hote hain aur submit ke turant baad result khulta hai.")}
                </p>
              </>
            )}
          </aside>
        </div>
      ) : null}
    </AppShell>
  );
}
