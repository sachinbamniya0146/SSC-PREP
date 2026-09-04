"use client";

// Question Review Queue — admin UI for GET /bank/admin/questions/pending,
// POST /bank/admin/questions/:id/approve, POST /bank/admin/questions/:id/reject
// (backend/src/bank/bank.service.ts listPendingQuestions()/
// approvePendingQuestion()/rejectPendingQuestion()).
//
// NEW ("admin pura ek ek question ko dekh paye"): approve/reject endpoints
// already existed in pdf-ingestion.controller.ts, but every one of them is
// scoped to a PDF-ingestion batchId. Excel/CSV/JSON/Word bulk uploads
// (bank-upload.service.ts createQuestion()) never set a batchId, so a
// question uploaded without a Hindi translation — which goes
// isApproved:false / reviewStatus:'PENDING' by design — had NO review
// queue anywhere that could ever find it. It sat PENDING forever with no
// way for an admin to even see it, let alone fix or approve it. This page
// is a source-agnostic review queue: every PENDING question, regardless
// of how it got uploaded, with inline editing so a missing Hindi
// translation (the single most common reason a question lands here) can
// be filled in and approved in one action.

import * as React from "react";
import { useRouter } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";

type PendingOption = { key: string; text: string; textHi?: string };

type PendingQuestion = {
  id: string;
  questionText: string;
  questionTextHindi: string | null;
  options: PendingOption[];
  correctAnswer: string;
  explanation: string | null;
  explanationHindi: string | null;
  examName: string | null;
  subjectName: string | null;
  chapterName: string | null;
  topicName: string | null;
  year: number | null;
  shift: string | null;
  difficulty: string | null;
  createdAt: string;
};

export default function QuestionReviewPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = React.useState(false);

  const [items, setItems] = React.useState<PendingQuestion[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState("");
  const [expandedId, setExpandedId] = React.useState("");
  const [drafts, setDrafts] = React.useState<Record<string, Partial<PendingQuestion>>>({});
  const [actioningId, setActioningId] = React.useState("");
  const [actionMsg, setActionMsg] = React.useState("");

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem("ssc_user");
      const user = raw ? JSON.parse(raw) : null;
      const isAdmin = user?.role === "ADMIN" || user?.role === "MODERATOR";
      if (!isAdmin) {
        router.replace("/dashboard");
        return;
      }
    } catch {
      router.replace("/dashboard");
      return;
    }
    setAuthChecked(true);
  }, [router]);

  const loadPending = React.useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/questions/pending?take=50`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErr(d?.message || `HTTP ${r.status}`);
        return;
      }
      const d = await r.json();
      setItems(d.data || []);
      setTotal(d.total || 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Pending questions load nahi hue");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (authChecked) loadPending();
  }, [authChecked, loadPending]);

  function draftFor(q: PendingQuestion): Partial<PendingQuestion> {
    return drafts[q.id] ?? {};
  }

  function updateDraft(id: string, patch: Partial<PendingQuestion>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function updateOptionDraft(q: PendingQuestion, key: string, field: "text" | "textHi", value: string) {
    const currentOptions = draftFor(q).options ?? q.options;
    const nextOptions = currentOptions.map((o) => (o.key === key ? { ...o, [field]: value } : o));
    updateDraft(q.id, { options: nextOptions });
  }

  async function approve(q: PendingQuestion) {
    setActioningId(q.id);
    setActionMsg("");
    try {
      const d = draftFor(q);
      const r = await fetchAuth(`${API_BASE}/bank/admin/questions/${q.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionText: d.questionText,
          questionTextHindi: d.questionTextHindi,
          explanation: d.explanation,
          explanationHindi: d.explanationHindi,
          options: d.options,
          correctAnswer: d.correctAnswer,
        }),
      });
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        setActionMsg(errBody?.message || `Approve fail hua (HTTP ${r.status})`);
        return;
      }
      setActionMsg(`Question approve ho gaya — ab live hai students ke liye.`);
      setItems((prev) => prev.filter((x) => x.id !== q.id));
      setTotal((t) => Math.max(0, t - 1));
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Approve fail hua");
    } finally {
      setActioningId("");
    }
  }

  async function reject(q: PendingQuestion) {
    const reason = window.prompt("Reject karne ki wajah (optional):") ?? undefined;
    setActioningId(q.id);
    setActionMsg("");
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/questions/${q.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        setActionMsg(errBody?.message || `Reject fail hua (HTTP ${r.status})`);
        return;
      }
      setActionMsg(`Question reject ho gaya.`);
      setItems((prev) => prev.filter((x) => x.id !== q.id));
      setTotal((t) => Math.max(0, t - 1));
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Reject fail hua");
    } finally {
      setActioningId("");
    }
  }

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Checking access...</p>
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
          <span className="text-sm text-muted-foreground">✅ Question Review</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">✅ Question Review Queue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ye woh questions hain jo upload to ho gaye lekin abhi tak students ko nahi dikh rahe — zyadatar
          isliye kyunki Hindi translation khaali hai. Yahan se edit karke approve karein, ya reject karein.
        </p>

        {err && (
          <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{err}</p>
        )}
        {actionMsg && (
          <p className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            {actionMsg}
          </p>
        )}

        {loading ? (
          <p className="mt-6 text-sm text-muted-foreground">Loading...</p>
        ) : items.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            🎉 Koi pending question nahi hai — sab kuch review ho chuka hai.
          </div>
        ) : (
          <>
            <p className="mt-4 text-sm text-muted-foreground">{total} pending question(s)</p>
            <div className="mt-4 space-y-3">
              {items.map((q) => {
                const d = draftFor(q);
                const isExpanded = expandedId === q.id;
                const isBusy = actioningId === q.id;
                return (
                  <div key={q.id} className="card overflow-hidden p-0">
                    <button
                      onClick={() => setExpandedId(isExpanded ? "" : q.id)}
                      className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40"
                    >
                      <div>
                        <p className="text-sm font-medium">{q.questionText}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {q.examName && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                              🎓 {q.examName}
                            </span>
                          )}
                          {q.chapterName && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              📖 {q.chapterName}
                            </span>
                          )}
                          {q.topicName && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              🏷️ {q.topicName}
                            </span>
                          )}
                          {!q.questionTextHindi && (
                            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">
                              ⚠️ Hindi translation missing
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{isExpanded ? "▲" : "▼"}</span>
                    </button>

                    {isExpanded && (
                      <div className="space-y-3 border-t border-border bg-muted/20 px-4 py-4">
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground">Question (English)</label>
                          <textarea
                            defaultValue={q.questionText}
                            onChange={(e) => updateDraft(q.id, { questionText: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                            rows={2}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground">
                            Question (Hindi) — isse bharne se auto-approve ho sakta hai
                          </label>
                          <textarea
                            defaultValue={q.questionTextHindi ?? ""}
                            onChange={(e) => updateDraft(q.id, { questionTextHindi: e.target.value })}
                            placeholder="यहाँ हिंदी अनुवाद लिखें"
                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                            rows={2}
                          />
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {(d.options ?? q.options).map((o) => (
                            <div
                              key={o.key}
                              className={`rounded-lg border p-2 ${
                                (d.correctAnswer ?? q.correctAnswer) === o.key
                                  ? "border-success bg-success/5"
                                  : "border-border"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold">{o.key}</span>
                                <input
                                  defaultValue={o.text}
                                  onChange={(e) => updateOptionDraft(q, o.key, "text", e.target.value)}
                                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                                  placeholder="Option text"
                                />
                              </div>
                              <input
                                defaultValue={o.textHi ?? ""}
                                onChange={(e) => updateOptionDraft(q, o.key, "textHi", e.target.value)}
                                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs"
                                placeholder="विकल्प (Hindi)"
                              />
                              <button
                                onClick={() => updateDraft(q.id, { correctAnswer: o.key })}
                                className="mt-1 text-xs text-primary underline"
                              >
                                Mark as correct answer
                              </button>
                            </div>
                          ))}
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground">Explanation (Hindi)</label>
                          <textarea
                            defaultValue={q.explanationHindi ?? ""}
                            onChange={(e) => updateDraft(q.id, { explanationHindi: e.target.value })}
                            placeholder="यहाँ व्याख्या लिखें"
                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                            rows={2}
                          />
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => approve(q)}
                            disabled={isBusy}
                            className="btn bg-success px-4 py-2 text-sm text-white disabled:opacity-50"
                          >
                            {isBusy ? "..." : "✅ Approve (publish to students)"}
                          </button>
                          <button
                            onClick={() => reject(q)}
                            disabled={isBusy}
                            className="btn btn-outline border-danger px-4 py-2 text-sm text-danger disabled:opacity-50"
                          >
                            {isBusy ? "..." : "❌ Reject"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
