"use client";

// Admin → PYQ Date Mapping (NEW Oct 7 2026)
// Shows the FULL status of the worker that finds the real exam date (and Tier 1 / Tier 2) of every PYQ:
//   queue + counts, what the worker is doing right now, AI-key usage of this feature,
//   every question with its 5 verification passes, and buttons to accept / reject / type a date / re-run.
import * as React from "react";
import { useRouter } from "next/navigation";
import { API_BASE, api, fetchAuth } from "@/lib/api";

type Counts = Record<string, number>;
interface Overview {
  config: { autoRun: boolean; minAgeMinutes: number; batchSize: number; passes: number };
  worker: {
    enabled: boolean; busy: boolean; lastTickAt: string | null; lastMessage: string | null;
    avgSecondsPerQuestion: number | null; etaMinutes: number | null;
    current: { questionNo: number; pass: number; passes: number; elapsedSec: number } | null;
  };
  totals: { pyqTotal: number; pyqWithDate: number; pyqWithoutDate: number; notQueued: number; queuePending: number };
  counts: Counts;
  tiers: Array<{ tier: string; count: number }>;
  byExam: Array<{ exam: string; counts: Counts }>;
  ai: { keys: { active: number; total: number }; callsLast24h: number; successLast24h: number; failedLast24h: number; lastUsedAt: string | null; lastKeyName: string | null; lastModel: string | null; lastSuccess: boolean | null };
}
interface Item {
  id: string; questionId: string; status: string; examTier: string | null; proposedDate: string | null; agreeCount: number; passesDone: number;
  confidence: number | null; note: string | null; attempts: number; lastError: string | null; updatedAt: string; appliedAt: string | null;
  question: { questionNo: number; questionText: string; year: number | null; shift: string | null; examDate: string | null; examTier: string | null; exam: { name: string } | null; subject: { name: string } | null; chapter: { name: string } | null };
}
interface Pass {
  index: number; query: string; verdict: string; reason?: string; model?: string | null; keyName?: string | null; examDate: string | null; tier: string | null;
  quote: string | null; sourceUrl: string | null; strong: boolean; hits: number; sources: Array<{ url: string; title: string }>; ms: number;
}
interface Detail { passesJson: Pass[] | null; sourcesJson: Array<{ url: string; date: string | null }> | null; note: string | null }
type Exam = { id: string; name: string };

const STATUS_LABEL: Record<string, { t: string; c: string }> = {
  PENDING: { t: "Queue me", c: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  RUNNING: { t: "Chal raha", c: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  MAPPED: { t: "Date lag gayi ✅", c: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  NEEDS_REVIEW: { t: "Admin check", c: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  NOT_FOUND: { t: "Nahi mili", c: "bg-red-500/10 text-red-700 dark:text-red-300" },
  FAILED: { t: "Fail", c: "bg-red-500/20 text-red-700 dark:text-red-300" },
  MANUAL: { t: "Haath se ✍️", c: "bg-purple-500/15 text-purple-700 dark:text-purple-300" },
};
const VERDICT: Record<string, string> = {
  accepted: "✅ date mili & verify", no_date: "— date nahi", unsupported: "⚠️ AI ki date evidence me nahi (reject)", year_mismatch: "⚠️ year match nahi",
  no_results: "🔍 search me kuch nahi", search_failed: "🚫 search block/fail", error: "❌ error",
};
const tierText = (t: string | null) => (t === "TIER_1" ? "Tier 1" : t === "TIER_2" ? "Tier 2" : "—");
const ago = (s: string | null) => {
  if (!s) return "kabhi nahi";
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return "abhi";
  if (m < 60) return `${m} min pehle`;
  if (m < 1440) return `${Math.round(m / 60)} ghante pehle`;
  return new Date(s).toLocaleString();
};

export default function AdminPyqDatesPage() {
  const router = useRouter();
  const [ok, setOk] = React.useState(false);
  const [ov, setOv] = React.useState<Overview | null>(null);
  const [err, setErr] = React.useState("");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [exams, setExams] = React.useState<Exam[]>([]);
  const [status, setStatus] = React.useState("");
  const [examId, setExamId] = React.useState("");
  const [year, setYear] = React.useState("");
  const [tier, setTier] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [items, setItems] = React.useState<Item[]>([]);
  const [total, setTotal] = React.useState(0);
  const [open, setOpen] = React.useState<string>("");
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [manual, setManual] = React.useState({ date: "", tier: "" });
  const [cfg, setCfg] = React.useState({ minAgeMinutes: 5, batchSize: 2, passes: 5 });
  const [testQ, setTestQ] = React.useState("SSC CGL 2024 tier 1 exam date shift 1");
  const [testOut, setTestOut] = React.useState<string>("");
  const PAGE = 25;

  React.useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem("ssc_user") || "null");
      if (u?.role !== "ADMIN") { router.replace("/admin"); return; }
    } catch { router.replace("/dashboard"); return; }
    setOk(true);
  }, [router]);

  const loadOverview = React.useCallback(async () => {
    try {
      const d = await api<Overview>("/admin/pyq-dates/overview");
      setOv(d);
      setCfg({ minAgeMinutes: d.config.minAgeMinutes, batchSize: d.config.batchSize, passes: d.config.passes });
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  const loadItems = React.useCallback(async () => {
    const p = new URLSearchParams({ skip: String(page * PAGE), take: String(PAGE) });
    if (status) p.set("status", status);
    if (examId) p.set("examId", examId);
    if (year) p.set("year", year);
    if (tier) p.set("tier", tier);
    if (search.trim()) p.set("q", search.trim());
    try {
      const d = await api<{ total: number; rows: Item[] }>(`/admin/pyq-dates/items?${p.toString()}`);
      setItems(d.rows);
      setTotal(d.total);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [page, status, examId, year, tier, search]);

  React.useEffect(() => {
    if (!ok) return;
    void loadOverview();
    fetchAuth(`${API_BASE}/bank/meta`).then(async (r) => { if (r.ok) { const d = await r.json(); setExams(d?.exams ?? []); } }).catch(() => undefined);
  }, [ok, loadOverview]);
  React.useEffect(() => { if (ok) void loadItems(); }, [ok, loadItems]);

  // live refresh while the worker is busy (every 5 s), otherwise every 30 s
  React.useEffect(() => {
    if (!ok) return;
    const t = setInterval(() => { void loadOverview(); void loadItems(); }, ov?.worker.busy ? 5000 : 30000);
    return () => clearInterval(t);
  }, [ok, ov?.worker.busy, loadOverview, loadItems]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: true, text: `${label} ✅ ${r && typeof r === "object" ? JSON.stringify(r) : ""}` });
      await Promise.all([loadOverview(), loadItems()]);
    } catch (e) {
      setMsg({ ok: false, text: `${label}: ${(e as Error).message}` });
    }
  };
  const post = (path: string, body: unknown = {}) => api(`/admin/pyq-dates/${path}`, { method: "POST", body: JSON.stringify(body) });

  async function toggleOpen(it: Item) {
    if (open === it.questionId) { setOpen(""); setDetail(null); return; }
    setOpen(it.questionId);
    setDetail(null);
    setManual({ date: it.proposedDate || "", tier: it.examTier || "" });
    try { setDetail(await api<Detail>(`/admin/pyq-dates/items/${it.questionId}`)); } catch (e) { setErr((e as Error).message); }
  }

  async function downloadLog() {
    const res = await fetchAuth(`${API_BASE}/admin/pyq-dates/export${status ? `?status=${status}` : ""}`);
    if (!res.ok) { setMsg({ ok: false, text: `Export fail (HTTP ${res.status})` }); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "pyq_date_mapping.xlsx";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  async function runTest() {
    setTestOut("Search ho raha…");
    try {
      const d = await api<{ engine: string | null; failed: boolean; error: string | null; count: number; hits: Array<{ title: string; url: string }> }>("/admin/pyq-dates/test-search", { method: "POST", body: JSON.stringify({ q: testQ }) });
      setTestOut(d.count ? `✅ ${d.engine}: ${d.count} results\n` + d.hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}`).join("\n") : `❌ Koi result nahi. ${d.failed ? "Search engines block/fail: " : ""}${d.error ?? ""}`);
    } catch (e) { setTestOut(`❌ ${(e as Error).message}`); }
  }

  if (!ok) return null;
  const c = ov?.counts ?? {};
  const field = "rounded-lg border border-border bg-background px-2 py-1.5 text-xs";
  const card = "rounded-xl border border-border bg-card p-4";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
          <a href="/admin" className="text-sm font-semibold">← Admin</a>
          <span className="text-sm font-bold">📅 PYQ Date Mapping</span>
          <div className="flex gap-3 text-xs"><a href="/admin/pyq-export" className="text-primary underline">Excel export</a><a href="/admin/api-keys" className="text-primary underline">API keys</a></div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-3 py-5">
        {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-700">{err}</p>}
        {msg && <p className={`rounded-lg border p-2 text-sm break-all ${msg.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" : "border-red-500/40 bg-red-500/10 text-red-700"}`}>{msg.text}</p>}

        {/* ---- worker + totals ---- */}
        <section className="grid gap-4 lg:grid-cols-3">
          <div className={`${card} lg:col-span-2`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold">Worker status</h2>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ov?.worker.busy ? "bg-blue-500/15 text-blue-700" : "bg-muted text-muted-foreground"}`}>{!ov?.worker.enabled ? "BAND (env)" : ov?.worker.busy ? "CHAL RAHA" : "ARAAM"}</span>
            </div>
            <p className="mt-2 text-sm">
              {ov?.worker.current ? <>Abhi: <b>Q#{ov.worker.current.questionNo}</b> — pass {ov.worker.current.pass}/{ov.worker.current.passes} ({ov.worker.current.elapsedSec}s)</> : "Abhi koi question process nahi ho raha."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Last round: {ago(ov?.worker.lastTickAt ?? null)} — {ov?.worker.lastMessage ?? "—"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ek question ~{ov?.worker.avgSecondsPerQuestion ?? "?"} sec · baaki kaam ≈ {ov?.worker.etaMinutes != null ? `${ov.worker.etaMinutes} min` : "?"} (free keys ki limit mili to zyada).
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => act("Auto-run", () => api("/admin/pyq-dates/config", { method: "PUT", body: JSON.stringify({ autoRun: !ov?.config.autoRun }) }))} className={`rounded-lg px-3 py-2 text-xs font-bold ${ov?.config.autoRun ? "bg-emerald-600 text-white" : "border border-border"}`}>
                {ov?.config.autoRun ? "Auto-run: ON (band karein)" : "Auto-run: OFF (chalu karein)"}
              </button>
              <button onClick={() => act("Run now", () => post("run-now", { limit: 3 }))} className="rounded-lg border border-primary/40 px-3 py-2 text-xs font-semibold text-primary">▶️ Abhi chalao</button>
              <button onClick={() => act("Queue", () => post("enqueue", { scope: "unmapped", examId: examId || undefined, year: year ? Number(year) : undefined }))} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">➕ Bina-date wale sab queue me ({examId || year ? "filter ke" : "sab"})</button>
              <button onClick={() => act("Retry", () => post("enqueue", { scope: "retry", statuses: ["FAILED", "NOT_FOUND"] }))} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">🔁 Fail/Nahi-mili dobara</button>
              <button onClick={downloadLog} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">⬇️ Status Excel</button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <label>Naye question wait (min)<input className={`${field} mt-1 w-full`} type="number" min={0} max={1440} value={cfg.minAgeMinutes} onChange={(e) => setCfg({ ...cfg, minAgeMinutes: Number(e.target.value) })} /></label>
              <label>Ek round me questions<input className={`${field} mt-1 w-full`} type="number" min={1} max={5} value={cfg.batchSize} onChange={(e) => setCfg({ ...cfg, batchSize: Number(e.target.value) })} /></label>
              <label>Verification passes (3-5)<input className={`${field} mt-1 w-full`} type="number" min={3} max={5} value={cfg.passes} onChange={(e) => setCfg({ ...cfg, passes: Number(e.target.value) })} /></label>
            </div>
            <button onClick={() => act("Settings", () => api("/admin/pyq-dates/config", { method: "PUT", body: JSON.stringify(cfg) }))} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">💾 Settings save</button>
          </div>

          <div className={card}>
            <h2 className="text-sm font-bold">🔑 AI key use (is feature me)</h2>
            <p className="mt-2 text-sm">Active keys: <b>{ov?.ai.keys.active ?? 0}/{ov?.ai.keys.total ?? 0}</b></p>
            <p className="text-sm">24 ghante: ✅ {ov?.ai.successLast24h ?? 0} · ❌ {ov?.ai.failedLast24h ?? 0}</p>
            <p className="mt-1 text-xs text-muted-foreground">Last use: {ago(ov?.ai.lastUsedAt ?? null)}{ov?.ai.lastKeyName ? ` · ${ov.ai.lastKeyName}` : ""}{ov?.ai.lastModel ? ` · ${ov.ai.lastModel}` : ""}</p>
            {(ov?.ai.keys.active ?? 0) === 0 && <p className="mt-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-700">Koi active key nahi — mapping ruki hui hai. <a className="underline" href="/admin/api-keys">Key daalein</a></p>}
            <p className="mt-2 text-[11px] text-muted-foreground">Free key ki daily limit hoti hai; ek question me {cfg.passes} AI calls lagti hain. Zyada keys = zyada speed.</p>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {[
            ["PYQ total", ov?.totals.pyqTotal], ["Date lagi hai", ov?.totals.pyqWithDate], ["Bina date", ov?.totals.pyqWithoutDate], ["Queue me nahi aaye", ov?.totals.notQueued],
          ].map(([l, v]) => <div key={String(l)} className="rounded-lg border border-border bg-card p-3"><p className="text-[11px] text-muted-foreground">{l}</p><p className="text-lg font-bold">{(v as number | undefined)?.toLocaleString() ?? "…"}</p></div>)}
          {["PENDING", "MAPPED", "NEEDS_REVIEW", "NOT_FOUND"].map((s) => (
            <button key={s} onClick={() => { setStatus(status === s ? "" : s); setPage(0); }} className={`rounded-lg border p-3 text-left ${status === s ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
              <p className="text-[11px] text-muted-foreground">{STATUS_LABEL[s].t}</p><p className="text-lg font-bold">{(c[s] ?? 0).toLocaleString()}</p>
            </button>
          ))}
        </section>

        {ov && (ov.tiers.length > 0 || ov.byExam.length > 0) && (
          <section className="grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h2 className="mb-2 text-sm font-bold">Tier mapping</h2>
              <div className="flex flex-wrap gap-2 text-xs">{ov.tiers.map((t) => <span key={t.tier} className="rounded-full border border-border px-3 py-1">{t.tier === "UNKNOWN" ? "Tier pata nahi" : tierText(t.tier)}: <b>{t.count}</b></span>)}</div>
            </div>
            <div className={card}>
              <h2 className="mb-2 text-sm font-bold">Exam-wise status</h2>
              <ul className="space-y-1 text-xs">{ov.byExam.map((e) => <li key={e.exam} className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{e.exam}</span><span className="text-muted-foreground">{Object.entries(e.counts).map(([k, v]) => `${STATUS_LABEL[k]?.t ?? k}: ${v}`).join(" · ")}</span></li>)}</ul>
            </div>
          </section>
        )}

        {/* ---- items ---- */}
        <section className={card}>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <select className={field} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
              <option value="">Sab status</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v.t}</option>)}
            </select>
            <select className={field} value={examId} onChange={(e) => { setExamId(e.target.value); setPage(0); }}>
              <option value="">Sab exams</option>{exams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <input className={`${field} w-20`} placeholder="Year" inputMode="numeric" value={year} onChange={(e) => { setYear(e.target.value.replace(/\D/g, "").slice(0, 4)); setPage(0); }} />
            <select className={field} value={tier} onChange={(e) => { setTier(e.target.value); setPage(0); }}>
              <option value="">Sab tier</option><option value="TIER_1">Tier 1</option><option value="TIER_2">Tier 2</option>
            </select>
            <input className={`${field} min-w-[10rem] flex-1`} placeholder="Q number ya question text…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
            <span className="text-xs text-muted-foreground">{total.toLocaleString()} rows</span>
          </div>

          <ul className="divide-y divide-border">
            {items.map((it) => {
              const st = STATUS_LABEL[it.status] ?? { t: it.status, c: "bg-muted" };
              const isOpen = open === it.questionId;
              return (
                <li key={it.id} className="py-2">
                  <button onClick={() => toggleOpen(it)} className="flex w-full flex-wrap items-start gap-2 text-left">
                    <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">#{it.question.questionNo}</span>
                    <span className="min-w-0 flex-1 text-xs">
                      <span className="line-clamp-2">{it.question.questionText}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{it.question.exam?.name} · {it.question.subject?.name} · {it.question.chapter?.name} · {it.question.year ?? "—"} {it.question.shift ?? ""}</span>
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${st.c}`}>{st.t}</span>
                      <span className="mt-0.5 block font-mono">{it.question.examDate || it.proposedDate || "—"}</span>
                      <span className="block text-[11px] text-muted-foreground">{tierText(it.examTier ?? it.question.examTier)} · {it.agreeCount}/{it.passesDone}{it.confidence != null ? ` · ${Math.round(it.confidence * 100)}%` : ""}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="mt-2 space-y-2 rounded-lg border border-border bg-background p-3 text-xs">
                      {it.note && <p><b>Note:</b> {it.note}</p>}
                      {it.lastError && <p className="text-amber-700"><b>Last error:</b> {it.lastError}</p>}
                      {!detail && <p className="text-muted-foreground">Detail load ho raha…</p>}
                      {detail?.passesJson?.map((p) => (
                        <div key={p.index} className="rounded border border-border p-2">
                          <p className="font-semibold">Pass {p.index}: {VERDICT[p.verdict] ?? p.verdict} {p.examDate ? <span className="font-mono">{p.examDate}</span> : null} {p.tier ? `· ${tierText(p.tier)}` : ""} {p.strong ? "· 🎯 question page par mila" : ""}</p>
                          <p className="text-muted-foreground">🔍 {p.query}</p>
                          <p className="text-muted-foreground">{p.hits} results · {p.model ? `model ${p.model}` : "AI nahi chala"}{p.keyName ? ` · ${p.keyName}` : ""} · {(p.ms / 1000).toFixed(1)}s</p>
                          {p.quote && <p className="italic">“{p.quote}”</p>}
                          {p.reason && <p className="text-amber-700">{p.reason}</p>}
                          {p.sourceUrl && <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="break-all text-primary underline">{p.sourceUrl}</a>}
                        </div>
                      ))}
                      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
                        {it.proposedDate && it.status !== "MAPPED" && it.status !== "MANUAL" && (
                          <button onClick={() => act("Accept", () => post(`items/${it.questionId}/accept`))} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white">✔ {it.proposedDate} accept karein</button>
                        )}
                        {it.proposedDate && it.status === "NEEDS_REVIEW" && <button onClick={() => act("Reject", () => post(`items/${it.questionId}/reject`))} className="rounded-lg border border-red-500/40 px-3 py-1.5 font-semibold text-red-600">✖ Reject</button>}
                        <button onClick={() => act("Re-run", () => post("enqueue", { scope: "ids", ids: [it.questionId] }))} className="rounded-lg border border-border px-3 py-1.5 font-semibold">🔁 Dobara search</button>
                        <input className={`${field} w-32`} placeholder="YYYY-MM-DD" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} />
                        <select className={field} value={manual.tier} onChange={(e) => setManual({ ...manual, tier: e.target.value })}><option value="">Tier?</option><option value="TIER_1">Tier 1</option><option value="TIER_2">Tier 2</option></select>
                        <button onClick={() => act("Manual date", () => post(`items/${it.questionId}/manual`, { examDate: manual.date, examTier: manual.tier || null }))} className="rounded-lg border border-border px-3 py-1.5 font-semibold">✍️ Date khud daalein</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
            {items.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">Abhi koi row nahi. “Bina-date wale sab queue me” dabayein ya naye PYQ upload hone ka 5 minute wait karein.</li>}
          </ul>

          <div className="mt-3 flex items-center justify-between text-xs">
            <button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded border border-border px-3 py-1.5 disabled:opacity-40">← Pehle</button>
            <span>Page {page + 1} / {Math.max(1, Math.ceil(total / PAGE))}</span>
            <button disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)} className="rounded border border-border px-3 py-1.5 disabled:opacity-40">Aage →</button>
          </div>
        </section>

        <section className={card}>
          <h2 className="mb-2 text-sm font-bold">🧪 Internet search test (AI key use nahi hoti)</h2>
          <div className="flex gap-2"><input className={`${field} flex-1`} value={testQ} onChange={(e) => setTestQ(e.target.value)} /><button onClick={runTest} className="rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary">Test</button></div>
          {testOut && <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-muted/50 p-2 text-[11px]">{testOut}</pre>}
        </section>
      </main>
    </div>
  );
}
