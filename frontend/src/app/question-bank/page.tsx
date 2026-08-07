"use client";

import * as React from "react";

interface Subject {
  id: string;
  name: string;
  slug: string;
  questionCount: number;
  chapterCount: number;
}
interface Exam {
  id: string;
  name: string;
  count: number;
}
interface Chapter {
  id: string;
  name: string;
  subject: string;
  count: number;
}
interface Q {
  id: string;
  questionText: string;
  questionTextHindi?: string | null;
  options: { key: string; text: string }[];
  chapter: string;
  answerVerificationStatus?: string;
  lastVerifiedAt?: string | null;
}

const VERIF_BADGE: Record<string, string> = {
  VERIFIED_OFFICIAL: "bg-success/15 text-success",
  VERIFIED_MULTI_SOURCE: "bg-info/15 text-info",
  VERIFIED_COMPUTED: "bg-warning/15 text-warning",
  UNVERIFIED_SINGLE_SOURCE: "bg-muted text-muted-foreground",
  DISPUTED: "bg-danger/15 text-danger",
};
interface Attempt {
  correct: boolean;
  correctAnswer: string;
  selectedOption: string;
  explanation?: string | null;
  explanationHindi?: string | null;
  scoreDelta: number;
}

function getAuthHeaders(): { [k: string]: string } {
  try {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function apiBase() {
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
}

export default function QuestionBankPage() {
  const [examId, setExamId] = React.useState<string>("");
  const [subjectId, setSubjectId] = React.useState<string>("");
  const [chapterId, setChapterId] = React.useState<string>("");
  const [exams, setExams] = React.useState<Exam[]>([]);
  const [subjects, setSubjects] = React.useState<Subject[]>([]);
  const [chapters, setChapters] = React.useState<Chapter[]>([]);
  const [questions, setQuestions] = React.useState<Q[]>([]);
  const [total, setTotal] = React.useState(0);
  const [sel, setSel] = React.useState<{ [qid: string]: string }>({});
  const [result, setResult] = React.useState<{ [qid: string]: Attempt }>({});
  const [showHi, setShowHi] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [metaTotal, setMetaTotal] = React.useState(0);

  // Load meta
  React.useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const base = apiBase();
        const [m, sc] = await Promise.all([
          fetch(`${base}/bank/meta`, { headers: getAuthHeaders() }).then((r) => r.json()),
          fetch(`${base}/bank/subjects`, { headers: getAuthHeaders() }).then((r) => r.json()),
        ]);
        setExams(Array.isArray(m?.exams) ? m.exams.filter((e: Exam) => e.count > 0) : []);
        setSubjects(Array.isArray(sc) ? sc : []);
        setMetaTotal(Number(m?.totalQuestions) || 0);
      } catch (e) {
        console.error("meta load fail", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadChapters = async (sid: string) => {
    setChapterId("");
    setChapters([]);
    try {
      const r = await fetch(`${apiBase()}/bank/chapters?subjectId=${sid}`, { headers: getAuthHeaders() });
      setChapters(await r.json());
    } catch {}
  };

  const loadQuestions = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("take", "20");
      if (examId) params.append("examId", examId);
      if (chapterId) params.append("chapterId", chapterId);
      else if (subjectId) params.append("subjectId", subjectId);
      const r = await fetch(`${apiBase()}/bank/questions?${params}`, { headers: getAuthHeaders() });
      const d = await r.json();
      setQuestions(d.data || []);
      setTotal(d.total || 0);
      setSel({});
      setResult({});
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const pickOption = async (qid: string, key: string) => {
    setSel((p) => ({ ...p, [qid]: key }));
    try {
      const r = await fetch(`${apiBase()}/bank/attempt`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: qid, selectedOption: key }),
      });
      const d: Attempt = await r.json();
      if (d && typeof d.correct === "boolean") setResult((p) => ({ ...p, [qid]: d }));
    } catch {}
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">📚 SSC Question Bank</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {metaTotal}+ verified PYQs · Hindi + English · instant answer feedback
          </p>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={showHi} onChange={(e) => setShowHi(e.target.checked)} />
            Hindi
          </label>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Exam</label>
          <select value={examId} onChange={(e) => setExamId(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">All Exams</option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>{e.name} ({e.count})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Subject</label>
          <select
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value);
              loadChapters(e.target.value);
            }}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All Subjects</option>
            {subjects.filter((s) => s.questionCount > 0).map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.questionCount})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Chapter</label>
          <select value={chapterId} onChange={(e) => setChapterId(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" disabled={!subjectId}>
            <option value="">All Chapters</option>
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.count})</option>
            ))}
          </select>
        </div>
      </div>

      <button onClick={loadQuestions} disabled={loading}
        className="mb-6 w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {loading ? "Loading..." : `Load Questions (${total} total)`}
      </button>

      {/* Questions */}
      {questions.length === 0 && !loading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Select a filter and press Load Questions.</p>
      )}
      <div className="space-y-4">
        {questions.map((q, i) => {
          const a = result[q.id];
          const selKey = sel[q.id];
          const showAnswer = Boolean(a);
          return (
            <div key={q.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start gap-2">
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold">{i + 1}</span>
                <span className="text-sm font-medium">{showHi && q.questionTextHindi ? q.questionTextHindi : q.questionText}</span>
                {q.answerVerificationStatus && (
                  <span className={`badge shrink-0 ${VERIF_BADGE[q.answerVerificationStatus] || VERIF_BADGE.UNVERIFIED_SINGLE_SOURCE}`}>
                    {q.answerVerificationStatus === "VERIFIED_OFFICIAL" ? "✅" : ""} {q.answerVerificationStatus.replace(/_/g, " ")}
                  </span>
                )}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {q.options.map((o) => {
                  const isSel = selKey === o.key;
                  const isCorrect = showAnswer && a.correctAnswer === o.key;
                  const wrong = showAnswer && isSel && o.key !== a.correctAnswer;
                  const cls = wrong ? "border-red-500 bg-red-50"
                    : isCorrect ? "border-emerald-500 bg-emerald-50"
                    : isSel ? "border-primary bg-muted"
                    : "border-border hover:bg-muted";
                  return (
                    <button key={o.key} onClick={() => pickOption(q.id, o.key)} disabled={Boolean(a)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${cls} disabled:cursor-default`}>
                      <span className="font-semibold">{o.key})</span> {showHi && q.questionTextHindi ? o.text : o.text}
                    </button>
                  );
                })}
              </div>
              {showAnswer && (
                <div className={`mt-3 rounded-lg border p-3 text-sm ${a.correct ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}>
                  <p className="font-semibold">
                    {a.correct ? "✅ Correct ! " : "❌ Wrong. "}Correct Answer: {a.correctAnswer} ({a.scoreDelta > 0 ? "+" : ""}{a.scoreDelta})
                  </p>
                  {a.explanation && <p className="mt-1">{a.explanation}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}