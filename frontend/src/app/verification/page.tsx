"use client";

import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";

type VerifStats = {
  stats: Record<string, number>;
  total: number;
};

type QRow = {
  id: string;
  questionText: string;
  answerVerificationStatus: string;
  lastVerifiedAt?: string | null;
  verificationEvidence?: string | null;
  reviewStatus?: string | null;
  aiConfidenceScore?: number | null;
};

const STATUS_META: Record<string, { label: string; cls: string; badge: string }> = {
  VERIFIED_OFFICIAL: {
    label: "Matches SSC's official answer key",
    cls: "bg-success/15 text-success border-success/30",
    badge: "✅ VERIFIED · OFFICIAL",
  },
  VERIFIED_MULTI_SOURCE: {
    label: "Cross-verified from 2+ sources",
    cls: "bg-info/15 text-info border-info/30",
    badge: "🔵 VERIFIED · MULTI-SOURCE",
  },
  VERIFIED_COMPUTED: {
    label: "Answer re-derived independently",
    cls: "bg-warning/15 text-warning border-warning/30",
    badge: "🟡 VERIFIED · COMPUTED",
  },
  UNVERIFIED_SINGLE_SOURCE: {
    label: "Single source — pending review",
    cls: "bg-muted text-muted-foreground border-border",
    badge: "⚪ UNVERIFIED",
  },
  DISPUTED: {
    label: "Sources disagree — needs review",
    cls: "bg-danger/15 text-danger border-danger/30",
    badge: "🔴 DISPUTED",
  },
};

export default function VerificationPage() {
  const [stats, setStats] = React.useState<VerifStats | null>(null);
  const [questions, setQuestions] = React.useState<QRow[]>([]);
  const [user, setUser] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  // NEW ("admin ko vo question ki list direct mil jani chahiye jisme Hindi
  // translation nahi hai") — real list behind GET /bank/admin/questions/missing-hindi
  const [missingHindi, setMissingHindi] = React.useState<{
    total: number;
    totalPages: number;
    page: number;
    questions: Array<{ id: string; preview: string; examName: string | null; chapterName: string | null; year: number | null; shift: string | null }>;
  } | null>(null);
  const [missingHindiPage, setMissingHindiPage] = React.useState(1);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState("");
  const [savingId, setSavingId] = React.useState<string | null>(null);

  const saveHindi = async (qid: string) => {
    if (!editText.trim()) { alert("Hindi text khali nahi ho sakta"); return; }
    setSavingId(qid);
    try {
      const r = await fetchAuth(`${apiBase}/bank/admin/questions/${qid}/translation`, {
        method: "PUT",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ questionTextHindi: editText.trim() }),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.message || "Save failed"); return; }
      setEditingId(null);
      setEditText("");
      // remove the fixed row locally + refresh totals
      setMissingHindi((prev) => prev && { ...prev, total: prev.total - 1, questions: prev.questions.filter((q) => q.id !== qid) });
      if (j.nowPublished) alert("✅ Saved — this question is now published (live for students).");
    } catch (e) { console.error(e); alert("Save failed"); }
    finally { setSavingId(null); }
  };

  const apiBase = API_BASE;
  const headers = () => {
    const t = localStorage.getItem("ssc_access_token");
    return { Authorization: `Bearer ${t}` };
  };

  React.useEffect(() => {
    const raw = localStorage.getItem("ssc_user");
    if (raw) { try { setUser(JSON.parse(raw)); } catch {} }
    loadAll();
  }, []);

  React.useEffect(() => {
    fetchAuth(`${apiBase}/bank/admin/questions/missing-hindi?page=${missingHindiPage}&limit=25`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMissingHindi(d))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingHindiPage]);

  const loadAll = async () => {
    try {
      const [s, q] = await Promise.all([
        fetchAuth(`${apiBase}/bank/verification-stats`, { headers: headers() }).then(r => r.ok ? r.json() : null),
        fetchAuth(`${apiBase}/bank/questions?take=20`, { headers: headers() }).then(r => r.ok ? r.json() : null),
      ]);
      setStats(s);
      setQuestions(q?.data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const updateStatus = async (qid: string, status: string) => {
    try {
      const r = await fetchAuth(`${apiBase}/bank/questions/${qid}/verify`, {
        method: "PUT",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (r.ok) loadAll();
    } catch (e) { console.error(e); }
  };

  // v1 §7.4 — human review gate control (admin only)
  const setReviewStatus = async (qid: string, reviewStatus: string) => {
    try {
      const r = await fetchAuth(`${apiBase}/admin/pdf-ingestion/questions/${qid}/review-status`, {
        method: "PUT",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ reviewStatus }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.message || "Review status update failed"); }
      loadAll();
    } catch (e) { console.error(e); }
  };

  // v5 §37.2 — deterministic re-derivation (VERIFIED_COMPUTED), admin-only
  const rederive = async (qid: string) => {
    try {
      const r = await fetchAuth(`${apiBase}/admin/solver/recompute/${qid}`, {
        method: "POST",
        headers: headers(),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.message || "Re-derivation failed"); return; }
      if (j.solved && j.matchesStored) {
        alert(`✅ Verified by computation — option ${j.optionKey} (${j.optionText})\n\n${j.evidence}`);
      } else if (j.solved && !j.matchesStored) {
        alert(`⚠️ Computation disagrees!\n\nComputed: option ${j.computedOptionKey} (${j.computedText})\nStored:  option ${j.storedAnswerKey} (${j.storedAnswerText})\n\n${j.warning}`);
      } else {
        alert(`Could not re-derive this question deterministically (${j.reason}).\nNo status change was made.`);
      }
      loadAll();
    } catch (e) { console.error(e); }
  };

  const rederiveBatch = async () => {
    const ok = confirm("Run batch re-derivation on unverified/disputed approved questions (max 200)? Verified ones are skipped.");
    if (!ok) return;
    try {
      const r = await fetchAuth(`${apiBase}/admin/solver/recompute-batch`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 200 }),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.message || "Batch failed"); return; }
      alert(`Batch done: ${j.processed} processed · ${j.verified} verified by computation · ${j.mismatch} mismatch · ${j.unsolved} unsolved`);
      loadAll();
    } catch (e) { console.error(e); }
  };

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-muted-foreground">Loading verification data...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">← <span className="text-primary">SSC</span>PrepHub</a>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Accuracy Dashboard</span>
            <a href="/dashboard" className="btn btn-outline">Dashboard</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl font-bold">✅ Answer Accuracy Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Zero-error promise: every published question is verified against official keys or cross-checked sources.
        </p>

        {/* Stats cards */}
        {stats && (
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {Object.entries(stats.stats).map(([status, count]) => {
              const meta = STATUS_META[status] || STATUS_META.UNVERIFIED_SINGLE_SOURCE;
              return (
                <div key={status} className={`card border p-5 ${meta.cls}`}>
                  <p className="text-xs font-semibold">{meta.badge}</p>
                  <p className="mt-2 text-3xl font-extrabold">{count}</p>
                  <p className="mt-1 text-xs opacity-80">{meta.label}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* NEW: Missing Hindi Translation list — direct actionable list, not
            just a count, so an admin can click straight through and fix
            each row (v3 §6.3 bilingual gate means these are all currently
            unpublished — this is exactly the "students ko question dikhna
            band" backlog). */}
        {missingHindi && missingHindi.total > 0 && (
          <div className="mt-10 rounded-xl border border-warning/30 bg-warning/5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold">
                🈳 Missing Hindi Translation <span className="text-warning">({missingHindi.total})</span>
              </h2>
              <p className="text-xs text-muted-foreground">
                These questions were created but stay UNPUBLISHED until questionTextHindi is added.
              </p>
            </div>
            <div className="mt-4 divide-y divide-border">
              {missingHindi.questions.map((q) => (
                <div key={q.id} className="py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate">{q.preview}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {q.examName || "—"} · {q.chapterName || "—"}
                        {q.year ? ` · ${q.year}` : ""}{q.shift ? ` · ${q.shift}` : ""}
                      </p>
                    </div>
                    {editingId !== q.id && (
                      <button
                        onClick={() => { setEditingId(q.id); setEditText(""); }}
                        className="shrink-0 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20"
                      >
                        Add Hindi →
                      </button>
                    )}
                  </div>
                  {editingId === q.id && (
                    <div className="mt-2 rounded-lg border border-border bg-card p-3">
                      <textarea
                        autoFocus
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        placeholder="प्रश्न का हिंदी अनुवाद यहाँ लिखें..."
                        className="w-full rounded-md border border-border bg-background p-2 text-sm font-hindi"
                        rows={3}
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          disabled={savingId === q.id}
                          onClick={() => saveHindi(q.id)}
                          className="btn btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
                        >
                          {savingId === q.id ? "Saving…" : "Save & Publish"}
                        </button>
                        <button
                          onClick={() => { setEditingId(null); setEditText(""); }}
                          className="btn btn-outline px-3 py-1.5 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {missingHindi.totalPages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-3 text-xs">
                <button
                  disabled={missingHindiPage <= 1}
                  onClick={() => setMissingHindiPage((p) => Math.max(1, p - 1))}
                  className="btn btn-outline px-3 py-1 disabled:opacity-40"
                >
                  ← Prev
                </button>
                <span className="text-muted-foreground">Page {missingHindi.page} / {missingHindi.totalPages}</span>
                <button
                  disabled={missingHindiPage >= missingHindi.totalPages}
                  onClick={() => setMissingHindiPage((p) => Math.min(missingHindi.totalPages, p + 1))}
                  className="btn btn-outline px-3 py-1 disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )}

        {/* Questions list with badges */}
        <div className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Recent Questions &amp; Verification Status</h2>
            <span className="flex items-center gap-3 text-xs text-muted-foreground">
              {user?.role === "ADMIN" && (
                <button onClick={rederiveBatch} className="btn btn-outline px-3 py-1.5 text-xs">
                  🛠 Batch re-derive (max 200)
                </button>
              )}
              {questions.length} shown
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {questions.length === 0 && (
              <p className="card p-6 text-center text-sm text-muted-foreground">No questions found.</p>
            )}
            {questions.map((q) => {
              const meta = STATUS_META[q.answerVerificationStatus] || STATUS_META.UNVERIFIED_SINGLE_SOURCE;
              return (
                <div key={q.id} className="card flex flex-wrap items-center justify-between gap-3 p-5">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium">{q.questionText}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {meta.badge} · Last verified: {q.lastVerifiedAt ? new Date(q.lastVerifiedAt).toLocaleDateString() : "Never"}
                      {q.reviewStatus && q.reviewStatus !== "APPROVED" && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                          Review: {q.reviewStatus.replace(/_/g, " ")}
                        </span>
                      )}
                      {q.aiConfidenceScore != null && (
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          AI confidence: {Math.round(q.aiConfidenceScore * 100)}%
                        </span>
                      )}
                    </p>
                    {q.verificationEvidence && (
                      <p className="mt-1 text-[11px] font-mono text-warning/80 line-clamp-2">{q.verificationEvidence}</p>
                    )}
                  </div>
                  {user?.role === "ADMIN" ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={q.reviewStatus || "APPROVED"}
                        onChange={e => setReviewStatus(q.id, e.target.value)}
                        className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold"
                        title="v1 §7.4 — human review gate: AI_DRAFT → IN_REVIEW → APPROVED / REJECTED"
                      >
                        {["AI_DRAFT", "IN_REVIEW", "APPROVED", "REJECTED"].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <select
                        value={q.answerVerificationStatus}
                        onChange={e => updateStatus(q.id, e.target.value)}
                        className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold"
                      >
                        {Object.keys(STATUS_META).map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button
                        onClick={() => rederive(q.id)}
                        className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-bold text-warning hover:bg-warning/20"
                        title="Deterministically re-derive the answer (never LLM-guessed)"
                      >
                        🛠 Re-derive
                      </button>
                    </div>
                  ) : (
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${meta.cls}`}>
                      {q.answerVerificationStatus.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Trust section */}
        <div className="card mt-10 border-primary/30 bg-primary/5 p-6">
          <h2 className="font-bold text-primary">🛡️ Our Accuracy Promise</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>• Official SSC answer keys are always the ground truth (VERIFIED_OFFICIAL)</li>
            <li>• Questions without official keys are cross-verified from 2+ independent sources</li>
            <li>• Quant &amp; Reasoning answers are independently re-computed</li>
            <li>• Disputed answers never go live — they route to priority admin review</li>
            <li>• Every correction is logged with full audit history</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
