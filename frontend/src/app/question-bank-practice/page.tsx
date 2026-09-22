"use client";

import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";

// ---------------------------------------------------------------------------
// REWRITTEN (Sep 21 2026) — "practice vale me topic subtopic ka pura syllabus
// bhi ho ... students topic subtopics bhi select krkr preparing kr paye":
// this page used to only offer Subject -> (optional flat) Chapter. It now
// walks the FULL syllabus tree — Subject -> Chapter -> Topic -> Sub-topic —
// straight from GET /bank/practice/taxonomy (the same tree an admin manages
// under Chapter/Topic Manage), with a question-count badge and a weak-topic
// (🔥 free) badge at every level. Nothing is typed; everything is picked
// from the list, so a topic an admin just created shows up here immediately.
// ---------------------------------------------------------------------------

type SubTopicNode = { id: string; name: string; nameHindi?: string | null; questionCount: number; isWeak: boolean };
type TopicNode = { id: string; name: string; nameHindi?: string | null; questionCount: number; isWeak: boolean; subTopics: SubTopicNode[] };
type ChapterNode = { id: string; name: string; nameHindi?: string | null; questionCount: number; unassignedCount: number; topics: TopicNode[] };
type SubjectNode = { id: string; name: string; nameHindi?: string | null; questionCount: number; chapters: ChapterNode[] };

type InProgressSet = {
  id: string;
  setNumber: number;
  total: number;
  answered: number;
  subject: string | null;
  chapter: string | null;
  topic: string | null;
  subTopic: string | null;
  exam: string | null;
  startedAt: string;
};

type TaxonomyResponse = {
  subjects: SubjectNode[];
  exams: { id: string; name: string; count: number }[];
  inProgress: InProgressSet[];
  freeSetsPerScope: number;
};

type UserProgress = {
  subjectId: string;
  subjectName: string;
  chapterId?: string;
  chapterName?: string;
  setsCompleted: number;
  totalQuestions: number;
  correctAnswers: number;
  wrongAnswers: number;
  skippedAnswers: number;
  accuracyPercent: number;
};

type Selection = { subjectId?: string; chapterId?: string; topicId?: string; subTopicId?: string };

export default function QuestionBankPracticePage() {
  const [taxonomy, setTaxonomy] = React.useState<TaxonomyResponse | null>(null);
  const [userProgress, setUserProgress] = React.useState<UserProgress[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [starting, setStarting] = React.useState(false);
  const [count, setCount] = React.useState(25);

  const [openSubject, setOpenSubject] = React.useState<string>("");
  const [openChapter, setOpenChapter] = React.useState<string>("");
  const [openTopic, setOpenTopic] = React.useState<string>("");
  const [selection, setSelection] = React.useState<Selection>({});

  const apiBase = () => API_BASE;
  const authHeaders = (): Record<string, string> => {
    const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [taxRes, progRes] = await Promise.all([
        fetchAuth(`${apiBase()}/bank/practice/taxonomy`, { headers: authHeaders() }),
        fetchAuth(`${apiBase()}/bank/practice/progress`, { headers: authHeaders() }),
      ]);
      if (!taxRes.ok || !progRes.ok) throw new Error("Failed to load data");
      setTaxonomy(await taxRes.json());
      setUserProgress(await progRes.json());
    } catch {
      setError("Network error — backend unreachable");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const selectedLabel = React.useMemo(() => {
    if (!taxonomy) return "";
    const s = taxonomy.subjects.find((x) => x.id === selection.subjectId);
    if (!s) return "";
    const c = s.chapters.find((x) => x.id === selection.chapterId);
    if (!c) return s.name;
    const t = c.topics.find((x) => x.id === selection.topicId);
    if (!t) return `${s.name} › ${c.name}`;
    const st = t.subTopics.find((x) => x.id === selection.subTopicId);
    if (!st) return `${s.name} › ${c.name} › ${t.name}`;
    return `${s.name} › ${c.name} › ${t.name} › ${st.name}`;
  }, [taxonomy, selection]);

  const start = async (sel: Selection) => {
    setStarting(true);
    setError("");
    try {
      const r = await fetchAuth(`${apiBase()}/bank/practice/start`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ...sel, mode: "practice", size: count }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        if (d.code === "PREMIUM_REQUIRED") {
          setError(`Is chapter/topic me free ${taxonomy?.freeSetsPerScope ?? 3} sets ho chuke hain. Unlimited practice ke liye Premium lein.`);
        } else {
          setError(`Failed: ${d.message || r.status}`);
        }
        return;
      }
      const d = await r.json();
      sessionStorage.setItem("ssc_sectional_set", JSON.stringify(d));
      sessionStorage.setItem(
        "ssc_sectional_subject",
        [d.subjectId && selectedLabel, d.examName].filter(Boolean).join(" — ") || "Question Bank Practice",
      );
      window.location.href = "/test?sectional=1";
    } catch {
      setError("Network error while starting practice");
    } finally {
      setStarting(false);
    }
  };

  const resumePractice = async (setId: string) => {
    setStarting(true);
    setError("");
    try {
      const r = await fetchAuth(`${apiBase()}/bank/practice/set/${setId}`, { headers: authHeaders() });
      if (!r.ok) throw new Error("Failed to load set");
      const d = await r.json();
      sessionStorage.setItem("ssc_sectional_set", JSON.stringify(d));
      sessionStorage.setItem("ssc_sectional_subject", d.subjectName || "Question Bank Practice");
      window.location.href = "/test?sectional=1";
    } catch {
      setError("Failed to resume practice");
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
          <div className="mx-auto flex max-w-4xl items-center justify-between">
            <a href="/dashboard" className="text-lg font-bold">
              ← <span className="text-primary">SSC</span>PrepHub
            </a>
            <a href="/dashboard" className="btn btn-outline text-sm">Dashboard</a>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-10">
          <div className="text-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading syllabus…</p>
          </div>
        </main>
      </div>
    );
  }

  const subjects = taxonomy?.subjects ?? [];
  const openSubjectNode = subjects.find((s) => s.id === openSubject);
  const openChapterNode = openSubjectNode?.chapters.find((c) => c.id === openChapter);
  const openTopicNode = openChapterNode?.topics.find((t) => t.id === openTopic);
  void openTopicNode; // reserved for future breadcrumb use

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub
          </a>
          <a href="/dashboard" className="btn btn-outline text-sm">Dashboard</a>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-bold">📚 Question Bank Practice</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Subject → Chapter → Topic → Sub-topic chunein aur seedhe usi par practice karein. 🔥 wale topics aapke liye
          weak hain — unpar unlimited free practice hai.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Continue where you left off */}
        {taxonomy && taxonomy.inProgress.length > 0 && (
          <div className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <h2 className="font-semibold text-primary">▶ Continue where you left off</h2>
            <div className="mt-3 space-y-2">
              {taxonomy.inProgress.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background p-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {[s.subject, s.chapter, s.topic, s.subTopic].filter(Boolean).join(" › ") || "Practice Set"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Set {s.setNumber} — {s.answered}/{s.total} done
                    </p>
                  </div>
                  <button
                    onClick={() => resumePractice(s.id)}
                    disabled={starting}
                    className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Resume
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Your Progress */}
        {userProgress.length > 0 && (
          <div className="mt-6 rounded-xl border border-border bg-card p-6">
            <h2 className="font-semibold text-lg">Your Progress</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {userProgress.map((p) => (
                <div key={`${p.subjectId}-${p.chapterId ?? ""}`} className="rounded-xl border border-border bg-background p-4">
                  <p className="font-semibold text-primary">{p.subjectName}</p>
                  {p.chapterName && <p className="mt-1 text-xs text-muted-foreground">{p.chapterName}</p>}
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Sets Completed</span><span className="font-semibold">{p.setsCompleted}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Questions</span><span className="font-semibold">{p.totalQuestions}</span></div>
                    <div className="flex justify-between"><span className="text-success">Correct: {p.correctAnswers}</span></div>
                    <div className="flex justify-between"><span className="text-destructive">Wrong: {p.wrongAnswers}</span></div>
                    <div className="flex justify-between"><span className="text-warning">Skipped: {p.skippedAnswers}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Accuracy</span><span className="font-semibold">{p.accuracyPercent}%</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Syllabus tree */}
        <div className="card mt-6 space-y-3 p-6">
          <h2 className="font-semibold text-lg">Syllabus</h2>
          {subjects.length === 0 && <p className="text-sm text-muted-foreground">Abhi syllabus me kuch nahi hai.</p>}

          <div className="space-y-2">
            {subjects.map((s) => (
              <div key={s.id} className="rounded-lg border border-border">
                <button
                  onClick={() => {
                    setOpenSubject(openSubject === s.id ? "" : s.id);
                    setOpenChapter("");
                    setOpenTopic("");
                  }}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span className="font-semibold">{s.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.questionCount} question{s.questionCount === 1 ? "" : "s"} {openSubject === s.id ? "▾" : "▸"}
                  </span>
                </button>

                {openSubject === s.id && (
                  <div className="space-y-1.5 border-t border-border px-3 py-2">
                    {s.chapters.map((c) => (
                      <div key={c.id} className="rounded-lg border border-border/60">
                        <div className="flex items-center justify-between px-3 py-2">
                          <button
                            onClick={() => {
                              setOpenChapter(openChapter === c.id ? "" : c.id);
                              setOpenTopic("");
                            }}
                            className="flex-1 text-left text-sm font-medium"
                          >
                            {c.name} <span className="text-xs text-muted-foreground">({c.questionCount})</span>{" "}
                            {openChapter === c.id ? "▾" : "▸"}
                          </button>
                          <button
                            onClick={() => setSelection({ subjectId: s.id, chapterId: c.id })}
                            disabled={c.questionCount === 0}
                            className={`ml-2 shrink-0 rounded-lg border px-2 py-1 text-xs ${
                              selection.chapterId === c.id && !selection.topicId
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border"
                            } disabled:opacity-40`}
                          >
                            Poora chapter select
                          </button>
                        </div>

                        {openChapter === c.id && (
                          <div className="space-y-1 border-t border-border/60 px-3 py-2">
                            {c.topics.length === 0 && (
                              <p className="text-xs text-muted-foreground">Is chapter me abhi koi topic nahi bana.</p>
                            )}
                            {c.topics.map((t) => (
                              <div key={t.id} className="rounded-lg border border-border/40">
                                <div className="flex items-center justify-between px-3 py-1.5">
                                  <button
                                    onClick={() => setOpenTopic(openTopic === t.id ? "" : t.id)}
                                    className="flex-1 text-left text-sm"
                                  >
                                    {t.isWeak && <span title="Weak — unlimited free practice">🔥 </span>}
                                    {t.name} <span className="text-xs text-muted-foreground">({t.questionCount})</span>{" "}
                                    {t.subTopics.length > 0 && (openTopic === t.id ? "▾" : "▸")}
                                  </button>
                                  <button
                                    onClick={() => setSelection({ subjectId: s.id, chapterId: c.id, topicId: t.id })}
                                    disabled={t.questionCount === 0}
                                    className={`ml-2 shrink-0 rounded-lg border px-2 py-1 text-xs ${
                                      selection.topicId === t.id && !selection.subTopicId
                                        ? "border-primary bg-primary/10 text-primary"
                                        : "border-border"
                                    } disabled:opacity-40`}
                                  >
                                    Select
                                  </button>
                                </div>
                                {openTopic === t.id && t.subTopics.length > 0 && (
                                  <div className="space-y-1 border-t border-border/40 px-3 py-1.5">
                                    {t.subTopics.map((st) => (
                                      <div key={st.id} className="flex items-center justify-between py-0.5 text-xs">
                                        <span>
                                          {st.isWeak && <span title="Weak — unlimited free practice">🔥 </span>}
                                          {st.name} <span className="text-muted-foreground">({st.questionCount})</span>
                                        </span>
                                        <button
                                          onClick={() =>
                                            setSelection({ subjectId: s.id, chapterId: c.id, topicId: t.id, subTopicId: st.id })
                                          }
                                          disabled={st.questionCount === 0}
                                          className={`shrink-0 rounded-lg border px-2 py-0.5 ${
                                            selection.subTopicId === st.id ? "border-primary bg-primary/10 text-primary" : "border-border"
                                          } disabled:opacity-40`}
                                        >
                                          Select
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Start */}
        {selection.subjectId && (
          <div className="card mt-6 space-y-4 p-6 border-primary/30 bg-primary/5">
            <p className="text-sm">
              Selected: <strong>{selectedLabel}</strong>
            </p>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Questions per set</label>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                {[10, 25, 50].map((c) => (
                  <option key={c} value={c}>{c} questions</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => start(selection)}
              disabled={starting}
              className="btn w-full bg-primary py-3 text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {starting ? "Starting…" : "🚀 Start Practice"}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              Pehle {taxonomy?.freeSetsPerScope ?? 3} sets free (is chapter/topic/sub-topic ke liye), uske baad Premium chahiye — 🔥 weak topics hamesha free.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
