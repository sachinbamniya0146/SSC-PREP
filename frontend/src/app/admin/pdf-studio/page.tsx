"use client";

// PDF Ingestion Studio — admin UI for the PDF → question extraction pipeline.
//
// SESSION 13 CRITICAL FIX: the backend (backend/src/pdf-ingestion/pdf-ingestion.controller.ts,
// @Controller('admin/pdf-ingestion')) already had 15 working endpoints — upload,
// batch listing, chunk retry, translation queue, pipeline stats — but there was
// ZERO frontend page for any of it. An admin literally could not upload a PDF
// or review extracted questions through the UI; the only "add questions" path
// visible on the site was the manual Excel/CSV upload on /admin. This page (+
// the batch detail sub-route at /admin/pdf-studio/[id]) wires up the whole
// pipeline: upload → batch progress → per-question review → translation queue.

import * as React from "react";
import { useRouter } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";

type Batch = {
  id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "PARTIAL";
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  pendingChunks: number;
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  sourcePdf: { filename: string; bookName: string | null };
};

type BatchesResponse = {
  data: Batch[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

type PipelineStats = {
  batches: Record<string, number>;
  chunks: Record<string, number>;
  questions: Record<string, number>;
  totalSources: number;
};

type MetaOption = { id: string; name: string };

type TranslationRow = {
  id: string;
  questionText: string;
  chapter: string | null;
  exam: string | null;
  createdAt: string;
};

const STATUS_BADGE: Record<string, string> = {
  QUEUED: "bg-muted text-muted-foreground border-border",
  PROCESSING: "bg-info/15 text-info border-info/30",
  COMPLETED: "bg-success/15 text-success border-success/30",
  FAILED: "bg-danger/15 text-danger border-danger/30",
  PARTIAL: "bg-warning/15 text-warning border-warning/30",
};

export default function PdfStudioPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = React.useState(false);
  const [tab, setTab] = React.useState<"batches" | "translation">("batches");

  // upload form
  const [file, setFile] = React.useState<File | null>(null);
  const [subjects, setSubjects] = React.useState<MetaOption[]>([]);
  const [exams, setExams] = React.useState<MetaOption[]>([]);
  const [subjectId, setSubjectId] = React.useState("");
  const [examId, setExamId] = React.useState("");
  const [bookName, setBookName] = React.useState("");
  const [publisher, setPublisher] = React.useState("");
  const [year, setYear] = React.useState("");
  const [shift, setShift] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [uploadMsg, setUploadMsg] = React.useState("");
  const [uploadErr, setUploadErr] = React.useState("");

  // batches list
  const [batches, setBatches] = React.useState<Batch[]>([]);
  const [batchesTotal, setBatchesTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [statusFilter, setStatusFilter] = React.useState("");
  const [stats, setStats] = React.useState<PipelineStats | null>(null);
  const [loading, setLoading] = React.useState(true);

  // translation tab
  const [translationRows, setTranslationRows] = React.useState<TranslationRow[]>([]);
  const [translationTotal, setTranslationTotal] = React.useState(0);
  const [translationStats, setTranslationStats] = React.useState<{ byExam: any[]; bySubject: any[] } | null>(null);

  const headers = React.useCallback(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") : "";
    return { Authorization: `Bearer ${t || ""}` };
  }, []);

  // Role guard — mirrors the isAdmin check already used on /dashboard
  // (frontend/src/app/dashboard/page.tsx). No such guard existed on ANY admin
  // page before this session, so a non-admin who guessed the URL saw the
  // full page shell (though every API call would still 403 server-side).
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

  const loadMeta = React.useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/bank/meta`);
      const d = await r.json();
      setSubjects(Array.isArray(d?.subjects) ? d.subjects.map((s: any) => ({ id: s.id, name: s.name })) : []);
      setExams(Array.isArray(d?.exams) ? d.exams.map((e: any) => ({ id: e.id, name: e.name })) : []);
    } catch {
      /* non-fatal — dropdowns just stay empty, fields are optional anyway */
    }
  }, []);

  const loadBatches = React.useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: "20" });
      if (statusFilter) qs.set("status", statusFilter);
      const [bRes, sRes] = await Promise.all([
        fetchAuth(`${API_BASE}/admin/pdf-ingestion/batches?${qs.toString()}`, { headers: headers() }),
        fetchAuth(`${API_BASE}/admin/pdf-ingestion/stats`, { headers: headers() }),
      ]);
      if (bRes.ok) {
        const b: BatchesResponse = await bRes.json();
        setBatches(b.data);
        setBatchesTotal(b.total);
      }
      if (sRes.ok) setStats(await sRes.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, headers]);

  const loadTranslation = React.useCallback(async () => {
    try {
      const [qRes, sRes] = await Promise.all([
        fetchAuth(`${API_BASE}/admin/pdf-ingestion/translation-queue?take=25`, { headers: headers() }),
        fetchAuth(`${API_BASE}/admin/pdf-ingestion/translation-stats`, { headers: headers() }),
      ]);
      if (qRes.ok) {
        const d = await qRes.json();
        setTranslationRows(d.data || []);
        setTranslationTotal(d.total || 0);
      }
      if (sRes.ok) setTranslationStats(await sRes.json());
    } catch (e) {
      console.error(e);
    }
  }, [headers]);

  React.useEffect(() => {
    if (!authChecked) return;
    loadMeta();
  }, [authChecked, loadMeta]);

  React.useEffect(() => {
    if (!authChecked) return;
    if (tab === "batches") loadBatches();
    else loadTranslation();
  }, [authChecked, tab, loadBatches, loadTranslation]);

  const submitUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadErr("");
    setUploadMsg("");
    if (!file) {
      setUploadErr("PDF file chuniye pehle.");
      return;
    }
    if (!subjectId) {
      setUploadErr("Subject zaroori hai — backend UploadPdfDto isse maangta hai.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("subjectId", subjectId);
      if (examId) form.append("examId", examId);
      if (bookName) form.append("bookName", bookName);
      if (publisher) form.append("publisher", publisher);
      if (year) form.append("year", year);
      if (shift) form.append("shift", shift);

      const r = await fetchAuth(`${API_BASE}/admin/pdf-ingestion/upload-file`, {
        method: "POST",
        headers: headers(), // NOTE: no Content-Type here on purpose — the
        // browser must set its own multipart boundary for FormData. Setting
        // "Content-Type: application/json" (the default in api()) would
        // break this upload, which is exactly why fetchAuth + explicit
        // headers() is used here instead of the api() helper.
        body: form,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setUploadErr(d?.message || `Upload fail ho gaya (HTTP ${r.status})`);
        return;
      }
      setUploadMsg(`✅ Upload ho gaya — batch #${d?.batch?.id?.slice(0, 8) || "?"} banaya, ${d?.batch?.totalChunks ?? "?"} chunks queue mein daale gaye.`);
      setFile(null);
      const pdfFileInput = document.getElementById("pdf-file-input") as HTMLInputElement | null;
      if (pdfFileInput) pdfFileInput.value = "";
      loadBatches();
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : "Upload fail ho gaya.");
    } finally {
      setUploading(false);
    }
  };

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
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub
          </a>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">📄 PDF Ingestion Studio</span>
            <a href="/verification" className="btn btn-outline">Verification</a>
            <a href="/admin" className="btn btn-outline">Admin Panel</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-bold">📄 PDF Ingestion Studio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          PDF upload karo → auto-extraction chalega → questions yahan review karke approve karo.
        </p>

        {/* Pipeline stats overview */}
        {stats && (
          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            <div className="card p-4">
              <p className="text-xs text-muted-foreground">Total PDFs</p>
              <p className="mt-1 text-2xl font-bold">{stats.totalSources}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-muted-foreground">Batches Processing</p>
              <p className="mt-1 text-2xl font-bold text-info">{stats.batches.PROCESSING || 0}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-muted-foreground">Chunks Failed</p>
              <p className="mt-1 text-2xl font-bold text-danger">{stats.chunks.FAILED || 0}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-muted-foreground">Awaiting Review</p>
              <p className="mt-1 text-2xl font-bold text-warning">{stats.questions.UNVERIFIED_SINGLE_SOURCE || 0}</p>
            </div>
          </div>
        )}

        {/* Upload form */}
        <form onSubmit={submitUpload} className="card mt-8 p-6">
          <h2 className="font-bold">⬆️ Naya PDF Upload Karo</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            500MB tak PDF chalega. Upload ke baad automatically 25-page chunks mein OCR/extraction queue mein lagta hai.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-muted-foreground">PDF File *</label>
              <input
                id="pdf-file-input"
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-4 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Subject *</label>
              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-4 py-2 text-sm"
              >
                <option value="">— Select —</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Exam</label>
              <select
                value={examId}
                onChange={(e) => setExamId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-4 py-2 text-sm"
              >
                <option value="">— Select —</option>
                {exams.map((ex) => (
                  <option key={ex.id} value={ex.id}>{ex.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Book Name</label>
              <input value={bookName} onChange={(e) => setBookName(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-4 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Publisher</label>
              <input value={publisher} onChange={(e) => setPublisher(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-4 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Year</label>
              <input type="number" min={2000} max={2030} value={year} onChange={(e) => setYear(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-4 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Shift</label>
              <input value={shift} onChange={(e) => setShift(e.target.value)} placeholder="e.g. Shift 1" className="mt-1 w-full rounded-lg border border-border bg-background px-4 py-2 text-sm" />
            </div>
          </div>

          {uploadErr && <p className="mt-3 text-sm text-danger">{uploadErr}</p>}
          {uploadMsg && <p className="mt-3 text-sm text-success">{uploadMsg}</p>}

          <button type="submit" disabled={uploading} className="btn btn-primary mt-4 disabled:opacity-60">
            {uploading ? "Uploading..." : "Upload & Extraction Shuru Karo"}
          </button>
        </form>

        {/* Tabs */}
        <div className="mt-10 flex gap-2 border-b border-border">
          <button
            onClick={() => setTab("batches")}
            className={`px-4 py-2 text-sm font-semibold ${tab === "batches" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
          >
            Batches ({batchesTotal})
          </button>
          <button
            onClick={() => setTab("translation")}
            className={`px-4 py-2 text-sm font-semibold ${tab === "translation" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
          >
            Translation Queue ({translationTotal})
          </button>
        </div>

        {tab === "batches" && (
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                className="rounded-lg border border-border bg-background px-4 py-2 text-sm"
              >
                <option value="">Sab Status</option>
                {["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "PARTIAL"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {loading ? (
              <p className="mt-6 text-sm text-muted-foreground">Loading batches...</p>
            ) : batches.length === 0 ? (
              <p className="card mt-6 p-6 text-center text-sm text-muted-foreground">Abhi tak koi batch nahi hai. Upar se PDF upload karke shuru karo.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {batches.map((b) => (
                  <a
                    key={b.id}
                    href={`/admin/pdf-studio/${b.id}`}
                    className="card flex flex-wrap items-center justify-between gap-3 p-5 hover:border-primary/40 transition"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{b.sourcePdf?.bookName || b.sourcePdf?.filename}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {b.completedChunks}/{b.totalChunks} chunks done
                        {b.failedChunks > 0 && <span className="ml-2 text-danger">· {b.failedChunks} failed</span>}
                        {" · "}
                        {new Date(b.createdAt).toLocaleDateString()}
                      </p>
                      <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${b.progress}%` }} />
                      </div>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${STATUS_BADGE[b.status] || ""}`}>
                      {b.status} · {b.progress}%
                    </span>
                  </a>
                ))}
              </div>
            )}

            {batchesTotal > 20 && (
              <div className="mt-4 flex items-center justify-center gap-3 text-sm">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn btn-outline disabled:opacity-50">Prev</button>
                <span className="text-muted-foreground">Page {page}</span>
                <button disabled={page * 20 >= batchesTotal} onClick={() => setPage((p) => p + 1)} className="btn btn-outline disabled:opacity-50">Next</button>
              </div>
            )}
          </div>
        )}

        {tab === "translation" && (
          <div className="mt-6">
            {translationStats && translationStats.byExam?.length > 0 && (
              <div className="card mb-6 overflow-x-auto p-5">
                <h3 className="text-sm font-bold">Exam-wise Hindi Coverage</h3>
                <table className="mt-3 w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="pb-2">Exam</th>
                      <th className="pb-2">Needing Hindi (approved)</th>
                      <th className="pb-2">Covered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {translationStats.byExam.map((r: any, i: number) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-2">{r.exam || "—"}</td>
                        <td className="py-2">{r.needing_hindi}</td>
                        <td className="py-2">{r.covered}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="space-y-3">
              {translationRows.length === 0 && (
                <p className="card p-6 text-center text-sm text-muted-foreground">Translation queue khaali hai — sab kuch translate ho chuka hai 🎉</p>
              )}
              {translationRows.map((r) => (
                <div key={r.id} className="card p-4">
                  <p className="line-clamp-2 text-sm">{r.questionText}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.exam || "—"} {r.chapter ? `· ${r.chapter}` : ""} · {new Date(r.createdAt).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
