"use client";

// Admin → AI Jobs (NEW Oct 15 2026): central AI job engine + REAL live status.
//  * health badge, every key (working / resting / ready / off), last 25 calls — refreshed every 3 s
//  * create a job (solution / Hindi / chapter / answer-key / PYQ date) with scope -> Estimate -> Start
//  * per job: progress, ETA, current question + pass, Pause / Resume / Cancel / Retry failed
//  * review queue: Accept / Reject (single + all), Undo (single + whole job)
//  * "AI System Check": a real end-to-end test
import * as React from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface LiveKey { id: string; keyName: string; isActive: boolean; state: "working" | "resting" | "idle" | "off"; restSec: number; feature: string | null; model: string | null; note: string | null; runningSec: number; lastError: string | null; problem?: string | null }
interface LiveEvent { at: number; keyName: string; feature: string; model: string | null; success: boolean; ms: number; error: string | null }
interface JobRow {
  id: string; type: string; label: string; title: string | null; status: string; passes: number; minAgree: number; total: number; done: number; failed: number; review: number; calls: number;
  lastError: string | null; etaSec: number | null; avgSecPerItem: number | null; createdAt: string;
  current: Array<{ questionNo: number | null; stage: string; pass: number; passes: number; runningSec: number }>;
}
interface Overview {
  health: { level: string; icon: string; text: string };
  boot?: { at: string; line: string } | null;
  worker: { enabled: boolean; busy: boolean; lastMessage: string | null; restSec: number; watchdogFixed?: number };
  jobs: JobRow[];
  live: { keys: LiveKey[]; recent: LiveEvent[]; gateway: { configured: boolean; model: string | null }; models: Array<{ model: string; successRate: number | null; avgMs?: number | null; skippedForSec: number }> };
}
interface Meta { exams: Array<{ id: string; name: string }>; subjects: Array<{ id: string; name: string }>; chapters: Array<{ id: string; name: string; subjectId: string }> }
interface Estimate { questions: number; willProcess: number; passes: number; calls: number; avgSecPerCall: number; concurrency: number; etaSec: number | null; note: string; keys: { active: number; ready: number } }
interface Item { id: string; questionNo: number | null; status: string; note: string | null; lastError: string | null; agree: number; passesDone: number; proposal: Record<string, unknown> | null; passes: Array<{ i: number; stage: string; ok: boolean; vote: string | null; error?: string }> | null; question: string }
interface Stats { days: number; features: Array<{ name: string; ok: number; fail: number; successPct: number | null; avgMs: number | null }>; keys: Array<{ name: string; ok: number; fail: number; successPct: number | null }>; failReasons: Array<{ reason: string; count: number }> }
interface Quota { keys: Array<{ id: string; keyName: string; info: { usage: number | null; limit: number | null; remaining: number | null; isFree: boolean | null } | null; problem: string | null }> }
interface Bench { at: string; total: number; correct: number; accuracyPct: number; avgSec: number; verdict: string; message: string; rows: Array<{ q: string; expected: string; got: string | null; ok: boolean; sec: number }> }
interface Step { id: string; name: string; ok: boolean | null; detail: string; fix: string | null; ms: number }

const TYPES: Array<{ v: string; t: string; hint: string }> = [
  { v: "SOLUTION_GENERATE", t: "Solution (jahan missing)", hint: "Sirf jin questions me solution khali hai. Answer key ke saath consistent hone par hi likhta hai." },
  { v: "HINDI_TRANSLATE", t: "Hindi translation", hint: "Missing Hindi question / options / solution. English subject exempt." },
  { v: "CHAPTER_TOPIC_CLASSIFY", t: "Chapter / topic suggest", hint: "Auto-apply nahi — sirf review me suggestion." },
  { v: "ANSWER_KEY_VERIFY", t: "Answer key check", hint: "Independent passes; galat lage to review me aata hai." },
  { v: "PYQ_DATE_SHIFT", t: "PYQ date + tier", hint: "Purana PYQ date worker chalta hai; yahan progress + review dikhta hai." },
];
const ST: Record<string, string> = { PENDING: "⏳ Wait", RUNNING: "🟢 Chal raha", PAUSED: "⏸ Pause", DONE: "✅ Done", FAILED: "❌ Failed", CANCELLED: "🚫 Cancel", NEEDS_REVIEW: "👀 Review", ACCEPTED: "✅ Accepted", REJECTED: "↩ Rejected", SKIPPED: "⏭ Skipped" };
const fmt = (s: number | null) => (s === null ? "—" : s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} ghante`);
const KEY_UI: Record<string, string> = { working: "🟢 Kaam kar rahi", resting: "😴 Rest", idle: "⚪ Ready", off: "⛔ OFF" };

export default function AdminAiPage() {
  const router = useRouter();
  const [ok, setOk] = React.useState(false);
  const [ov, setOv] = React.useState<Overview | null>(null);
  const [meta, setMeta] = React.useState<Meta | null>(null);
  const [err, setErr] = React.useState("");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [f, setF] = React.useState({ type: "SOLUTION_GENERATE", examId: "", subjectId: "", chapterId: "", year: "", batchId: "", ids: "", passes: 5, recheckAll: false, verifyExisting: false });
  const [est, setEst] = React.useState<Estimate | null>(null);
  const [open, setOpen] = React.useState("");
  const [status, setStatus] = React.useState("NEEDS_REVIEW");
  const [items, setItems] = React.useState<{ total: number; rows: Item[] }>({ total: 0, rows: [] });
  const [showPasses, setShowPasses] = React.useState("");
  const [steps, setSteps] = React.useState<Step[] | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [quota, setQuota] = React.useState<Quota | null>(null);
  const [bench, setBench] = React.useState<Bench | null>(null);
  const [benching, setBenching] = React.useState(false);

  React.useEffect(() => {
    try { const u = JSON.parse(localStorage.getItem("ssc_user") || "null"); if (u?.role !== "ADMIN") { router.replace("/admin"); return; } } catch { router.replace("/dashboard"); return; }
    setOk(true);
  }, [router]);

  const load = React.useCallback(async () => {
    try { setOv(await api<Overview>("/admin/ai-jobs/overview")); setErr(""); } catch (e) { setErr((e as Error).message); }
  }, []);
  const loadItems = React.useCallback(async () => {
    if (!open) return;
    try { setItems(await api(`/admin/ai-jobs/${open}/items?status=${status}&take=25`)); } catch (e) { setErr((e as Error).message); }
  }, [open, status]);

  React.useEffect(() => { if (!ok) return; void load(); api<Meta>("/admin/ai-jobs/scope-meta").then(setMeta).catch(() => undefined); }, [ok, load]);
  React.useEffect(() => { if (!ok) return; const t = setInterval(() => { void load(); void loadItems(); }, 3000); return () => clearInterval(t); }, [ok, load, loadItems]);
  React.useEffect(() => { void loadItems(); }, [loadItems]);

  const loadStats = React.useCallback(async () => {
    try { setStats(await api<Stats>("/admin/ai-jobs/stats?days=7")); } catch { /* optional panel */ }
    try { setQuota(await api<Quota>("/admin/ai-jobs/key-quota")); } catch { /* optional panel */ }
  }, []);
  React.useEffect(() => { if (!ok) return; void loadStats(); api<{ result: Bench | null }>("/admin/ai-jobs/benchmark").then((r) => setBench(r.result)).catch(() => undefined); const t = setInterval(() => void loadStats(), 30000); return () => clearInterval(t); }, [ok, loadStats]);
  async function runBench() {
    setBenching(true);
    try { setBench((await api<Bench>("/admin/ai-jobs/benchmark", { method: "POST", body: JSON.stringify({}) }))); } catch (e) { setMsg({ ok: false, text: `Benchmark: ${(e as Error).message}` }); }
    setBenching(false);
  }

  const post = (path: string, body: unknown = {}) => api<Record<string, unknown>>(`/admin/ai-jobs${path}`, { method: "POST", body: JSON.stringify(body) });
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true); setMsg(null);
    try { const r = await fn(); setMsg({ ok: true, text: `${label} ✅ ${r && typeof r === "object" ? JSON.stringify(r).slice(0, 220) : ""}` }); await Promise.all([load(), loadItems()]); }
    catch (e) { setMsg({ ok: false, text: `${label}: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  };

  const scope = () => ({
    examId: f.examId || undefined, subjectId: f.subjectId || undefined, chapterId: f.chapterId || undefined,
    year: f.year ? Number(f.year) : undefined, batchId: f.batchId.trim() || undefined,
    ids: f.ids.split(/[\s,]+/).filter((x) => x.length > 8),
    recheckAll: f.recheckAll || undefined, verifyExisting: f.verifyExisting || undefined,
  });
  const chapters = (meta?.chapters ?? []).filter((c) => !f.subjectId || c.subjectId === f.subjectId);

  async function loopUntilDone(path: string, body: Record<string, unknown>, key: "remaining") {
    let guard = 0; let last: Record<string, unknown> = {};
    for (;;) {
      last = await post(path, body);
      const left = Number(last[key] ?? 0); const progress = Number(last.undone ?? last.processed ?? 0);
      if (!left || !progress || ++guard > 200) return last;
    }
  }

  async function runCheck() {
    setChecking(true); setSteps(null);
    try { const r = (await post("/system-check")) as unknown as { steps: Step[] }; setSteps(r.steps); } catch (e) { setMsg({ ok: false, text: `System Check: ${(e as Error).message}` }); }
    setChecking(false);
  }

  if (!ok) return null;
  const badge = ov?.health;
  const badgeCls = badge?.level === "green" ? "bg-emerald-500/15 text-emerald-700" : badge?.level === "yellow" ? "bg-amber-500/15 text-amber-700" : "bg-red-500/15 text-red-700";

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <a href="/admin" className="rounded-lg border border-border px-3 py-2 hover:bg-muted">← Admin</a>
        <h1 className="text-lg font-bold">AI Jobs</h1>
        {badge && <span className={`rounded-full px-3 py-1 font-medium ${badgeCls}`}>{badge.icon} {badge.text}</span>}
        <a href="/admin/api-keys" className="ml-auto rounded-lg border border-border px-3 py-2 hover:bg-muted">API Keys</a>
        <button disabled={checking} onClick={runCheck} className="rounded-lg bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50">{checking ? "Check chal raha…" : "🩺 AI System Check"}</button>
      </div>
      {err && <p className="rounded-lg bg-red-500/10 p-2 text-red-700">{err}</p>}
      {msg && <p className={`rounded-lg p-2 ${msg.ok ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-700"}`}>{msg.text}</p>}
      {ov && !ov.worker.enabled && <p className="rounded-lg bg-amber-500/10 p-2 text-amber-700">Worker band hai (AI_JOB_WORKER=off) — jobs nahi chalengi.</p>}
      {ov?.boot && <p className="text-xs text-muted-foreground">🔁 Last start: {ov.boot.line}{ov.worker.watchdogFixed ? ` · watchdog ne ${ov.worker.watchdogFixed} atke kaam theek kiye` : ""}</p>}
      {ov?.worker.lastMessage && <p className="text-xs text-muted-foreground">Worker: {ov.worker.lastMessage}{ov.worker.restSec > 0 ? ` (rest ${ov.worker.restSec}s)` : ""}</p>}

      {steps && (
        <section className="space-y-1 rounded-xl border border-border p-3">
          <h2 className="font-semibold">System Check (asli calls)</h2>
          {steps.map((s) => (
            <div key={s.id} className="rounded-lg bg-muted/40 p-2">
              <div>{s.ok === true ? "✅" : s.ok === false ? "❌" : "➖"} <b>{s.name}</b> <span className="text-xs text-muted-foreground">({(s.ms / 1000).toFixed(1)}s)</span></div>
              <div className="text-xs">{s.detail}</div>
              {s.fix && <div className="text-xs font-medium text-red-700">Kya karein: {s.fix}</div>}
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2 rounded-xl border border-border p-3">
        <h2 className="font-semibold">Keys — live</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {(ov?.live.keys ?? []).map((k) => (
            <div key={k.id} className="rounded-lg bg-muted/40 p-2">
              <div className="font-medium">{k.keyName} · {KEY_UI[k.state]}{k.state === "resting" ? ` (${k.restSec}s)` : ""}</div>
              {k.state === "working" && <div className="text-xs">{k.note || k.feature} · {k.model ?? "model…"} · {k.runningSec}s se</div>}
              {k.lastError && <div className="text-xs text-red-700">{k.lastError}</div>}
              {k.problem && <div className="text-xs text-amber-700">{k.problem}</div>}
              {(() => { const q = quota?.keys.find((x) => x.id === k.id)?.info; return q ? <div className="text-xs text-muted-foreground">Quota: used ${q.usage ?? "—"}{q.limit !== null ? ` / limit $${q.limit}` : ""}{q.remaining !== null ? ` · bacha $${q.remaining}` : ""}{q.isFree ? " · free tier" : ""}</div> : null; })()}
            </div>
          ))}
          {ov && ov.live.keys.length === 0 && <p className="text-red-700">Koi key nahi — API Keys me daalein.</p>}
        </div>
        {ov?.live.gateway.configured && <p className="text-xs">Gateway fallback: ✅ {ov.live.gateway.model}</p>}
        {(ov?.live.models.length ?? 0) > 0 && <p className="text-xs text-muted-foreground">Models: {ov!.live.models.slice(0, 5).map((m) => `${m.model.split("/").pop()} ${m.successRate ?? "–"}%${m.avgMs ? ` ${(m.avgMs / 1000).toFixed(1)}s` : ""}${m.skippedForSec ? " (skip)" : ""}`).join(" · ")}</p>}
      </section>

      <section className="space-y-2 rounded-xl border border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Quality + stats (7 din)</h2>
          <button disabled={benching} onClick={runBench} className="ml-auto rounded-lg border border-border px-3 py-1 hover:bg-muted disabled:opacity-50">{benching ? "Benchmark chal raha…" : "🎯 Quality benchmark (5 sawal)"}</button>
        </div>
        {bench && <div className={`rounded-lg p-2 ${bench.verdict === "good" ? "bg-emerald-500/10" : bench.verdict === "weak" ? "bg-amber-500/10" : "bg-red-500/10"}`}>
          <b>{bench.correct}/{bench.total} sahi ({bench.accuracyPct}%)</b> · avg {bench.avgSec}s · {new Date(bench.at).toLocaleString()}<br /><span className="text-xs">{bench.message}</span>
        </div>}
        {stats && <div className="grid gap-3 sm:grid-cols-2">
          <div><div className="text-xs font-medium">Feature-wise</div>{stats.features.slice(0, 10).map((x) => <div key={x.name} className="text-xs">{x.name}: ✅{x.ok} ❌{x.fail} ({x.successPct ?? "–"}%){x.avgMs ? ` · ${(x.avgMs / 1000).toFixed(1)}s` : ""}</div>)}</div>
          <div><div className="text-xs font-medium">Key-wise</div>{stats.keys.slice(0, 10).map((x) => <div key={x.name} className="text-xs">{x.name}: ✅{x.ok} ❌{x.fail} ({x.successPct ?? "–"}%)</div>)}</div>
          <div className="sm:col-span-2"><div className="text-xs font-medium">Fail kyun hue</div>{stats.failReasons.length === 0 ? <div className="text-xs text-muted-foreground">Koi fail nahi 🎉</div> : stats.failReasons.map((x) => <div key={x.reason} className="text-xs">{x.reason}: {x.count}</div>)}</div>
        </div>}
      </section>

      <section className="space-y-2 rounded-xl border border-border p-3">
        <h2 className="font-semibold">Naya job</h2>
        <select value={f.type} onChange={(e) => { setF({ ...f, type: e.target.value }); setEst(null); }} className="w-full rounded-lg border border-border bg-background p-2">
          {TYPES.map((t) => <option key={t.v} value={t.v}>{t.t}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">{TYPES.find((t) => t.v === f.type)?.hint}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <select value={f.examId} onChange={(e) => { setF({ ...f, examId: e.target.value }); setEst(null); }} className="rounded-lg border border-border bg-background p-2"><option value="">Exam: sab</option>{meta?.exams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <select value={f.subjectId} onChange={(e) => { setF({ ...f, subjectId: e.target.value, chapterId: "" }); setEst(null); }} className="rounded-lg border border-border bg-background p-2"><option value="">Subject: sab</option>{meta?.subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <select value={f.chapterId} onChange={(e) => { setF({ ...f, chapterId: e.target.value }); setEst(null); }} className="rounded-lg border border-border bg-background p-2"><option value="">Chapter: sab</option>{chapters.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <input value={f.year} onChange={(e) => { setF({ ...f, year: e.target.value }); setEst(null); }} placeholder="Year (optional)" inputMode="numeric" className="rounded-lg border border-border bg-background p-2" />
          <input value={f.batchId} onChange={(e) => { setF({ ...f, batchId: e.target.value }); setEst(null); }} placeholder="Upload batch id (optional)" className="rounded-lg border border-border bg-background p-2" />
          <select value={f.passes} onChange={(e) => setF({ ...f, passes: Number(e.target.value) })} className="rounded-lg border border-border bg-background p-2"><option value={5}>5 passes (≥3 agree)</option><option value={4}>4 passes</option><option value={3}>3 passes (≥2 agree)</option></select>
        </div>
        <textarea value={f.ids} onChange={(e) => { setF({ ...f, ids: e.target.value }); setEst(null); }} placeholder="Selected question ids (optional, space/comma se)" rows={2} className="w-full rounded-lg border border-border bg-background p-2" />
        {(f.type === "CHAPTER_TOPIC_CLASSIFY" || f.type === "ANSWER_KEY_VERIFY") && <label className="flex items-center gap-2"><input type="checkbox" checked={f.recheckAll} onChange={(e) => { setF({ ...f, recheckAll: e.target.checked }); setEst(null); }} /> Jo pehle se sahi/verified hain unhe bhi dobara check karo</label>}
        {f.type === "PYQ_DATE_SHIFT" && <label className="flex items-center gap-2"><input type="checkbox" checked={f.verifyExisting} onChange={(e) => { setF({ ...f, verifyExisting: e.target.checked }); setEst(null); }} /> Jinki date lagi hai unhe sirf verify karo</label>}
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => act("Estimate", async () => { const r = await post("/estimate", { type: f.type, scope: scope(), passes: f.passes }); setEst(r as unknown as Estimate); return undefined; })} className="rounded-lg border border-border px-3 py-2 hover:bg-muted">📊 Estimate</button>
          <button disabled={busy || !est || est.willProcess === 0} onClick={() => act("Job start", async () => { const r = await post("", { type: f.type, scope: scope(), passes: f.passes }); setEst(null); return { jobId: (r.job as { id: string } | null)?.id, duplicate: r.duplicate }; })} className="rounded-lg bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-40">▶ Start</button>
        </div>
        {est && <p className="rounded-lg bg-muted/50 p-2">{est.willProcess} questions · {est.calls} AI calls (max) · ~{fmt(est.etaSec)} · keys ready {est.keys.ready}/{est.keys.active} · {est.concurrency} saath<br /><span className="text-xs text-muted-foreground">{est.note}</span></p>}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Jobs</h2>
        {(ov?.jobs ?? []).map((j) => {
          const pct = j.total ? Math.round(((j.done + j.failed + j.review) / j.total) * 100) : 0;
          return (
            <div key={j.id} className="space-y-1 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <b>{j.title || j.label}</b><span>{ST[j.status] ?? j.status}</span>
                <button onClick={() => { setOpen(open === j.id ? "" : j.id); setShowPasses(""); }} className="ml-auto rounded-lg border border-border px-2 py-1 hover:bg-muted">{open === j.id ? "Band" : "Dekhein"}</button>
              </div>
              <div className="h-2 overflow-hidden rounded bg-muted"><div className="h-2 bg-emerald-500" style={{ width: `${pct}%` }} /></div>
              <div className="text-xs">{pct}% · {j.done} done · {j.review} review · {j.failed} failed / {j.total} · calls {j.calls}{j.status === "RUNNING" ? ` · ETA ${fmt(j.etaSec)}` : ""}</div>
              {j.current.map((c, i) => <div key={i} className="text-xs text-emerald-700">Q#{c.questionNo} · {c.stage} · pass {c.pass}/{c.passes} · {c.runningSec}s</div>)}
              {j.lastError && <div className="text-xs text-amber-700">{j.lastError}</div>}
              <div className="flex flex-wrap gap-2">
                {["PENDING", "RUNNING"].includes(j.status) && j.type !== "PYQ_DATE_SHIFT" && <button disabled={busy} onClick={() => act("Pause", () => post(`/${j.id}/pause`))} className="rounded-lg border border-border px-2 py-1">⏸ Pause</button>}
                {j.status === "PAUSED" && <button disabled={busy} onClick={() => act("Resume", () => post(`/${j.id}/resume`))} className="rounded-lg border border-border px-2 py-1">▶ Resume</button>}
                {["PENDING", "RUNNING", "PAUSED"].includes(j.status) && <button disabled={busy} onClick={() => confirm("Job cancel karein?") && act("Cancel", () => post(`/${j.id}/cancel`))} className="rounded-lg border border-border px-2 py-1">🚫 Cancel</button>}
                {j.failed > 0 && <button disabled={busy} onClick={() => act("Retry failed", () => post(`/${j.id}/retry-failed`))} className="rounded-lg border border-border px-2 py-1">🔁 Failed dobara</button>}
                {j.review > 0 && <button disabled={busy} onClick={() => confirm(`${j.review} review items accept karein?`) && act("Accept all", () => loopUntilDone(`/${j.id}/accept-all`, {}, "remaining"))} className="rounded-lg border border-border px-2 py-1">✅ Sab accept</button>}
                {j.review > 0 && <button disabled={busy} onClick={() => confirm("Sab reject?") && act("Reject all", () => loopUntilDone(`/${j.id}/reject-all`, {}, "remaining"))} className="rounded-lg border border-border px-2 py-1">✖ Sab reject</button>}
                <button disabled={busy} onClick={() => confirm("Is job ke SAARE AI changes Undo karein? (jo baad me edit hue woh chhod diye jayenge)") && act("Undo job", () => loopUntilDone("/undo", { jobId: j.id }, "remaining"))} className="rounded-lg border border-border px-2 py-1">↩ Job Undo</button>
              </div>
              {open === j.id && (
                <div className="space-y-2 pt-2">
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-border bg-background p-1">
                    {["NEEDS_REVIEW", "DONE", "ACCEPTED", "FAILED", "SKIPPED", "REJECTED", "PENDING", "RUNNING"].map((s) => <option key={s} value={s}>{ST[s]}</option>)}
                  </select>
                  <span className="text-xs"> {items.total} items</span>
                  {items.rows.map((it) => (
                    <div key={it.id} className="rounded-lg bg-muted/40 p-2">
                      <div className="text-xs"><b>Q#{it.questionNo}</b> · {it.question}</div>
                      {it.note && <div className="text-xs">{it.note}</div>}
                      {it.lastError && <div className="text-xs text-red-700">{it.lastError}</div>}
                      {it.proposal && <div className="break-words text-xs text-muted-foreground">{JSON.stringify(it.proposal).slice(0, 300)}</div>}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {it.status === "NEEDS_REVIEW" && <button disabled={busy} onClick={() => act("Accept", () => post(`/items/${it.id}/accept`))} className="rounded-lg border border-border px-2 py-1">✅ Accept</button>}
                        {it.status === "NEEDS_REVIEW" && <button disabled={busy} onClick={() => act("Reject", () => post(`/items/${it.id}/reject`))} className="rounded-lg border border-border px-2 py-1">✖ Reject</button>}
                        {["DONE", "ACCEPTED"].includes(it.status) && <button disabled={busy} onClick={() => act("Undo", () => post("/undo", { itemIds: [it.id] }))} className="rounded-lg border border-border px-2 py-1">↩ Undo</button>}
                        {it.passes && <button onClick={() => setShowPasses(showPasses === it.id ? "" : it.id)} className="rounded-lg border border-border px-2 py-1">Passes ({it.agree}/{it.passesDone})</button>}
                      </div>
                      {showPasses === it.id && it.passes?.map((p) => <div key={p.i} className="text-xs">#{p.i + 1} {p.stage}: {p.ok ? `✅ ${p.vote ?? "ok"}` : `❌ ${p.error ?? ""}`}</div>)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {ov && ov.jobs.length === 0 && <p className="text-muted-foreground">Abhi koi job nahi.</p>}
      </section>

      <section className="space-y-1 rounded-xl border border-border p-3">
        <h2 className="font-semibold">Pichhli 25 AI calls</h2>
        {(ov?.live.recent ?? []).map((e, i) => <div key={i} className="text-xs">{e.success ? "✅" : "❌"} {new Date(e.at).toLocaleTimeString()} · {e.keyName} · {e.feature} · {e.model?.split("/").pop() ?? "—"} · {(e.ms / 1000).toFixed(1)}s{e.error ? ` · ${e.error}` : ""}</div>)}
      </section>
    </main>
  );
}
