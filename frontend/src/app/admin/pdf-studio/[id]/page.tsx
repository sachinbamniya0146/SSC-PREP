"use client";

// Batch detail view for the PDF Ingestion Studio — sits under
// /admin/pdf-studio/[id]. Wires up the remaining pieces of
// backend/src/pdf-ingestion/pdf-ingestion.controller.ts that the main
// /admin/pdf-studio list page doesn't cover: chunk-level retry, per-question
// approve/reject, bulk-approve, and destructive batch rollback.

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";

type Chunk = {
  id: string;
  chunkIndex: number;
  startPage: number;
  endPage: number;
  status: "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED";
  errorMessage: string | null;
};

type BatchDetail = {
  id: string;
  status: string;
  totalChunks: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  sourcePdf: { filename: string; bookName: string | null; publisher: string | null; year: number | null };
  chunks: Chunk[];
  questions: { id: string; isApproved: boolean; answerVerificationStatus: string }[];
};

type QuestionRow = {
  id: string;
  questionText: string;
  questionTextHindi: string | null;
  correctAnswer: string;
  isApproved: boolean;
  reviewStatus: string | null;
  answerVerificationStatus: string;
  aiConfidenceScore: number | null;
  chapter?: { name: string } | null;
  topic?: { name: string } | null;
  exam?: { name: string } | null;
};

const CHUNK_BADGE: Record<string, string> = {
  PENDING: "bg-muted text-muted-foreground border-border",
  PROCESSING: "bg-info/15 text-info border-info/30",
  SUCCESS: "bg-success/15 text-success border-success/30",
  FAILED: "bg-danger/15 text-danger border-danger/30",
};

export default function BatchDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const batchId = params?.id as string;

  const [authChecked, setAuthChecked] = React.useState(false);
  const [batch, setBatch] = React.useState<BatchDetail | null>(null);
  const [questions, setQuestions] = React.useState<QuestionRow[]>([]);
  const [qTotal, setQTotal] = React.useState(0);
  const [statusFilter, setStatusFilter] = React.useState<string>("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string>("");
  const [msg, setMsg] = React.useState("");
  const [err, setErr] = React.useState("");

  const headers = React.useCallback(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") : "";
    return { Authorization: `Bearer ${t || ""}` };
  }, []);

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

  const load = React.useCallback(async () => {
    if (!batchId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: "1", limit: "50" });
      if (statusFilter) qs.set("status", statusFilter);
      const [bRes, qRes] = await Promise.all([
        fetchAuth(`${API_BASE}/admin/pdf-ingestion/batches/${batchId}`, { headers: headers() }),
        fetchAuth(`${API_BASE}/admin/pdf-ingestion/batches/${batchId}/questions?${qs.toString()}`, { headers: headers() }),
      ]);
      if (bRes.ok) setBatch(await bRes.json());
      if (qRes.ok) {
        const d = await qRes.json();
        setQuestions(d.questions || []);
        setQTotal(d.total || 0);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [batchId, statusFilter, headers]);

  React.useEffect(() => {
    if (!authChecked) return;
    load();
  }, [authChecked, load]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const retryChunk = async (chunkId: string) => {
    setBusy(chunkId);
    setErr("");
    try {
      const r = await fetchAuth(`${API_BASE}/admin/pdf-ingestion/chunks/${chunkId}/retry`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ chunkId }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErr(d?.message || "Retry fail ho gaya");
      } else {
        setMsg("Chunk dobara queue mein daal diya gaya.");
        load();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Retry fail ho gaya");
    } finally {
      setBusy("");
    }
  };

  const approveOne = async (id: string) => {
    setBusy(id);
    setErr("");
    try {
      const r = await fetchAuth(`${API_BASE}/admin/pdf-ingestion/questions/approve`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Common case: bilingual/verification publish gate (v3 §6.3, v5 §37.1)
        // blocked it — surface the backend's exact reason instead of a
        // generic failure so the admin knows what to fix (Hindi text /
        // verification status) before retrying.
        setErr(d?.message || "Approve fail ho gaya");
        return;
      }
      setMsg("Question approve ho gaya.");
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Approve fail ho gaya");
    } finally {
      setBusy("");
    }
  };

  const rejectOne = async (id: string) => {
    const reason = prompt("Reject karne ki wajah likho:");
    if (!reason) return;
    setBusy(id);
    setErr("");
    try {
      const r = await fetchAuth(`${API_BASE}/admin/pdf-ingestion/questions/reject`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: id, reason }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErr(d?.message || "Reject fail ho gaya");
        return;
      }
      setMsg("Question reject kar diya gaya.");
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Reject fail ho gaya");
    } finally {
      setBusy("");
    }
  };

  const bulkApprove = async () => {
    if (selected.size === 0) return;
    const ok = confirm(`${selected.size} questions bulk-approve karne hain? Sirf VERIFIED_* + bilingual-complete wale hi approve honge, baaki queue mein reh jaayenge.`);
    if (!ok) return;
    setBusy("bulk");
    setErr("");
    try {
      const r = await fetchAuth(`${API_BASE}/admin/pdf-ingestion/questions/bulk-approve`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ questionIds: Array.from(selected) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(d?.message || "Bulk approve fail ho gaya");
        return;
      }
      setMsg(`✅ ${d.approved} approved, ${d.skippedUnverified} skip ho gaye (unverified/bilingual incomplete).`);
      setSelected(new Set());
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Bulk approve fail ho gaya");
    } finally {
      setBusy("");
    }
  };

  const rollback = async () => {
    if (!batch) return;
    const ok = confirm(
      `⚠️ Poora batch rollback karna hai? Iske ${batch.questions.length} questions deactivate ho jaayenge aur search index se hat jaayenge. Yeh undo nahi ho sakta.`,
    );
    if (!ok) return;
    setBusy("rollback");
    setErr("");
    try {
      const r = await fetchAuth(`${API_BASE}/admin/pdf-ingestion/batches/${batchId}/rollback`, {
        method: "POST",
        headers: headers(),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(d?.message || "Rollback fail ho gaya");
        return;
      }
      setMsg(`Batch rollback ho gaya — ${d.rolledBack} questions deactivate kiye gaye.`);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Rollback fail ho gaya");
    } finally {
      setBusy("");
    }
  };

  if (!authChecked || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading batch...</p>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
        <p className="text-muted-foreground">Batch nahi mila.</p>
        <a href="/admin/pdf-studio" className="btn btn-outline">← Batches par wapas jao</a>
      </div>
    );
  }

  const failedChunks = batch.chunks.filter((c) => c.status === "FAILED");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <a href="/admin/pdf-studio" className="text-lg font-bold">← <span className="text-primary">SSC</span>PrepHub</a>
          <span className="text-sm text-muted-foreground">Batch Detail</span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{batch.sourcePdf?.bookName || batch.sourcePdf?.filename}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {batch.sourcePdf?.publisher || ""} {batch.sourcePdf?.year ? `· ${batch.sourcePdf.year}` : ""} · Status: {batch.status}
            </p>
          </div>
          <button onClick={rollback} disabled={busy === "rollback"} className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-2 text-sm font-bold text-danger hover:bg-danger/20 disabled:opacity-60">
            🗑 Rollback Batch
          </button>
        </div>

        {err && <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{err}</p>}
        {msg && <p className="mt-4 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">{msg}</p>}

        {/* Chunks */}
        <div className="mt-8">
          <h2 className="font-bold">Chunks ({batch.chunks.length})</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {batch.chunks.map((c) => (
              <div key={c.id} className="card flex items-center justify-between p-3 text-xs">
                <div>
                  <p className="font-semibold">Pages {c.startPage}–{c.endPage}</p>
                  {c.errorMessage && <p className="mt-1 line-clamp-1 text-danger">{c.errorMessage}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-1 font-bold ${CHUNK_BADGE[c.status]}`}>{c.status}</span>
                  {c.status === "FAILED" && (
                    <button onClick={() => retryChunk(c.id)} disabled={busy === c.id} className="btn btn-outline px-2 py-1 text-xs disabled:opacity-60">
                      {busy === c.id ? "..." : "Retry"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {failedChunks.length > 0 && (
            <p className="mt-2 text-xs text-danger">{failedChunks.length} chunk(s) fail hue — inhe individually retry karo.</p>
          )}
        </div>

        {/* Questions review queue */}
        <div className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold">Extracted Questions ({qTotal})</h2>
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
              >
                <option value="">Sab</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="VERIFIED">Verified</option>
              </select>
              <button
                onClick={bulkApprove}
                disabled={selected.size === 0 || busy === "bulk"}
                className="btn btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
              >
                {busy === "bulk" ? "..." : `Bulk Approve Selected (${selected.size})`}
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {questions.length === 0 && (
              <p className="card p-6 text-center text-sm text-muted-foreground">Is batch se abhi tak koi question extract nahi hua (ya sab filter ho gaye).</p>
            )}
            {questions.map((q) => (
              <div key={q.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(q.id)}
                    onChange={() => toggleSelect(q.id)}
                    className="mt-1.5 h-4 w-4"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{q.questionText}</p>
                    {!q.questionTextHindi && (
                      <p className="mt-1 text-[11px] font-semibold text-warning">⚠️ Hindi translation missing — publish gate (v3 §6.3) approve hone nahi dega</p>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {q.exam?.name || "—"} {q.chapter?.name ? `· ${q.chapter.name}` : ""} · Ans: {q.correctAnswer}
                      {" · "}
                      <span className={q.answerVerificationStatus?.startsWith("VERIFIED") ? "text-success" : "text-warning"}>
                        {q.answerVerificationStatus}
                      </span>
                      {q.aiConfidenceScore != null && ` · AI confidence: ${Math.round(q.aiConfidenceScore * 100)}%`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                    <button
                      onClick={() => approveOne(q.id)}
                      disabled={busy === q.id || q.isApproved}
                      className="rounded-lg border border-success/40 bg-success/10 px-3 py-1.5 text-xs font-bold text-success hover:bg-success/20 disabled:opacity-50"
                    >
                      {q.isApproved ? "✅ Approved" : busy === q.id ? "..." : "Approve"}
                    </button>
                    <button
                      onClick={() => rejectOne(q.id)}
                      disabled={busy === q.id || q.reviewStatus === "REJECTED"}
                      className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-bold text-danger hover:bg-danger/20 disabled:opacity-50"
                    >
                      {q.reviewStatus === "REJECTED" ? "Rejected" : "Reject"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
