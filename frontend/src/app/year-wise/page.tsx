"use client";

import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";

type Exam = { id: string; name: string; slug: string; count: number };
type YearRow = { year: number; questionCount: number };
type Subject = { id: string; name: string; slug: string; questionCount: number };
type Chapter = { id: string; name: string; slug: string; count: number };
type TopicRow = { id: string; name: string; slug: string; count: number };

export default function YearWisePage() {
  const apiBase = () => API_BASE;
  const authHeaders = (): Record<string, string> => {
    const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [starting, setStarting] = React.useState(false);

  const [exams, setExams] = React.useState<Exam[]>([]);
  const [examId, setExamId] = React.useState("");

  const [years, setYears] = React.useState<YearRow[]>([]);
  const [year, setYear] = React.useState<number | null>(null);

  const [subjects, setSubjects] = React.useState<Subject[]>([]);
  const [selectedSubjects, setSelectedSubjects] = React.useState<Set<string>>(new Set());

  const [chapters, setChapters] = React.useState<Chapter[]>([]);
  const [selectedChapters, setSelectedChapters] = React.useState<Set<string>>(new Set());

  const [topics, setTopics] = React.useState<TopicRow[]>([]);
  const [selectedTopics, setSelectedTopics] = React.useState<Set<string>>(new Set());

  // Step 1 — load exams
  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetchAuth(`${apiBase()}/bank/meta`, { headers: authHeaders() });
        if (!r.ok) {
          setError(r.status === 401 ? "Login required" : "Failed to load exams");
          return;
        }
        const d = await r.json();
        const list: Exam[] = Array.isArray(d?.exams) ? d.exams : [];
        setExams(list.filter((e) => e.count > 0));
        if (list.length > 0) setExamId(list[0].id);
      } catch {
        setError("Network error — backend unreachable");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step 2 — load years for the chosen exam
  React.useEffect(() => {
    if (!examId) return;
    setYear(null);
    setYears([]);
    setSubjects([]);
    setSelectedSubjects(new Set());
    setChapters([]);
    setSelectedChapters(new Set());
    setTopics([]);
    setSelectedTopics(new Set());
    (async () => {
      try {
        const r = await fetchAuth(`${apiBase()}/bank/years?examId=${examId}`, { headers: authHeaders() });
        if (!r.ok) return;
        const d = await r.json();
        const list: YearRow[] = Array.isArray(d) ? d : [];
        setYears(list);
      } catch {
        /* keep list empty, UI shows "no years yet" */
      }
    })();
  }, [examId]);

  // Step 3 — load subjects for exam+year once a year is chosen
  React.useEffect(() => {
    if (!examId || !year) return;
    (async () => {
      try {
        const r = await fetchAuth(`${apiBase()}/bank/subjects?examId=${examId}`, { headers: authHeaders() });
        if (!r.ok) return;
        const d = await r.json();
        const list: Subject[] = Array.isArray(d) ? d : [];
        setSubjects(list.filter((s) => s.questionCount > 0));
      } catch {
        /* ignore */
      }
    })();
  }, [examId, year]);

  // Step 4 — load chapters when subjects are (de)selected (one subject at a time, merged)
  React.useEffect(() => {
    if (selectedSubjects.size === 0) {
      setChapters([]);
      setSelectedChapters(new Set());
      setTopics([]);
      setSelectedTopics(new Set());
      return;
    }
    (async () => {
      try {
        const results = await Promise.all(
          Array.from(selectedSubjects).map((sid) =>
            fetchAuth(`${apiBase()}/bank/chapters?subjectId=${sid}&examId=${examId}`, { headers: authHeaders() }).then((r) =>
              r.ok ? r.json() : [],
            ),
          ),
        );
        const merged: Chapter[] = ([] as Chapter[]).concat(...results.filter(Array.isArray));
        setChapters(merged);
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSubjects, examId]);

  // Step 5 — load topics when chapters are (de)selected
  // BUGFIX (Session 20 — "exam-wise button should only give that exam's
  // PYQs" audit): this call never sent examId even though the exam is
  // already known at this point (same as the chapters fetch right above,
  // which does send it). Without it, the topic list/counts came from every
  // exam sharing this chapter, not just the one the student picked — a
  // topic could look non-empty here and still produce zero questions when
  // yearWiseStart() (which DOES filter by examId) tried to compose the
  // actual test. See BankService.topics() doc comment for the backend half
  // of this fix.
  React.useEffect(() => {
    if (selectedChapters.size === 0) {
      setTopics([]);
      setSelectedTopics(new Set());
      return;
    }
    (async () => {
      try {
        const results = await Promise.all(
          Array.from(selectedChapters).map((cid) =>
            fetchAuth(`${apiBase()}/bank/topics?chapterId=${cid}&examId=${examId}`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : [])),
          ),
        );
        const merged: TopicRow[] = ([] as TopicRow[]).concat(...results.filter(Array.isArray));
        setTopics(merged);
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChapters, examId]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const start = async (full: boolean) => {
    if (!examId || !year) return;
    setStarting(true);
    setError("");
    try {
      const cfg = {
        examId,
        year,
        full,
        subjectIds: full ? [] : Array.from(selectedSubjects),
        chapterIds: full ? [] : Array.from(selectedChapters),
        topicIds: full ? [] : Array.from(selectedTopics),
      };
      sessionStorage.setItem("ssc_yearwise_config", JSON.stringify(cfg));
      window.location.href = "/test?yearwise=1";
    } catch {
      setError("Could not start the test — please try again");
      setStarting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub
          </a>
          <a href="/mocks" className="btn btn-outline text-sm">Mock Tests</a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-bold">📅 Year-wise PYQ Test</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick an exam and a year, then attempt the full paper or narrow it down by subject, chapter, or topic.
        </p>

        {loading && <p className="mt-8 text-muted-foreground">Loading exams…</p>}
        {error && <p className="card mt-8 p-6 text-center text-sm text-danger">{error}</p>}

        {!loading && !error && (
          <div className="card mt-6 max-w-2xl space-y-6 p-6">
            {/* Exam */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Choose Exam *</label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {exams.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setExamId(e.id)}
                    className={`rounded-xl border p-4 text-left transition ${
                      examId === e.id ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"
                    }`}
                  >
                    <p className="font-semibold">{e.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{e.count.toLocaleString()} questions</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Year */}
            {examId && (
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Choose Year *</label>
                {years.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">No years tagged for this exam yet.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {years.map((y) => (
                      <button
                        key={y.year}
                        onClick={() => setYear(y.year)}
                        className={`rounded-lg border px-4 py-2 text-sm transition ${
                          year === y.year ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"
                        }`}
                      >
                        {y.year} <span className="text-xs text-muted-foreground">({y.questionCount})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Full paper shortcut */}
            {year && (
              <button
                onClick={() => start(true)}
                disabled={starting}
                className="btn w-full bg-primary py-3 text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {starting ? "Composing…" : `🚀 Attempt Full ${year} Paper (all subjects)`}
              </button>
            )}

            {/* Customisation — subject/chapter/topic, fully optional */}
            {year && subjects.length > 0 && (
              <div className="border-t border-border pt-5">
                <p className="text-xs font-semibold text-muted-foreground">
                  Or customise: pick subject(s) — leave empty for all subjects
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {subjects.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => toggle(selectedSubjects, setSelectedSubjects, s.id)}
                      className={`rounded-lg border p-3 text-left text-sm transition ${
                        selectedSubjects.has(s.id) ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>

                {chapters.length > 0 && (
                  <>
                    <p className="mt-4 text-xs font-semibold text-muted-foreground">
                      Chapter(s) — optional, narrows within the subject(s) above
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {chapters.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => toggle(selectedChapters, setSelectedChapters, c.id)}
                          className={`rounded-lg border p-3 text-left text-sm transition ${
                            selectedChapters.has(c.id) ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"
                          }`}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {topics.length > 0 && (
                  <>
                    <p className="mt-4 text-xs font-semibold text-muted-foreground">
                      Topic(s) — optional, narrows all the way down
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {topics.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => toggle(selectedTopics, setSelectedTopics, t.id)}
                          className={`rounded-lg border p-3 text-left text-sm transition ${
                            selectedTopics.has(t.id) ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"
                          }`}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <button
                  onClick={() => start(false)}
                  disabled={starting || selectedSubjects.size === 0}
                  className="btn mt-5 w-full bg-primary py-3 text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {starting ? "Composing…" : "🎯 Start Customised Test"}
                </button>
                {selectedSubjects.size === 0 && (
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    Pick at least one subject to start a customised test, or use the Full Paper button above.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
