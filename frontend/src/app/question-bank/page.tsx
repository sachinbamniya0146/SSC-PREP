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
  // v7 §1 — Exam-scoped mode: when exam comes from URL, hide other exams & auto-load
  const [examScoped, setExamScoped] = React.useState(false);
  // Test Mode state
  const [testMode, setTestMode] = React.useState(false);
  const [testQuestions, setTestQuestions] = React.useState<Q[]>([]);
  const [testIdx, setTestIdx] = React.useState(0);
  const [testAnswers, setTestAnswers] = React.useState<{ [qid: string]: string }>({});
  const [testResults, setTestResults] = React.useState<{ [qid: string]: Attempt }>({});
  const [testTimeLeft, setTestTimeLeft] = React.useState(0);
  const [testRunning, setTestRunning] = React.useState(false);
  const [testStartTime, setTestStartTime] = React.useState<number | null>(null);
  const [testPhase, setTestPhase] = React.useState<'instructions' | 'exam' | 'results'>('instructions');
  const [testDuration, setTestDuration] = React.useState(0);
  const [testPaused, setTestPaused] = React.useState(false);
  const [resumeData, setResumeData] = React.useState<{ questions: Q[], idx: number, answers: { [qid: string]: string }, timeLeft: number, duration: number } | null>(null);

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
          fetchAuth(`${base}/bank/meta`, { headers: getAuthHeaders() }).then((r) => r.json()),
          fetchAuth(`${base}/bank/subjects`, { headers: getAuthHeaders() }).then((r) => r.json()),
        ]);
        const allExams = Array.isArray(m?.exams) ? m.exams.filter((e: Exam) => e.count > 0) : [];
        setExams(allExams);
        setSubjects(Array.isArray(sc) ? sc : []);
        setMetaTotal(Number(m?.totalQuestions) || 0);

        // v7 §1 — Check for exam in URL params
        if (typeof window !== "undefined") {
          const urlExam = new URLSearchParams(window.location.search).get("exam");
          if (urlExam && allExams.some((e: Exam) => e.id === urlExam)) {
            setExamId(urlExam);
            setExamScoped(true);
          }
        }
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

  // v7 §1 — Auto-load questions when exam is set from URL (exam-scoped mode)
  React.useEffect(() => {
    if (examId && examScoped) {
      loadQuestions();
    }
  }, [examId, examScoped]);

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

  // ============ TEST MODE FUNCTIONS ============
  // Start test mode with loaded questions. Resume support: if the user
  // already attempted some of these questions before, start from the first
  // un-answered one (never repeat work already done).
  const startQuestionBankTest = () => {
    if (questions.length === 0) return;
    // resume-aware: find first unanswered question
    const attempted = { ...sel };
    let startIdx = 0;
    for (let i = 0; i < questions.length; i++) {
      if (!attempted[questions[i].id]) {
        startIdx = i;
        break;
      }
    }
    setTestQuestions([...questions]);
    setTestAnswers({ ...sel });
    setTestResults({});
    setTestIdx(startIdx);
    setTestStartTime(Date.now());
    setTestDuration(Math.max(60, questions.length * 45));
    setTestTimeLeft(Math.max(60, questions.length * 45));
    setTestRunning(true);
    setTestPaused(false);
    setTestPhase("exam");
    setTestMode(true);
  };

  // Resume a previously-saved in-progress test from localStorage
  const resumeSavedTest = () => {
    try {
      const raw = localStorage.getItem("ssc_bank_test_progress");
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.questions) || d.questions.length === 0) return;
      setTestQuestions(d.questions);
      setTestAnswers(d.answers || {});
      setTestResults({});
      setTestIdx(d.idx || 0);
      setTestDuration(d.duration || Math.max(60, d.questions.length * 45));
      setTestTimeLeft(d.timeLeft ?? Math.max(60, d.questions.length * 45));
      setTestStartTime(Date.now());
      setTestRunning(true);
      setTestPaused(false);
      setTestPhase("exam");
      setTestMode(true);
      setResumeData(null);
    } catch {
      localStorage.removeItem("ssc_bank_test_progress");
    }
  };

  // autosave progress to localStorage every answer change + every 15s (refresh-safe)
  React.useEffect(() => {
    if (!testMode || testPhase !== "exam" || !testQuestions.length) return;
    const save = () => {
      try {
        localStorage.setItem(
          "ssc_bank_test_progress",
          JSON.stringify({
            questions: testQuestions,
            answers: testAnswers,
            idx: testIdx,
            timeLeft: testTimeLeft,
            duration: testDuration,
            savedAt: Date.now(),
          }),
        );
      } catch {}
    };
    save();
    const t = window.setInterval(save, 15000);
    return () => window.clearInterval(t);
  }, [testMode, testPhase, testQuestions, testAnswers, testIdx, testTimeLeft, testDuration]);

  // restore saved progress on mount
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem("ssc_bank_test_progress");
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.questions) && d.questions.length > 0) {
          setResumeData({
            questions: d.questions,
            idx: d.idx || 0,
            answers: d.answers || {},
            timeLeft: d.timeLeft ?? Math.max(60, d.questions.length * 45),
            duration: d.duration || Math.max(60, d.questions.length * 45),
          });
        }
      }
    } catch {}
  }, []);

  // test countdown timer
  React.useEffect(() => {
    if (!testRunning || testPhase !== "exam" || testPaused) return;
    if (testTimeLeft <= 0) {
      setTestRunning(false);
      submitBankTest();
      return;
    }
    const t = window.setTimeout(() => setTestTimeLeft((p) => p - 1), 1000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testRunning, testTimeLeft, testPhase, testPaused]);

  const testPick = (qid: string, key: string) => {
    setTestAnswers((p) => ({ ...p, [qid]: key }));
  };

  const testClear = (qid: string) => {
    setTestAnswers((p) => {
      const n = { ...p };
      delete n[qid];
      return n;
    });
  };

  const testNav = (i: number) => {
    if (i >= 0 && i < testQuestions.length) setTestIdx(i);
  };

  // submit test: score every answered question via /bank/attempt
  const submitBankTest = async () => {
    setTestRunning(false);
    const res: { [qid: string]: Attempt } = {};
    for (const q of testQuestions) {
      const ans = testAnswers[q.id];
      if (!ans) continue;
      try {
        const r = await fetchAuth(`${apiBase()}/bank/attempt`, {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: q.id, selectedOption: ans }),
        });
        const d: Attempt = await r.json();
        if (d && typeof d.correct === "boolean") res[q.id] = d;
      } catch {}
    }
    setTestResults(res);
    setTestPhase("results");
    localStorage.removeItem("ssc_bank_test_progress");
  };

  const exitTestMode = () => {
    setTestMode(false);
    setTestPhase("instructions");
    setTestRunning(false);
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  // ---- Test Mode sub-renderers ----
  const renderTestInstructions = () => (
    <div className="card p-6">
      <h2 className="text-xl font-bold">🎯 Test Mode</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {testQuestions.length} questions · ~{Math.round((testQuestions.length * 45) / 60)} min · answer key
        aur solutions har question ke baad milenge.
      </p>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-border p-3">
          <p className="font-semibold">📝 Question Type</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Bilingual (EN + हिंदी) PYQs with verified answers
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="font-semibold">⏱️ Timer</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Auto-submit at zero · progress saved automatically
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="font-semibold">↔️ Navigation</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Aage-piche jao, kisi bhi question par jump karo
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="font-semibold">📊 Results</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Full solutions + explanations (EN + हिंदी)
          </p>
        </div>
      </div>
      <button
        onClick={startQuestionBankTest}
        className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground hover:opacity-90"
      >
        Start Test →
      </button>
    </div>
  );

  const renderTestExam = () => {
    const q = testQuestions[testIdx];
    if (!q) return null;
    const answeredCount = Object.keys(testAnswers).length;
    return (
      <div className="card overflow-hidden">
        {/* top bar: progress + timer + controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-bold text-primary">Q {testIdx + 1}/{testQuestions.length}</span>
            <span className="text-xs text-muted-foreground">
              {answeredCount} answered
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTestPaused((p) => !p)}
              className="rounded-md border border-border px-3 py-1 text-xs font-semibold hover:bg-muted"
            >
              {testPaused ? "▶ Resume" : "⏸ Pause"}
            </button>
            <span className={`rounded-md px-3 py-1 font-mono text-sm font-bold ${testTimeLeft < 60 ? "bg-red-500/15 text-red-500" : "bg-primary/10 text-primary"}`}>
              ⏱ {fmtTime(testTimeLeft)}
            </span>
            <button
              onClick={submitBankTest}
              className="rounded-md bg-danger/15 px-3 py-1 text-xs font-bold text-danger hover:bg-danger/25"
            >
              Submit Test
            </button>
          </div>
        </div>

        {testPaused ? (
          <div className="p-10 text-center">
            <p className="text-lg font-bold">⏸ Test Paused</p>
            <p className="mt-1 text-sm text-muted-foreground">Progress save ho gaya hai — Resume dabao.</p>
            <button
              onClick={() => setTestPaused(false)}
              className="mt-4 rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground"
            >
              ▶ Resume Test
            </button>
          </div>
        ) : (
          <div className="p-5">
            {/* question text (bilingual) */}
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-sm font-medium">{q.questionText}</p>
              {q.questionTextHindi && (
                <p className="mt-2 border-t border-border pt-2 text-sm text-muted-foreground">
                  🇮🇳 {q.questionTextHindi}
                </p>
              )}
            </div>

            {/* options */}
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {q.options.map((o) => {
                const isSel = testAnswers[q.id] === o.key;
                const cls = isSel
                  ? "border-primary bg-primary/10 text-primary ring-1 ring-primary"
                  : "border-border hover:bg-muted";
                return (
                  <button
                    key={o.key}
                    onClick={() => testPick(q.id, o.key)}
                    className={`rounded-lg border px-3 py-3 text-left text-sm transition ${cls}`}
                  >
                    <span className="font-bold">{o.key})</span>{" "}
                    {showHi && (o as any).textHi ? (o as any).textHi : o.text}
                  </button>
                );
              })}
            </div>

            {/* clear answer */}
            {testAnswers[q.id] && (
              <button
                onClick={() => testClear(q.id)}
                className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
              >
                ✕ Clear Answer
              </button>
            )}

            {/* navigation */}
            <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
              <button
                onClick={() => testNav(testIdx - 1)}
                disabled={testIdx === 0}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-40"
              >
                ← Pichla
              </button>
              <div className="flex flex-wrap justify-center gap-1.5">
                {testQuestions.map((tq, i) => {
                  const st = testAnswers[tq.id] ? "bg-success text-success-foreground" : i === testIdx ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground";
                  return (
                    <button
                      key={tq.id}
                      onClick={() => testNav(i)}
                      className={`h-7 w-7 rounded-md text-xs font-bold ${st}`}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => testNav(testIdx + 1)}
                disabled={testIdx === testQuestions.length - 1}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-40"
              >
                Agla →
              </button>
            </div>

            {/* last question → submit CTA */}
            {testIdx === testQuestions.length - 1 && (
              <button
                onClick={submitBankTest}
                className="mt-4 w-full rounded-xl bg-success py-3 text-sm font-bold text-success-foreground hover:opacity-90"
              >
                ✅ Test Khatam — Submit & See Results
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderTestResults = () => {
    const total = testQuestions.length;
    const attempted = Object.keys(testResults).length;
    const correct = Object.values(testResults).filter((a) => a.correct).length;
    const wrong = attempted - correct;
    const skipped = total - attempted;
    const accPct = attempted ? Math.round((correct / attempted) * 100) : 0;
    return (
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">🎉 Test Result</h2>
          <div className="flex gap-2">
            <button
              onClick={exitTestMode}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
            >
              ← Question Bank par wapas
            </button>
            <button
              onClick={startQuestionBankTest}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              🔄 Retry Test
            </button>
          </div>
        </div>

        {/* summary cards */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center">
            <p className="text-2xl font-extrabold text-primary">{correct}/{total}</p>
            <p className="mt-1 text-xs text-muted-foreground">Correct</p>
          </div>
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-center">
            <p className="text-2xl font-extrabold text-red-500">{wrong}</p>
            <p className="mt-1 text-xs text-muted-foreground">Wrong</p>
          </div>
          <div className="rounded-xl border border-muted p-4 text-center">
            <p className="text-2xl font-extrabold text-muted-foreground">{skipped}</p>
            <p className="mt-1 text-xs text-muted-foreground">Skipped</p>
          </div>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center">
            <p className="text-2xl font-extrabold text-emerald-500">{accPct}%</p>
            <p className="mt-1 text-xs text-muted-foreground">Accuracy</p>
          </div>
        </div>

        {/* per-question review with solutions */}
        <div className="mt-6 space-y-4">
          {testQuestions.map((q, i) => {
            const a = testResults[q.id];
            const selKey = testAnswers[q.id];
            return (
              <div key={q.id} className="rounded-xl border border-border p-4">
                <div className="flex items-start gap-2">
                  <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold">{i + 1}</span>
                  <span className="text-sm font-medium">{q.questionText}</span>
                  {a && (
                    <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${a.correct ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>
                      {a.correct ? "✓ Correct" : "✗ Wrong"}
                    </span>
                  )}
                  {!a && (
                    <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
                      ⏭ Skipped
                    </span>
                  )}
                </div>
                {q.questionTextHindi && (
                  <p className="mt-1 text-xs text-muted-foreground">🇮🇳 {q.questionTextHindi}</p>
                )}
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {q.options.map((o) => {
                    const isSel = selKey === o.key;
                    const isCorrect = a && a.correctAnswer === o.key;
                    const isWrongSel = isSel && a && o.key !== a.correctAnswer;
                    const cls = isWrongSel
                      ? "border-red-500 bg-red-500/10 text-red-600"
                      : isCorrect
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-600"
                        : isSel
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border opacity-60";
                    return (
                      <div key={o.key} className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>
                        <span className="font-bold">{o.key})</span>{" "}
                        {showHi && (o as any).textHi ? (o as any).textHi : o.text}
                        {isCorrect && <span className="ml-1">✅</span>}
                        {isWrongSel && <span className="ml-1">❌</span>}
                      </div>
                    );
                  })}
                </div>
                {a && (a.explanation || a.explanationHindi) && (
                  <div className={`mt-3 rounded-lg border p-3 text-sm ${a.correct ? "border-success/40 bg-success/10" : "border-danger/40 bg-danger/10"}`}>
                    <p className="font-semibold">📖 Solution: {a.correctAnswer}</p>
                    {a.explanation && <p className="mt-1 whitespace-pre-line">EN: {a.explanation}</p>}
                    {a.explanationHindi && (
                      <p className="mt-1 whitespace-pre-line border-t border-border pt-1">
                        🇮🇳 {a.explanationHindi}
                      </p>
                    )}
                  </div>
                )}
                {!a && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Is question ko skip kiya gaya —{" "}
                    <button
                      onClick={() => {
                        setTestPhase("exam");
                        setTestIdx(i);
                        setTestRunning(true);
                      }}
                      className="font-semibold text-primary underline"
                    >
                      wapas try karo
                    </button>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
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
          <label className="text-xs font-medium text-muted-foreground">
            {examScoped ? "Exam (Fixed)" : "Exam"}
          </label>
          {examScoped ? (
            <div className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-primary">
              {exams.find((e) => e.id === examId)?.name || examId}
            </div>
          ) : (
            <select value={examId} onChange={(e) => setExamId(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">All Exams</option>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>{e.name} ({e.count})</option>
              ))}
            </select>
          )}
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
        {questions.length > 0 && !testMode && (
          <button
            onClick={startQuestionBankTest}
            className="rounded-lg bg-success py-2.5 px-5 text-sm font-semibold text-success-foreground hover:opacity-90"
          >
            🎯 Start Test Mode ({questions.length} Qs)
          </button>
        )}
      </div>

      {resumeData && !testMode && (
        <div className="mb-6 rounded-xl border border-amber-400/40 bg-amber-500/10 p-4">
          <p className="font-semibold text-amber-800 dark:text-amber-200">🔄 Incomplete test found</p>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
            {resumeData.questions.length} questions · {Object.keys(resumeData.answers).length} answered · {fmtTime(resumeData.timeLeft)} left
          </p>
          <button
            onClick={resumeSavedTest}
            className="mt-3 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-amber-50-foreground hover:opacity-90"
          >
            Resume Test
          </button>
        </div>
      )}

      {/* Test Mode UI */}
      {testMode && (
        <div className="mb-6">
          {testPhase === "instructions" && renderTestInstructions()}
          {testPhase === "exam" && renderTestExam()}
          {testPhase === "results" && renderTestResults()}
        </div>
      )}

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