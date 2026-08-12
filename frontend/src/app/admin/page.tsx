"use client";

import * as React from "react";

// Admin tab: attach/update/remove video solutions on questions
function VideoSolutionTab() {
  const [questionId, setQuestionId] = React.useState("");
  const [videoUrl, setVideoUrl] = React.useState("");
  const [videoTitle, setVideoTitle] = React.useState("");
  const [videoSource, setVideoSource] = React.useState("YOUTUBE");
  const [videoDescription, setVideoDescription] = React.useState("");
  const [videoDurationSeconds, setVideoDurationSeconds] = React.useState("");
  const [videoLanguage, setVideoLanguage] = React.useState("hi");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
  const headers = (): Record<string, string> => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const save = async (method: "POST" | "DELETE") => {
    setBusy(true);
    setMsg(null);
    try {
      const body =
        method === "POST"
          ? {
              videoUrl,
              videoSource,
              videoTitle: videoTitle || null,
              videoDescription: videoDescription || null,
              videoDurationSeconds: videoDurationSeconds
                ? Number(videoDurationSeconds)
                : undefined,
              videoLanguage: videoLanguage || null,
            }
          : undefined;
      const r = await fetch(`${apiBase}/bank/questions/${questionId}/video`, {
        method,
        headers: { ...headers(), "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await r.json().catch(() => ({}));
      setMsg({
        ok: r.ok,
        text: r.ok
          ? method === "POST"
            ? "✅ Video solution saved"
            : "✅ Video solution removed"
          : `❌ ${d.message || "Request failed"}`,
      });
    } catch {
      setMsg({ ok: false, text: "❌ Network error — backend unreachable" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">🎬 Video Solutions</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Attach a YouTube / Vimeo / direct video link to any question
      </p>

      <div className="card mt-6 max-w-2xl space-y-4 p-6">
        <div>
          <label className="text-xs font-semibold text-muted-foreground">
            Question ID *
          </label>
          <input
            value={questionId}
            onChange={(e) => setQuestionId(e.target.value)}
            placeholder="e.g. 4ffe7ae9-c17b-435f-b691-a4e916310a59"
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">
            Video URL *
          </label>
          <input
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">
              Source
            </label>
            <select
              value={videoSource}
              onChange={(e) => setVideoSource(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="YOUTUBE">YouTube</option>
              <option value="VIMEO">Vimeo</option>
              <option value="S3_R2">S3/R2</option>
              <option value="CUSTOM">Custom</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">
              Language
            </label>
            <select
              value={videoLanguage}
              onChange={(e) => setVideoLanguage(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="hi">Hindi</option>
              <option value="en">English</option>
              <option value="hinglish">Hinglish</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">
            Video Title
          </label>
          <input
            value={videoTitle}
            onChange={(e) => setVideoTitle(e.target.value)}
            placeholder="Solution explained by ..."
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">
              Duration (seconds)
            </label>
            <input
              value={videoDurationSeconds}
              onChange={(e) => setVideoDurationSeconds(e.target.value)}
              type="number"
              placeholder="e.g. 480"
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">
              Description
            </label>
            <input
              value={videoDescription}
              onChange={(e) => setVideoDescription(e.target.value)}
              placeholder="Short description"
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={() => save("POST")}
            disabled={busy || !questionId || !videoUrl}
            className="btn btn-primary flex-1"
          >
            {busy ? "Saving…" : "💾 Save Video Solution"}
          </button>
          <button
            onClick={() => save("DELETE")}
            disabled={busy || !questionId}
            className="btn btn-outline"
          >
            🗑 Remove
          </button>
        </div>

        {msg && (
          <p
            className={`text-sm ${
              msg.ok ? "text-success" : "text-danger"
            }`}
          >
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}

// Admin tab: answer-key accuracy dashboard (v5 §42) — verification breakdown + error-report queue
const STATUS_META: Record<string, { label: string; color: string }> = {
  VERIFIED_OFFICIAL: { label: "Official Answer Key", color: "bg-success" },
  VERIFIED_MULTI_SOURCE: { label: "Multi-Source Verified", color: "bg-info" },
  VERIFIED_COMPUTED: { label: "Computed", color: "bg-secondary" },
  UNVERIFIED_SINGLE_SOURCE: { label: "Single Source (unverified)", color: "bg-warning" },
  DISPUTED: { label: "Disputed", color: "bg-danger" },
};

/** v1 §7.1 — PDF Ingestion tab: upload a paper → extraction worker → review queue. */
function ImportPdfTab() {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
  const headers = (): Record<string, string> => {
    const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
  const [exams, setExams] = React.useState<any[]>([]);
  const [subjects, setSubjects] = React.useState<any[]>([]);
  const [file, setFile] = React.useState<File | null>(null);
  const [examId, setExamId] = React.useState("");
  const [subjectId, setSubjectId] = React.useState("");
  const [year, setYear] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [batches, setBatches] = React.useState<any[]>([]);

  React.useEffect(() => {
    (async () => {
      try {
        const [m, sc] = await Promise.all([
          fetch(`${apiBase}/bank/meta`, { headers: headers() }).then((r) => r.json()),
          fetch(`${apiBase}/bank/subjects`, { headers: headers() }).then((r) => r.json()),
        ]);
        setExams(Array.isArray(m?.exams) ? m.exams.filter((e: any) => e.count > 0) : []);
        setSubjects(Array.isArray(sc) ? sc : []);
      } catch {}
    })();
    loadBatches();
  }, []);

  const loadBatches = async () => {
    try {
      const r = await fetch(`${apiBase}/admin/pdf-ingestion/batches?limit=8`, { headers: headers() });
      if (r.ok) {
        const d = await r.json();
        setBatches(d?.data || []);
      }
    } catch {}
  };

  const upload = async () => {
    if (!file) { setMsg({ ok: false, text: "Choose a PDF file first." }); return; }
    if (!subjectId) { setMsg({ ok: false, text: "Select the subject of these questions." }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("subjectId", subjectId);
      if (examId) fd.append("examId", examId);
      if (year) fd.append("year", year);
      const r = await fetch(`${apiBase}/admin/pdf-ingestion/upload-file`, {
        method: "POST",
        headers: headers(),
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ ok: false, text: j.message || "Upload failed" }); return; }
      setMsg({ ok: true, text: `Uploaded! Batch created — extraction worker is processing. Questions land in the review queue as AI_DRAFT.` });
      setFile(null);
      loadBatches();
      // poll batch status updates
      const bid = j?.batch?.id;
      if (bid) {
        for (let i = 0; i < 20; i++) {
          await new Promise((res) => setTimeout(res, 3000));
          const br = await fetch(`${apiBase}/admin/pdf-ingestion/batches/${bid}`, { headers: headers() });
          const b = await br.json().catch(() => ({}));
          if (b?.status === "COMPLETED" || b?.status === "PARTIAL") {
            setMsg({ ok: true, text: `Batch ${b.status}: ${b.completedChunks}/${b.totalChunks} chunks done. ${b.errorMessage || "Questions → review queue."}` });
            break;
          }
        }
        loadBatches();
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || "Upload failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">Import PDF</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload a question paper — text extraction (pdfjs) + LLM fallback → AI_DRAFT review queue with confidence scores.
      </p>

      <div className="card mt-6 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Subject (required)</label>
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <option value="">— select subject —</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Exam (optional)</label>
            <select value={examId} onChange={(e) => setExamId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <option value="">— any —</option>
              {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4">
          <label className="mb-1.5 block text-sm font-medium">Year (optional)</label>
          <input type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="e.g. 2024"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        </div>
        <div className="mt-4">
          <label className="mb-1.5 block text-sm font-medium">PDF file</label>
          <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="w-full text-sm" />
        </div>
        <button onClick={upload} disabled={busy}
          className="mt-5 w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {busy ? "Uploading + processing…" : "📤 Upload PDF & Extract"}
        </button>
        {msg && (
          <p className={`mt-3 rounded-lg border p-3 text-sm ${msg.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" : "border-red-500/30 bg-red-500/10 text-red-700"}`}>
            {msg.text}
          </p>
        )}
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-bold">Recent batches</h2>
        <div className="mt-3 space-y-2">
          {batches.length === 0 && <p className="text-sm text-muted-foreground">No uploads yet.</p>}
          {batches.map((b) => (
            <div key={b.id} className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div className="min-w-0">
                <p className="font-semibold">{b.sourcePdf?.filename || b.id.slice(0, 8)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {b.status} · {b.completedChunks}/{b.totalChunks} chunks · {b.errorMessage ? `（${b.errorMessage}）` : ""}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${b.status === "COMPLETED" ? "bg-success/20 text-success" : b.status === "PARTIAL" ? "bg-warning/20 text-warning" : "bg-muted text-muted-foreground"}`}>
                {b.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AccuracyDashboardTab() {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
  const headers = (): Record<string, string> => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
  const [verif, setVerif] = React.useState<any>(null);
  const [reports, setReports] = React.useState<any>(null);
  const [catStats, setCatStats] = React.useState<any>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    try {
      const [rv, rr, rc] = await Promise.all([
        fetch(`${apiBase}/bank/verification-stats`, { headers: headers() }).then((r) =>
          r.ok ? r.json() : null,
        ),
        fetch(`${apiBase}/report-error`, { headers: headers() })
          .then((r) => (r.ok ? r.json() : { reports: [] }))
          .catch(() => ({ reports: [] })),
        fetch(`${apiBase}/report-error/stats/categories`, { headers: headers() })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      if (rv) setVerif(rv);
      if (rr) setReports(rr);
      if (rc) setCatStats(rc);
    } catch {}
  };

  React.useEffect(() => {
    load();
  }, []);

  const resolve = async (id: string, status: "REVIEWING" | "CONFIRMED" | "REJECTED") => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`${apiBase}/report-error/${id}/resolve`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const d = await r.json().catch(() => ({}));
      setMsg({
        ok: r.ok,
        text: r.ok
          ? status === "REJECTED"
            ? "✅ Rejected — question unsuspended"
            : status === "CONFIRMED"
              ? "✅ Confirmed — question kept suspended for correction"
              : "✅ Marked REVIEWING"
          : `❌ ${d.message || "Request failed"}`,
      });
      if (r.ok) load();
    } catch {
      setMsg({ ok: false, text: "❌ Network error" });
    } finally {
      setBusy(false);
    }
  };

  const stats = verif?.stats || {};
  const total = verif?.total || 0;
  const rows = Object.entries(STATUS_META).map(([key, meta]) => ({
    key,
    ...meta,
    count: stats[key] ?? 0,
  }));
  const openList = (reports?.reports || []).filter(
    (r: any) => r.status === "OPEN" || r.status === "REVIEWING",
  );

  return (
    <div>
      <h1 className="text-2xl font-bold">✅ Answer Accuracy</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Platform-wide answer-key verification status (v5 §42)
      </p>

      {/* Verification status bars */}
      <div className="card mt-6 p-6">
        <h2 className="font-semibold">Verification Status</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {total.toLocaleString()} total questions
        </p>
        <div className="mt-4 space-y-3">
          {rows.map((row) => (
            <div key={row.key}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{row.label}</span>
                <span className="font-bold tabular-nums">
                  {row.count.toLocaleString()}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({total ? Math.round((row.count / total) * 100) : 0}%)
                  </span>
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${row.color}`}
                  style={{ width: `${total ? Math.max((row.count / total) * 100, row.count ? 1 : 0) : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* v5 §40 — Error-type classification */}
      {catStats && (
        <div className="card mt-6 p-6">
          <h2 className="font-semibold">🏷️ Error-Type Classification</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {catStats.total} total reports — what kind of errors students are flagging
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {(catStats.byCategory || [])
              .slice()
              .sort((a: any, b: any) => b.count - a.count)
              .map((c: any) => (
                <div
                  key={c.category}
                  className="flex items-center justify-between rounded-xl border border-border px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold">
                      {c.category.replace(/_/g, " ").toLowerCase()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {c.open} open
                    </p>
                  </div>
                  <span className="text-xl font-bold text-primary">{c.count}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Error report queue */}
      <div className="card mt-6 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">⚠️ Error Report Queue</h2>
          <span className="rounded-full bg-danger/10 px-3 py-1 text-xs font-bold text-danger">
            {openList.length} open
          </span>
        </div>
        {openList.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            🎉 No open error reports. Sab questions smooth hain.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {openList.map((r: any) => (
              <div key={r.id} className="rounded-xl border border-border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold line-clamp-2">
                      {r.question?.questionText || r.questionId}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="font-medium">
                        {r.question?.exam?.name || "?"} {r.question?.year || ""} |{" "}
                        {r.question?.shift || "?"} shift
                      </span>
                      {" · "}
                      <span className="uppercase">{r.status}</span>
                      {" · "}
                      {r.description}
                    </p>
                    {r.question?.autoSuspended && (
                      <span className="mt-1 inline-block rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">
                        ⛔ AUTO-SUSPENDED
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      className="btn btn-outline btn-sm"
                      disabled={busy}
                      onClick={() => resolve(r.id, "REVIEWING")}
                    >
                      Reviewing
                    </button>
                    <button
                      className="btn btn-outline btn-sm text-success"
                      disabled={busy}
                      onClick={() => resolve(r.id, "CONFIRMED")}
                    >
                      ✅ Confirm
                    </button>
                    <button
                      className="btn btn-outline btn-sm text-danger"
                      disabled={busy}
                      onClick={() => resolve(r.id, "REJECTED")}
                    >
                      ❌ Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {msg && (
          <p className={`mt-3 text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>
        )}
      </div>
    </div>
  );
}

// v6 §7 — PDF Export tab: generate test paper + answer key PDF (bilingual),
// 4-pass QA gate (pass1/2 auto, pass3 admin spotcheck, pass4 publish regression).
function PdfExportTab() {
  const [templateId, setTemplateId] = React.useState("");
  const [status, setStatus] = React.useState<any>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
  const headers = (): Record<string, string> => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const load = async (id?: string) => {
    const tid = (id ?? templateId).trim();
    if (!tid) return;
    try {
      const r = await fetch(`${apiBase}/tests/${tid}/pdf/status`, { headers: headers() });
      if (r.ok) setStatus(await r.json());
    } catch {}
  };

  const act = async (action: "generate" | "spotcheck" | "publish", label: string) => {
    const tid = templateId.trim();
    if (!tid) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`${apiBase}/tests/${tid}/pdf/${action}`, {
        method: "POST",
        headers: headers(),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setMsg({ ok: true, text: `✅ ${label} done` });
        setStatus(d);
      } else {
        setMsg({ ok: false, text: `❌ ${d.message || "Request failed"}` });
      }
    } catch {
      setMsg({ ok: false, text: "❌ Network error — backend unreachable" });
    } finally {
      setBusy(false);
    }
  };

  const download = (kind: "paper" | "answerkey") => {
    const tid = templateId.trim();
    if (!tid) return;
    window.open(`${apiBase}/tests/${tid}/pdf/${kind}`, "_blank");
  };

  const passBadge = (v: boolean | undefined, label: string) => (
    <span
      className={`mr-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${
        v ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"
      }`}
    >
      {v ? "✅" : "⏳"} {label}
    </span>
  );

  return (
    <div>
      <h1 className="text-2xl font-bold">📄 PDF Export</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Generate bilingual (EN + हिंदी) test paper & answer key PDFs with 4-pass QA gate (v6 §7)
      </p>

      <div className="card mt-6 max-w-2xl space-y-4 p-6">
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Test Template ID *</label>
          <input
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setStatus(null);
            }}
            placeholder="e.g. tpl-cgl-full-1"
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => act("generate", "Generate")}
            disabled={busy || !templateId.trim()}
            className="btn bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Working…" : "🔄 Generate PDFs (auto pass 1+2)"}
          </button>
          <button
            onClick={() => act("spotcheck", "Spot-check")}
            disabled={busy || !templateId.trim()}
            className="btn btn-outline disabled:opacity-50"
          >
            ✅ Mark Pass 3 (spot-check done)
          </button>
          <button
            onClick={() => act("publish", "Publish")}
            disabled={busy || !templateId.trim()}
            className="btn bg-success text-success-foreground hover:opacity-90 disabled:opacity-50"
          >
            🚀 Publish (runs pass 4 regression)
          </button>
          <button
            onClick={() => load()}
            disabled={!templateId.trim()}
            className="btn btn-outline disabled:opacity-50"
          >
            🔄 Refresh Status
          </button>
        </div>

        {status && (
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm font-semibold">QA Gate Status</p>
            <div className="mt-2 flex flex-wrap">
              {passBadge(status.pass1Field, "Pass 1: Field match")}
              {passBadge(status.pass2Structural, "Pass 2: Structural 1:1")}
              {passBadge(status.pass3SpotCheck, "Pass 3: Admin spot-check")}
              {passBadge(status.pass4Regression, "Pass 4: Regression diff")}
              {passBadge(status.isPublished, "Published")}
            </div>
            {status.isPublished && (
              <div className="mt-3 flex gap-3">
                <a
                  href={`${apiBase}/tests/${templateId}/pdf/paper`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-outline text-sm"
                >
                  📄 Download Paper PDF
                </a>
                <a
                  href={`${apiBase}/tests/${templateId}/pdf/answerkey`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-outline text-sm"
                >
                  🔑 Download Answer Key PDF
                </a>
              </div>
            )}
          </div>
        )}

        {msg && (
          <p className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>
        )}
      </div>
    </div>
  );
}

// Admin tab: revenue overview (payments, subscriptions, sales)
function RevenueTab() {
  const [data, setData] = React.useState<any>(null);
  const [days, setDays] = React.useState(30);
  const [busy, setBusy] = React.useState(false);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
  const headers = (): Record<string, string> => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const load = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${apiBase}/admin/revenue?days=${days}`, { headers: headers() });
      if (r.ok) setData(await r.json());
    } catch {}
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">💰 Revenue Overview</h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-xs">
          {[7, 30, 90, 365].map((d) => (
            <option key={d} value={d}>Last {d} days</option>
          ))}
        </select>
      </div>
      {busy && <p className="text-xs text-muted-foreground">Loading…</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card p-4">
              <p className="text-xs text-muted-foreground">Revenue (₹)</p>
              <p className="mt-1 text-xl font-bold">₹{data.revenueInr ?? 0}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-muted-foreground">Payments</p>
              <p className="mt-1 text-xl font-bold">{data.paymentCount ?? 0}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-muted-foreground">Active Subs</p>
              <p className="mt-1 text-xl font-bold">{data.activeSubscriptions ?? 0}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-muted-foreground">Pending</p>
              <p className="mt-1 text-xl font-bold">{data.pendingPayments ?? 0}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-4 text-center">
              <p className="text-xs text-muted-foreground">Chapter Sales</p>
              <p className="mt-1 text-lg font-bold">{data.chapterSales ?? 0}</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-xs text-muted-foreground">Mock Packs</p>
              <p className="mt-1 text-lg font-bold">{data.mockSales ?? 0}</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-xs text-muted-foreground">By Status</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {Array.isArray(data.byStatus) && data.byStatus.length
                  ? data.byStatus.map((s: any) => `${s.status}:${s._count}`).join(" · ")
                  : "—"}
              </p>
            </div>
          </div>
          <div className="card p-4">
            <h3 className="text-xs font-semibold text-muted-foreground">Recent Payments</h3>
            <div className="mt-2 space-y-1.5 text-xs">
              {Array.isArray(data.recent) && data.recent.length === 0 && <p>No payments yet.</p>}
              {Array.isArray(data.recent) &&
                data.recent.map((p: any) => (
                  <div key={p.id} className="flex justify-between border-b border-border/50 pb-1.5">
                    <span>{p.user?.fullName || p.user?.email || "—"}</span>
                    <span className="text-muted-foreground">
                      ₹{p.amountInr} · {new Date(p.createdAt).toLocaleDateString("en-IN")}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Admin tab: audit log viewer (who did what, when)
function AuditLogTab() {
  const [logs, setLogs] = React.useState<any[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [busy, setBusy] = React.useState(false);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
  const headers = (): Record<string, string> => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") || "" : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const load = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${apiBase}/admin/audit-log?page=${page}&limit=50`, { headers: headers() });
      if (r.ok) {
        const d = await r.json();
        setLogs(Array.isArray(d?.logs) ? d.logs : []);
        setTotal(d?.total ?? 0);
      }
    } catch {}
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-bold">🕵️ Audit Log</h2>
      {busy && <p className="text-xs text-muted-foreground">Loading…</p>}
      <div className="card overflow-x-auto p-4">
        {logs.length === 0 && !busy && <p className="text-xs text-muted-foreground">No audit entries yet.</p>}
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-3">When</th>
              <th className="py-2 pr-3">Action</th>
              <th className="py-2 pr-3">Entity</th>
              <th className="py-2 pr-3">Entity ID</th>
              <th className="py-2 pr-3">User</th>
              <th className="py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l: any) => (
              <tr key={l.id} className="border-b border-border/50">
                <td className="py-2 pr-3 whitespace-nowrap">{new Date(l.createdAt).toLocaleString("en-IN")}</td>
                <td className="py-2 pr-3 font-medium">{l.action}</td>
                <td className="py-2 pr-3">{l.targetEntity}</td>
                <td className="py-2 pr-3 text-muted-foreground">{l.entityId ? l.entityId.slice(0, 12) + "…" : "—"}</td>
                <td className="py-2 pr-3 text-muted-foreground">{l.userId ? l.userId.slice(0, 8) + "…" : "—"}</td>
                <td className="py-2 text-muted-foreground">{l.ipAddress || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > 50 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{total} entries</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
              className="btn border border-border px-3 py-1 disabled:opacity-40">← Prev</button>
            <span className="px-2 py-1">Page {page}</span>
            <button onClick={() => setPage((p) => p + 1)} disabled={page * 50 >= total}
              className="btn border border-border px-3 py-1 disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = React.useState<"dashboard" | "questions" | "import" | "video" | "accuracy" | "pdf" | "revenue" | "audit">("dashboard");
  const [user, setUser] = React.useState<any>(null);
  const [stats, setStats] = React.useState<any>(null);
  const [weightage, setWeightage] = React.useState<any[] | null>(null);

  React.useEffect(() => {
    const raw = localStorage.getItem("ssc_user");
    if (raw) {
      try { setUser(JSON.parse(raw)); } catch {}
    }
    loadStats();
    loadWeightage();
  }, []);

  const loadWeightage = async () => {
    const token = localStorage.getItem("ssc_access_token");
    try {
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1"}/bank/topic-weightage`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (r.ok) setWeightage(await r.json());
    } catch {}
  };

  const loadStats = async () => {
    const token = localStorage.getItem("ssc_access_token");
    try {
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1"}/bank/meta`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (r.ok) setStats(await r.json());
    } catch {}
  };

  if (!user || user.role !== "ADMIN") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="card p-8 text-center">
          <p className="text-2xl">🔒</p>
          <h1 className="mt-3 text-xl font-bold">Admin Access Only</h1>
          <p className="mt-2 text-sm text-muted-foreground">Login with an admin account.</p>
          <a href="/login" className="btn btn-primary mt-4 inline-block">Login</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <span className="text-lg font-bold">⚙️ SSC<span className="text-primary">PrepHub</span> Admin</span>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{user.fullName}</span>
            <a href="/dashboard" className="btn btn-outline">Dashboard</a>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-8">
        {/* Sidebar */}
        <aside className="w-56 shrink-0">
          <nav className="space-y-1">
            {[
              { id: "dashboard" as const, label: "📊 Dashboard", icon: "📊" },
              { id: "questions" as const, label: "📝 Questions", icon: "📝" },
              { id: "import" as const, label: "📤 Import PDF", icon: "📤" },
              { id: "video" as const, label: "🎬 Video Solutions", icon: "🎬" },
              { id: "accuracy" as const, label: "✅ Accuracy", icon: "✅" },
              { id: "pdf" as const, label: "📄 PDF Export", icon: "📄" },
              { id: "revenue" as const, label: "💰 Revenue", icon: "💰" },
              { id: "audit" as const, label: "🕵️ Audit Log", icon: "🕵️" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`w-full rounded-lg px-4 py-2.5 text-left text-sm font-medium transition ${
                  tab === t.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="min-w-0 flex-1">
          {tab === "dashboard" && (
            <div>
              <h1 className="text-2xl font-bold">Admin Dashboard</h1>
              <p className="mt-1 text-sm text-muted-foreground">Platform overview</p>
              
              {stats && (
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  <div className="card p-5">
                    <p className="text-xs text-muted-foreground">Total Questions</p>
                    <p className="mt-1 text-3xl font-bold">{stats.totalQuestions}</p>
                  </div>
                  <div className="card p-5">
                    <p className="text-xs text-muted-foreground">Exams</p>
                    <p className="mt-1 text-3xl font-bold">{stats.exams?.length || 0}</p>
                  </div>
                  <div className="card p-5">
                    <p className="text-xs text-muted-foreground">Hindi Coverage</p>
                    <p className="mt-1 text-3xl font-bold">{stats.approxHindiCovered}</p>
                  </div>
                </div>
              )}

              <div className="card mt-8 p-6">
                <h2 className="font-semibold">Quick Actions</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <a href="/question-bank" className="card p-4 text-center hover:border-primary">
                    <p className="text-lg">📝</p>
                    <p className="mt-1 text-sm font-medium">Browse Question Bank</p>
                  </a>
                  <a href="/discover" className="card p-4 text-center hover:border-primary">
                    <p className="text-lg">🔍</p>
                    <p className="mt-1 text-sm font-medium">Discovery Page</p>
                  </a>
                </div>
              </div>

              {/* v5 §40 — Topic weightage */}
              <div className="card mt-6 p-6">
                <h2 className="font-semibold">📊 Topic Weightage</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Approved questions by exam × subject × chapter
                </p>
                {!weightage ? (
                  <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
                ) : (
                  <div className="mt-4 space-y-4">
                    {weightage.map((exam) => (
                      <details key={exam.examId} className="rounded-xl border border-border p-4" open={weightage.length === 1}>
                        <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold">
                          <span>{exam.examName}</span>
                          <span className="text-primary">{exam.total.toLocaleString()} Qs</span>
                        </summary>
                        <div className="mt-3 space-y-2">
                          {exam.subjects.map((s: any) => (
                            <details key={s.subjectId} className="rounded-lg bg-muted/30 p-3">
                              <summary className="flex cursor-pointer items-center justify-between text-sm font-medium">
                                <span>{s.subjectName}</span>
                                <span className="text-xs text-muted-foreground">{s.total.toLocaleString()} Qs</span>
                              </summary>
                              <div className="mt-2 space-y-1">
                                {s.chapters.map((c: any) => (
                                  <div key={c.chapterId} className="flex items-center justify-between px-2 py-1 text-xs">
                                    <span className="text-muted-foreground">{c.chapterName}</span>
                                    <span className="font-semibold tabular-nums">{c.count}</span>
                                  </div>
                                ))}
                              </div>
                            </details>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "questions" && (
            <div>
              <h1 className="text-2xl font-bold">Questions</h1>
              <p className="mt-1 text-sm text-muted-foreground">Browse and manage questions</p>
              <iframe src="/question-bank" className="mt-4 h-[70vh] w-full rounded-xl border border-border" />
            </div>
          )}

          {tab === "import" && <ImportPdfTab />}

          {tab === "video" && <VideoSolutionTab />}
          {tab === "accuracy" && <AccuracyDashboardTab />}
          {tab === "pdf" && <PdfExportTab />}
          {tab === "revenue" && <RevenueTab />}
          {tab === "audit" && <AuditLogTab />}
        </main>
      </div>
    </div>
  );
}