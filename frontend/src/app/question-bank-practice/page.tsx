"use client";

import * as React from "react";
import { fetchAuth } from "@/lib/api";
import Link from "next/link";

type PracticeSetData = {
  id: string;
  subjectId?: string;
  chapterId?: string;
  examId?: string;
  setNumber: number;
  questions: {
    id: string;
    questionText: string;
    questionTextHindi?: string | null;
    options: { key: string; text: string; textHi?: string | null }[];
    chapter: string;
    examName?: string | null;
    year?: number | null;
    shift?: string | null;
    marks?: number;
    negativeMarks?: number;
    correctAnswer?: string | null;
    explanation?: string | null;
    explanationHindi?: string | null;
    subjectId?: string;
    _weakMeta?: { chapterId: string; chapterName: string; wasWrong: boolean; wasSkipped: boolean };
  }[];
  currentIndex: number;
  answers: Record<string, string>;
  startedAt: string;
  completedAt?: string;
  score?: number;
  isCompleted: boolean;
  mode: string;
  subjectName?: string;
  chapterName?: string;
  examName?: string;
};

type SubjectData = {
  id: string;
  name: string;
  chapters: {
    id: string;
    name: string;
    progress: any;
  }[];
  progress: any;
};

type UserProgress = {
  subjectId: string;
  subjectName: string;
  chapterId?: string;
  chapterName?: string;
  examId?: string;
  examName?: string;
  setsCompleted: number;
  totalQuestions: number;
  correctAnswers: number;
  wrongAnswers: number;
  skippedAnswers: number;
  accuracyPercent: number;
  lastPracticedAt: string;
};

export default function QuestionBankPracticePage() {
  const [subjects, setSubjects] = React.useState<SubjectData[]>([]);
  const [selectedSubject, setSelectedSubject] = React.useState<string>("");
  const [selectedChapter, setSelectedChapter] = React.useState<string>("");
  const [count, setCount] = React.useState(25);
  const [loading, setLoading] = React.useState(true);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [userProgress, setUserProgress] = React.useState<UserProgress[]>([]);
  const [currentSet, setCurrentSet] = React.useState<PracticeSetData | null>(null);
  const [resumeSet, setResumeSet] = React.useState<string>("");

  const apiBase = () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";

  const authHeaders = (): Record<string, string> => {
    const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [subjectsRes, progressRes] = await Promise.all([
        fetchAuth(`${apiBase()}/bank/practice/subjects`, { headers: authHeaders() }),
        fetchAuth(`${apiBase()}/bank/practice/progress`, { headers: authHeaders() }),
      ]);
      if (!subjectsRes.ok || !progressRes.ok) {
        throw new Error("Failed to load data");
      }
      const subjectsData = await subjectsRes.json();
      const progressData = await progressRes.json();
      setSubjects(subjectsData);
      setUserProgress(progressData);
      
      // Check for resume parameter in URL
      if (typeof window !== "undefined") {
        const urlSet = new URLSearchParams(window.location.search).get("set");
        if (urlSet) {
          setResumeSet(urlSet);
        }
      }
    } catch {
      setError("Network error — backend unreachable");
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load();
  }, []);

  const start = async () => {
    if (!selectedSubject) return;
    setStarting(true);
    setError("");
    try {
      const r = await fetchAuth(`${apiBase()}/bank/practice/start`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ 
          subjectId: selectedSubject, 
          chapterId: selectedChapter || undefined,
          setNumber: 1,
          mode: "practice",
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        if (d.code === "PREMIUM_REQUIRED") {
          setError(`Free users can only practice 3 sets per subject/chapter. Upgrade to Premium for unlimited practice.`);
        } else {
          setError(`Failed: ${d.message || r.status}`);
        }
        return;
      }
      const d = await r.json();
      // Store the practice set in sessionStorage for the test page
      sessionStorage.setItem("ssc_sectional_set", JSON.stringify(d));
      sessionStorage.setItem("ssc_sectional_subject", d.subjectName || "Question Bank Practice");
      window.location.href = "/test?sectional=1";
    } catch {
      setError("Network error while starting practice");
    } finally {
      setStarting(false);
    }
  };

  const resumePractice = async (setId: string) => {
    setStarting(true);
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
            <p className="mt-4 text-muted-foreground">Loading practice subjects…</p>
          </div>
        </main>
      </div>
    );
  }

  // If there's a resume set, load it and show resume button
  if (resumeSet && !currentSet) {
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
            <p className="mt-4 text-muted-foreground">Resuming your practice set…</p>
          </div>
        </main>
      </div>
    );
  }

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
          Practice 25-question sets per subject/chapter. First 3 sets free, then Premium required.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* User Progress Summary */}
        {userProgress.length > 0 && (
          <div className="mt-6 rounded-xl border border-border bg-card p-6">
            <h2 className="font-semibold text-lg">Your Progress</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {userProgress.map((p) => (
                <div key={p.subjectId} className="rounded-xl border border-border bg-background p-4">
                  <p className="font-semibold text-primary">{p.subjectName}</p>
                  {p.chapterName && <p className="mt-1 text-xs text-muted-foreground">{p.chapterName}</p>}
                  {p.examName && <p className="mt-1 text-xs text-info">{p.examName}</p>}
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Sets Completed</span>
                      <span className="font-semibold">{p.setsCompleted}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Questions</span>
                      <span className="font-semibold">{p.totalQuestions}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-success">Correct: {p.correctAnswers}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-destructive">Wrong: {p.wrongAnswers}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-warning">Skipped: {p.skippedAnswers}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Accuracy</span>
                      <span className="font-semibold">{p.accuracyPercent}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Subject Selection */}
        <div className="card mt-6 space-y-5 p-6">
          <h2 className="font-semibold text-lg">Choose Subject</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {subjects.length} subjects available — click a subject to see chapters and start practice
          </p>
          
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {subjects.map((s) => (
              <div key={s.id} className="rounded-xl border border-border bg-card p-4">
                <p className="font-semibold">{s.name}</p>
                {s.chapters && s.chapters.length > 0 && (
                  <div className="mt-2">
                    <label className="text-xs font-medium text-muted-foreground">Chapter (optional)</label>
                    <select
                      value={selectedSubject === s.id ? selectedChapter : ""}
                      onChange={(e) => {
                        setSelectedSubject(s.id);
                        setSelectedChapter(e.target.value);
                      }}
                      disabled={selectedSubject !== s.id}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    >
                      <option value="">All Chapters</option>
                      {s.chapters.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <button
                  onClick={() => setSelectedSubject(s.id)}
                  className={`mt-3 w-full rounded-xl transition ${selectedSubject === s.id
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-card hover:border-primary/50"}`}
                >
                  {selectedSubject === s.id ? "✓ Selected" : "Select Subject"}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Practice Settings */}
        {!loading && !error && selectedSubject && (
          <div className="card mt-6 space-y-5 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Questions per practice set</label>
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
              <div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={true}
                    onChange={() => {}}
                    disabled
                    className="h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
                  />
                  <span className="text-muted-foreground">Fixed at 25 questions per set (optimized)</span>
                </label>
              </div>
            </div>

            <div className="border-t border-border pt-4">
              {userProgress.find((p) => p.subjectId === selectedSubject) && (
                <div className="rounded-lg bg-info/5 p-3 text-sm text-info">
                  💡 You've completed <strong>{userProgress.find((p) => p.subjectId === selectedSubject)?.setsCompleted || 0} sets</strong> in this subject. 
                  {userProgress.find((p) => p.subjectId === selectedSubject)!.setsCompleted >= 3 && (
                    <span> Upgrade to Premium for unlimited practice.</span>
                  )}
                </div>
              )}
              
              <button
                onClick={start}
                disabled={starting || !selectedSubject}
                className="btn w-full bg-primary py-3 text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {starting ? "Starting…" : `🚀 Start Practice Set ${(userProgress.find((p) => p.subjectId === selectedSubject)?.setsCompleted || 0) + 1} (25 Questions)`}
              </button>

              <p className="text-center text-xs text-muted-foreground">
                First 3 sets free per subject/chapter. After that, upgrade to Premium for unlimited practice.
              </p>
            </div>
          </div>
        )}

        {/* Resume Practice */}
        {currentSet && (
          <div className="card mt-6 space-y-5 p-6 border-primary/30 bg-primary/5">
            <h2 className="font-semibold text-lg text-primary">📖 Resume Practice</h2>
            <p className="text-sm text-muted-foreground">
              You have an in-progress practice set: <strong>Set {currentSet.setNumber}</strong> ({currentSet.currentIndex}/{currentSet.questions.length} questions done)
            </p>
            <button
              onClick={() => resumePractice(currentSet.id)}
              disabled={starting}
              className="btn w-full bg-primary py-3 text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {starting ? "Resuming…" : "▶ Continue Practice"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}