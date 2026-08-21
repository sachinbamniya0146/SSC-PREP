"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type Subject = {
  id: string;
  name: string;
  nameHindi?: string | null;
  chapters: Chapter[];
};

type Chapter = {
  id: string;
  name: string;
  nameHindi?: string | null;
  topics: Topic[];
  questionCount: number;
};

type Topic = {
  id: string;
  name: string;
  nameHindi?: string | null;
  questionCount: number;
};

type Exam = {
  id: string;
  name: string;
  subjects: Subject[];
};

export default function CustomTestPage() {
  const router = useRouter();
  const [exams, setExams] = React.useState<Exam[]>([]);
  const [selectedExam, setSelectedExam] = React.useState<string>("");
  const [selectedSubjects, setSelectedSubjects] = React.useState<string[]>([]);
  const [selectedChapters, setSelectedChapters] = React.useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = React.useState<string[]>([]);
  const [questionCount, setQuestionCount] = React.useState(10);
  const [testName, setTestName] = React.useState("");
  const [isPremium, setIsPremium] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [availableCount, setAvailableCount] = React.useState(0);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
  const headers = (): Record<string, string> => {
    const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const loadExams = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/bank/exams`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setExams(data.exams || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    loadExams();
  }, []);

  React.useEffect(() => {
    if (!selectedExam) {
      setSelectedSubjects([]);
      setSelectedChapters([]);
      setSelectedTopics([]);
      setAvailableCount(0);
      return;
    }
    updateAvailableCount();
  }, [selectedExam, selectedSubjects, selectedChapters, selectedTopics]);

  const updateAvailableCount = async () => {
    if (!selectedExam) return;
    const params = new URLSearchParams();
    params.set("examId", selectedExam);
    if (selectedSubjects.length) params.set("subjectIds", selectedSubjects.join(","));
    if (selectedChapters.length) params.set("chapterIds", selectedChapters.join(","));
    if (selectedTopics.length) params.set("topicIds", selectedTopics.join(","));
    params.set("isApproved", "true");
    params.set("isActive", "true");
    params.set("limit", "1");

    try {
      const res = await fetch(`${apiBase}/bank?${params.toString()}`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setAvailableCount(data.total || 0);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreate = async () => {
    if (!testName.trim()) {
      setError("Test name is required");
      return;
    }
    if (!selectedExam) {
      setError("Select an exam");
      return;
    }
    if (availableCount < questionCount) {
      setError(`Only ${availableCount} questions available for this selection. Reduce question count or broaden selection.`);
      return;
    }

    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`${apiBase}/tests/custom`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({
          name: testName,
          examId: selectedExam,
          subjectIds: selectedSubjects.length ? selectedSubjects : undefined,
          chapterIds: selectedChapters.length ? selectedChapters : undefined,
          topicIds: selectedTopics.length ? selectedTopics : undefined,
          questionCount,
          isPremium,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setSuccess(`Custom test "${testName}" created! ${data.totalQuestions} questions.`);
        setTimeout(() => router.push(`/test/${data.id}`), 1500);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.message || "Failed to create test");
      }
    } catch (e) {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  };

  const exam = exams.find((e) => e.id === selectedExam);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🔨</div>
          <p className="text-muted-foreground">Loading exam structure...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub
          </a>
          <span className="text-sm text-muted-foreground">Custom Test Builder 🔨</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Create Custom Test</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick topics, set question count, and generate a personalized test instantly.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-danger/10 p-4 text-sm text-danger">{error}</div>
        )}
        {success && (
          <div className="mb-6 rounded-lg bg-success/10 p-4 text-sm text-success">{success}</div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="card p-5">
              <h2 className="text-lg font-semibold">Step 1: Choose Exam</h2>
              <select
                value={selectedExam}
                onChange={(e) => setSelectedExam(e.target.value)}
                className="mt-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select an exam...</option>
                {exams.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>

            {exam && (
              <div className="card p-5">
                <h2 className="text-lg font-semibold">Step 2: Select Subjects</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {exam.subjects.map((s) => (
                    <label
                      key={s.id}
                      className={`rounded-lg border px-4 py-2 text-sm cursor-pointer transition ${
                        selectedSubjects.includes(s.id)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSubjects.includes(s.id)}
                        onChange={() =>
                          setSelectedSubjects((prev) =>
                            prev.includes(s.id)
                              ? prev.filter((id) => id !== s.id)
                              : [...prev, s.id]
                          )
                        }
                        className="mr-2"
                      />
                      {s.name}
                      {s.nameHindi && <span className="ml-2 text-xs text-muted-foreground">({s.nameHindi})</span>}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {exam && selectedSubjects.length > 0 && (
              <div className="card p-5">
                <h2 className="text-lg font-semibold">Step 3: Select Chapters</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {exam.subjects
                    .filter((s) => selectedSubjects.includes(s.id))
                    .flatMap((s) =>
                      s.chapters.map((c) => ({
                        ...c,
                        subjectName: s.name,
                        subjectId: s.id,
                      }))
                    )
                    .map((c) => (
                      <label
                        key={c.id}
                        className={`rounded-lg border px-4 py-2 text-sm cursor-pointer transition ${
                          selectedChapters.includes(c.id)
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedChapters.includes(c.id)}
                          onChange={() =>
                            setSelectedChapters((prev) =>
                              prev.includes(c.id)
                                ? prev.filter((id) => id !== c.id)
                                : [...prev, c.id]
                            )
                          }
                          className="mr-2"
                        />
                        {c.name}
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({c.questionCount} Qs)
                        </span>
                      </label>
                    ))}
                </div>
              </div>
            )}

            {exam && selectedChapters.length > 0 && (
              <div className="card p-5">
                <h2 className="text-lg font-semibold">Step 4: Select Topics (Optional)</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {exam.subjects
                    .flatMap((s) =>
                      s.chapters
                        .filter((c) => selectedChapters.includes(c.id))
                        .flatMap((c) =>
                          c.topics.map((t) => ({
                            ...t,
                            chapterName: c.name,
                            chapterId: c.id,
                          }))
                        )
                    )
                    .map((t) => (
                      <label
                        key={t.id}
                        className={`rounded-lg border px-4 py-2 text-sm cursor-pointer transition ${
                          selectedTopics.includes(t.id)
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedTopics.includes(t.id)}
                          onChange={() =>
                            setSelectedTopics((prev) =>
                              prev.includes(t.id)
                                ? prev.filter((id) => id !== t.id)
                                : [...prev, t.id]
                            )
                          }
                          className="mr-2"
                        />
                        {t.name}
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({t.questionCount} Qs)
                        </span>
                      </label>
                    ))}
                </div>
              </div>
            )}
          </div>

          <div className="card p-5 sticky top-24 space-y-5">
            <h2 className="text-lg font-semibold">Test Settings</h2>

            <div>
              <label className="block text-sm font-medium">Test Name</label>
              <input
                type="text"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                placeholder="My Custom Reasoning Test"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">
                Questions: {questionCount}
              </label>
              <input
                type="range"
                min={5}
                max={Math.max(50, availableCount || 50)}
                step={5}
                value={questionCount}
                onChange={(e) => setQuestionCount(Math.min(Number(e.target.value), availableCount || 50))}
                className="mt-1 w-full"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Available: {availableCount} questions
              </p>
            </div>

            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPremium}
                  onChange={(e) => setIsPremium(e.target.checked)}
                  className="rounded border-input"
                />
                <span className="text-sm">Premium test (paid)</span>
              </label>
            </div>

            <div className="border-t border-border pt-4 space-y-2">
              <p className="text-sm font-semibold">Summary</p>
              <p className="text-sm text-muted-foreground">
                Exam: {exam?.name || "—"}
              </p>
              <p className="text-sm text-muted-foreground">
                Subjects: {selectedSubjects.length}
              </p>
              <p className="text-sm text-muted-foreground">
                Chapters: {selectedChapters.length}
              </p>
              <p className="text-sm text-muted-foreground">
                Topics: {selectedTopics.length || "All"}
              </p>
              <p className="text-sm text-muted-foreground">
                Questions: {questionCount}
              </p>
            </div>

            <button
              onClick={handleCreate}
              disabled={creating || !selectedExam || availableCount < questionCount}
              className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              {creating ? "Creating..." : "🔨 Create Test"}
            </button>

            <p className="text-center text-xs text-muted-foreground">
              After creation, you'll be redirected to take the test.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}