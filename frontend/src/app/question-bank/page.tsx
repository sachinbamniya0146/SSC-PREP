"use client";
import { fetchAuth } from "@/lib/api";

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
  videoUrl?: string | null;
  videoSource?: string | null;
  videoTitle?: string | null;
  scoreDelta: number;
}

// Render a YouTube/Vimeo/S3 video URL in an iframe player
function VideoPlayer({ url, title }: { url: string; title?: string | null }) {
  let src = url;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu")) {
      const v = u.searchParams.get("v") || u.pathname.split("/").filter(Boolean).pop();
      src = v ? `https://www.youtube.com/embed/${v}` : url;
    } else if (u.hostname.includes("vimeo")) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      src = id ? `https://player.vimeo.com/video/${id}` : url;
    }
  } catch {
    src = url;
  }
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border">
      <iframe src={src} title={title || "Video Solution"} className="aspect-video w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen />
    </div>
  );
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
  const [bookmarked, setBookmarked] = React.useState<{ [qid: string]: boolean }>({});
  const [pdfBusy, setPdfBusy] = React.useState(false);
  // v2 §7.6 — Previous SSC References (real-DB, loaded on demand)
  const [sscRefs, setSscRefs] = React.useState<{ [qid: string]: any }>({});

  const loadSscRefs = async (questionId: string) => {
    try {
      const r = await fetchAuth(`${apiBase()}/bank/questions/${questionId}`, { headers: getAuthHeaders() });
      if (r.ok) {
        const d = await r.json();
        setSscRefs((prev) => ({ ...prev, [questionId]: d }));
      }
    } catch {
      /* ignore */
    }
  };

  const toggleBookmark = async (questionId: string) => {
    const token = localStorage.getItem("ssc_access_token");
    if (!token) return;
    try {
      const r = await fetchAuth(`${apiBase()}/bookmarks/${questionId}/toggle`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (r.ok) {
        const d = await r.json();
        setBookmarked((prev) => ({ ...prev, [questionId]: d.bookmarked }));
      }
    } catch {
      /* ignore */
    }
  };

  // v3 §7 — Chapter PDF (₹1 one-time) — buy → download (server-entitlement-checked)
  const downloadChapterPdf = async () => {
    if (!chapterId) return;
    setPdfBusy(true);
    try {
      const r = await fetchAuth(`${apiBase()}/pdf/chapter/${encodeURIComponent(chapterId)}/generate`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j.message || "Chapter PDF unavailable — buy it (₹1) or get Premium.");
        return;
      }
      const blob = await r.blob();
      const name = chapters.find((c) => c.id === chapterId)?.name || "Chapter";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `SSC_${name.replace(/[^a-z0-9]+/gi, "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      alert("Download failed — try again.");
    } finally {
      setPdfBusy(false);
    }
  };

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

  // v7 §1.4 — count integrity: when the exam changes, subjects/chapters counts
  // must come from the SAME query Load Questions runs (exam-scoped).
  React.useEffect(() => {
    if (!examId) return;
    let alive = true;
    (async () => {
      try {
        const sc = await fetchAuth(`${apiBase()}/bank/subjects?examId=${encodeURIComponent(examId)}`, {
          headers: getAuthHeaders(),
        }).then((r) => r.json());
        if (alive) setSubjects(Array.isArray(sc) ? sc : []);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, [examId]);

  const loadChapters = async (sid: string) => {
    setChapterId("");
    setChapters([]);
    try {
      const r = await fetchAuth(`${apiBase()}/bank/chapters?subjectId=${sid}${examId ? `&examId=${encodeURIComponent(examId)}` : ""}`, { headers: getAuthHeaders() });
      setChapters(await r.json());
    } catch {}
  };

  const loadQuestions = async () => {
    setLoading(true);
    try {
      // v4 §18 — typo-tolerant search: when the user lands with ?q=, route to
      // Meilisearch (typo/proximity ranking) instead of exact SQL filters.
      const searchQ =
        typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("q") : null;
      if (searchQ) {
        const r = await fetchAuth(`${apiBase()}/search?q=${encodeURIComponent(searchQ)}&limit=20`, {
          headers: getAuthHeaders(),
        });
        const d = await r.json();
        const hits = Array.isArray(d?.hits) ? d.hits : [];
        setQuestions(
          hits.map((h: any) => ({
            id: h.id,
            questionText: h.questionText || "",
            questionTextHindi: h.questionTextHindi || null,
            options: Array.isArray(h.optionsJson) ? h.optionsJson : [],
            chapter: h.chapter?.name || "",
            examName: h.exam?.name || null,
            year: h.year ?? null,
            answerVerificationStatus: h.answerVerificationStatus ?? "UNVERIFIED_SINGLE_SOURCE",
            lastVerifiedAt: h.lastVerifiedAt ?? null,
            explanation: h.explanation || null,
            explanationHindi: h.explanationHindi || null,
          })),
        );
        setTotal(hits.length);
        setSel({});
        setResult({});
        return;
      }
      const params = new URLSearchParams();
      params.append("take", "20");
      if (examId) params.append("examId", examId);
      if (chapterId) params.append("chapterId", chapterId);
      else if (subjectId) params.append("subjectId", subjectId);
      const r = await fetchAuth(`${apiBase()}/bank/questions?${params}`, { headers: getAuthHeaders() });
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
      const r = await fetchAuth(`${apiBase()}/bank/attempt`, {
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

      <div className="mb-6 flex gap-2">
        <button onClick={loadQuestions} disabled={loading}
          className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {loading ? "Loading..." : `Load Questions (${total} total)`}
        </button>
        {chapterId && (
          <>
          <a
            href={`/test?chapter=${encodeURIComponent(chapterId)}${examId ? `&exam=${encodeURIComponent(examId)}` : ""}`}
            className="rounded-lg border border-primary/40 bg-primary/10 px-5 py-2.5 text-sm font-semibold text-primary hover:bg-primary/20"
          >
            ▶ Practice Chapter (25 Qs)
          </a>
          <button
            onClick={downloadChapterPdf}
            disabled={pdfBusy || !chapterId}
            className="rounded-lg border border-success/40 bg-success/10 px-5 py-2.5 text-sm font-semibold text-success hover:bg-success/20 disabled:opacity-50"
          >
            {pdfBusy ? "Generating…" : "📥 Chapter PDF (₹1)"}
          </button>
          </>
        )}
      </div>

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
                <button
                  onClick={() => loadSscRefs(q.id)}
                  className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                  title="Previous SSC references (real data)"
                >
                  📚 SSC Refs
                </button>
                <button
                  onClick={() => toggleBookmark(q.id)}
                  className="ml-auto shrink-0 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-amber-400 hover:text-amber-500"
                >
                  {bookmarked[q.id] ? "🔖 Saved" : "🔖 Save"}
                </button>
              </div>
              {sscRefs[q.id] && (
                <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                  <p className="font-semibold text-primary">
                    📚 Previous SSC References ({sscRefs[q.id].previousSscRefs?.count ?? 0} in bank ·{" "}
                    {sscRefs[q.id].previousSscRefs?.acrossYears ?? 0} across years)
                  </p>
                  {(sscRefs[q.id].previousSscRefs?.years ?? []).length > 0 && (
                    <p className="mt-1">Prior years: {(sscRefs[q.id].previousSscRefs.years as number[]).join(", ")}</p>
                  )}
                  {sscRefs[q.id].expectedFrequency?.askedTimes != null && (
                    <p className="mt-1">
                      Expected frequency: asked{" "}
                      {sscRefs[q.id].expectedFrequency.askedTimes}× in the last 5 years
                      {sscRefs[q.id].expectedFrequency.yearsCovered
                        ? ` (${sscRefs[q.id].expectedFrequency.yearsCovered} yearly questions in bank)`
                        : ""}
                    </p>
                  )}
                  {(sscRefs[q.id].expectedFrequency?.askedTimes == null || sscRefs[q.id].previousSscRefs?.count === 0) && (
                    <p className="mt-1">Not enough yearly data yet — this chapter is still being backfilled.</p>
                  )}
                </div>
              )}
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {q.options.map((o) => {
                  const isSel = selKey === o.key;
                  const isCorrect = showAnswer && a.correctAnswer === o.key;
                  const wrong = showAnswer && isSel && o.key !== a.correctAnswer;
                  const cls = wrong ? "border-red-500 bg-red-500/10 text-red-600 dark:text-red-400"
                    : isCorrect ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : isSel ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-muted text-foreground";
                  return (
                    <button key={o.key} onClick={() => pickOption(q.id, o.key)} disabled={Boolean(a)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${cls} disabled:cursor-default`}>
                      <span className="font-semibold">{o.key})</span>{" "}
                      {showHi && (o as any).textHi ? (o as any).textHi : o.text}
                    </button>
                  );
                })}
              </div>
              {showAnswer && (
                <div className={`mt-3 rounded-lg border p-3 text-sm ${a.correct ? "border-success/40 bg-success/10" : "border-danger/40 bg-danger/10"}`}>
                  <p className={`font-semibold ${a.correct ? "text-success" : "text-danger"}`}>
                    {a.correct ? "✅ Correct ! " : "❌ Wrong. "}Correct Answer: {a.correctAnswer} ({a.scoreDelta > 0 ? "+" : ""}{a.scoreDelta})
                  </p>
                  {a.videoUrl && <VideoPlayer url={a.videoUrl} title={a.videoTitle} />}
                  {(a.explanation || a.explanationHindi) && (
                    <div className="mt-2 space-y-1">
                      {a.explanation && <p className="whitespace-pre-line">📖 {a.explanation}</p>}
                      {a.explanationHindi && (
                        <p className="whitespace-pre-line border-t border-border pt-1">
                          🇮🇳 {a.explanationHindi}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}