"use client";

// Duplicate Review (NEW — Oct 6 2026)
//
// "jo duplicate question admin dalta hai ... question, options, solution, shift sab exactly same ho to
//  admin ke review me jaye; admin ek rakhe (purana ya naya) ya dono rakhe."
//
// Upload / "add one question" / bank scan queue every same-question pair here. Left = the question
// already in the bank (old). Right = the new upload row (UPLOAD mode) or the second bank question
// (SCAN mode). Fields that differ are highlighted. "Hatana" always means HIDE (restorable from the
// Question Manager), never a hard delete.
//
// Backend: /bank/admin/duplicates/* (DuplicateReviewController).

import * as React from "react";
import { useRouter } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";

type Opt = { key: string; text: string; textHi: string; imageUrl: string | null };
type QView = {
  id: string | null;
  questionNo: number | null;
  source: "BANK" | "UPLOAD";
  isLive: boolean;
  isHidden: boolean;
  questionText: string;
  questionTextHindi: string;
  questionImageUrl: string | null;
  options: Opt[];
  correctAnswer: string;
  explanation: string;
  explanationHindi: string;
  examName: string | null;
  subjectName: string | null;
  chapterName: string | null;
  year: number | null;
  shift: string | null;
  examDate: string | null;
  paperCode: string | null;
};
type Item = {
  id: string;
  status: string;
  matchType: "EXACT" | "SIMILAR";
  mode: "UPLOAD" | "SCAN";
  differences: string[];
  differenceLabels: string[];
  sourceRow: number | null;
  uploadBatchId: string | null;
  createdAt: string;
  left: QView | null;
  right: QView | null;
  leftMissing: boolean;
};
type Counts = { pendingExact: number; pendingSimilar: number; pending: number; resolved: number };
type Action = "KEEP_EXISTING" | "KEEP_NEW" | "KEEP_BOTH";
type Tab = "EXACT" | "SIMILAR" | "RESOLVED";

const PAGE = 20;

const STATUS_TEXT: Record<string, string> = {
  PENDING: "Pending",
  KEPT_EXISTING: "Purana rakha",
  KEPT_NEW: "Naya rakha",
  KEPT_BOTH: "Dono rakhe",
};

function Field({ label, diff, children }: { label: string; diff: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-md px-2 py-1 ${diff ? "bg-amber-500/15 ring-1 ring-amber-500/60" : ""}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        {diff ? " · ALAG" : ""}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function QuestionColumn({ title, q, diffs, missing }: { title: string; q: QView | null; diffs: Set<string>; missing?: boolean }) {
  if (!q) {
    return (
      <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
        <div className="mb-1 font-semibold">{title}</div>
        {missing ? "Ye question ab database me nahi hai (delete ho gaya)." : "Is side ka question abhi pending hai."}
      </div>
    );
  }
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">{title}</span>
        {q.questionNo != null && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">Q#{q.questionNo}</span>}
        {q.isHidden && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] text-red-600">Hidden</span>}
        {q.source === "BANK" && q.isLive && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-600">Live</span>}
        {q.source === "UPLOAD" && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] text-sky-600">Abhi save nahi hua</span>}
      </div>
      <div className="text-[11px] text-muted-foreground">
        {[q.examName, q.subjectName, q.chapterName].filter(Boolean).join(" › ") || "—"}
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Field label="Exam" diff={diffs.has("examId")}>{q.examName ?? "—"}</Field>
        <Field label="Year" diff={diffs.has("year")}>{q.year ?? "—"}</Field>
        <Field label="Shift" diff={diffs.has("shift")}>{q.shift ?? "—"}</Field>
        <Field label="Date" diff={diffs.has("examDate")}>{q.examDate ?? "—"}</Field>
      </div>
      {q.paperCode && <Field label="Paper code" diff={diffs.has("paperCode")}>{q.paperCode}</Field>}
      <Field label="Question" diff={diffs.has("questionText") || diffs.has("questionImageUrl")}>
        {q.questionImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={q.questionImageUrl} alt="question" className="mb-1 max-h-40 rounded border border-border" />
        )}
        <span className="whitespace-pre-wrap">{q.questionText || "(image question)"}</span>
      </Field>
      {q.questionTextHindi && (
        <Field label="Question (Hindi)" diff={diffs.has("questionTextHindi")}>
          <span className="whitespace-pre-wrap">{q.questionTextHindi}</span>
        </Field>
      )}
      <Field label="Options" diff={diffs.has("options") || diffs.has("correctAnswer")}>
        <ul className="space-y-0.5">
          {q.options.map((o) => (
            <li key={o.key} className={o.key === q.correctAnswer ? "font-semibold text-emerald-600 dark:text-emerald-400" : ""}>
              {o.key}. {o.text || (o.imageUrl ? "(image)" : "")}
              {o.textHi ? <span className="text-muted-foreground"> · {o.textHi}</span> : null}
              {o.key === q.correctAnswer ? " ✓" : ""}
            </li>
          ))}
        </ul>
      </Field>
      <Field label="Solution" diff={diffs.has("explanation") || diffs.has("explanationHindi")}>
        {q.explanation || q.explanationHindi ? (
          <details>
            <summary className="cursor-pointer text-xs text-primary">Solution dekhein</summary>
            <p className="mt-1 whitespace-pre-wrap text-xs">{q.explanation}</p>
            {q.explanationHindi && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{q.explanationHindi}</p>}
          </details>
        ) : (
          <span className="text-xs text-muted-foreground">Solution nahi hai</span>
        )}
      </Field>
    </div>
  );
}

export default function DuplicateReviewPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>("EXACT");
  const [counts, setCounts] = React.useState<Counts | null>(null);
  const [items, setItems] = React.useState<Item[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [msg, setMsg] = React.useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [scanBusy, setScanBusy] = React.useState(false);
  const [includeSimilar, setIncludeSimilar] = React.useState(false);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem("ssc_user");
      const user = raw ? JSON.parse(raw) : null;
      if (!(user?.role === "ADMIN" || user?.role === "MODERATOR")) { router.replace("/dashboard"); return; }
    } catch { router.replace("/dashboard"); return; }
    setAuthChecked(true);
  }, [router]);

  const loadCounts = React.useCallback(async () => {
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/duplicates/counts`);
      if (r.ok) setCounts(await r.json());
    } catch { /* ignore */ }
  }, []);

  const load = React.useCallback(async (p: number, t: Tab) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ skip: String(p * PAGE), take: String(PAGE) });
      if (t === "RESOLVED") qs.set("status", "RESOLVED");
      else { qs.set("status", "PENDING"); qs.set("matchType", t); }
      const r = await fetchAuth(`${API_BASE}/bank/admin/duplicates?${qs.toString()}`);
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.message || `HTTP ${r.status}`);
      setItems(Array.isArray(d.items) ? d.items : []);
      setTotal(d.total ?? 0);
      setSelected(new Set());
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "List load nahi hui" });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { if (authChecked) { loadCounts(); } }, [authChecked, loadCounts]);
  React.useEffect(() => { if (authChecked) { setPage(0); load(0, tab); } }, [authChecked, tab, load]);

  const refreshAll = async (p = page) => { await Promise.all([load(p, tab), loadCounts()]); };

  const resolveOne = async (id: string, action: Action) => {
    setBusyId(id);
    setMsg(null);
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/duplicates/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(Array.isArray(d?.message) ? d.message.join("; ") : d?.message || `HTTP ${r.status}`);
      setMsg({ type: "ok", text: "Decision save ho gaya." });
      await refreshAll(items.length === 1 && page > 0 ? page - 1 : page);
      if (items.length === 1 && page > 0) setPage(page - 1);
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusyId(null);
    }
  };

  const bulk = async (action: Action, mode: "selected" | "all") => {
    const label = action === "KEEP_EXISTING" ? "purana rakho" : action === "KEEP_NEW" ? "naya rakho" : "dono rakho";
    const count = mode === "selected" ? selected.size : total;
    if (count === 0) return;
    const scope = mode === "selected" ? `${count} selected` : `is tab ke sabhi ${count}`;
    if (!window.confirm(`${scope} duplicate par "${label}" lagana hai?`)) return;
    setBulkBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { action };
      if (mode === "selected") body.ids = Array.from(selected);
      else { body.confirm = true; if (tab !== "RESOLVED") body.matchType = tab; }
      const r = await fetchAuth(`${API_BASE}/bank/admin/duplicates/bulk-resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(Array.isArray(d?.message) ? d.message.join("; ") : d?.message || `HTTP ${r.status}`);
      setMsg({ type: d.failed ? "err" : "ok", text: `${d.done} duplicate resolve hue${d.failed ? `, ${d.failed} fail` : ""}${d.capped ? " (ek baar me max 2000 — dobara chalayein)" : ""}.` });
      setPage(0);
      await refreshAll(0);
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBulkBusy(false);
    }
  };

  const scan = async () => {
    setScanBusy(true);
    setMsg(null);
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/duplicates/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeSimilar }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.message || `HTTP ${r.status}`);
      setMsg({ type: "ok", text: `Scan complete: ${d.groupsChecked} group check hue, ${d.queued} naye duplicate review me aaye${d.alreadyReviewed ? `, ${d.alreadyReviewed} pehle se reviewed` : ""}${d.similarSkipped ? `, ${d.similarSkipped} alag-shift/year wale chhode (normal repeat)` : ""}.` });
      await refreshAll(0);
      setPage(0);
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Scan failed" });
    } finally {
      setScanBusy(false);
    }
  };

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOnPage = items.length > 0 && items.every((i) => selected.has(i.id));
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(items.map((i) => i.id)));
  const pages = Math.max(1, Math.ceil(total / PAGE));

  if (!authChecked) return null;

  const tabBtn = (t: Tab, label: string, n?: number) => (
    <button
      key={t}
      onClick={() => setTab(t)}
      className={`rounded-lg border px-3 py-2 text-sm font-semibold ${tab === t ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
    >
      {label}{n != null ? ` (${n})` : ""}
    </button>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground">← Admin</a>
          <h1 className="text-lg font-bold">🧬 Duplicate Review</h1>
          <a href="/admin/questions/manage" className="ml-auto rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Question Manager</a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-4">
        <p className="text-sm text-muted-foreground">
          Jo question pehle se bank me hai wahi dobara upload ho to wo yahan aata hai. <strong>Exact</strong> = question, options, solution,
          year/shift sab same. <strong>Milte-julte</strong> = question same, par solution / shift / year jaisi koi detail alag.
          Har ek me chunein: purana rakho, naya rakho ya dono. Jo &quot;hatta&quot; hai wo sirf hide hota hai (Question Manager me wapas laa sakte hain).
        </p>

        {msg && (
          <div className={`rounded-lg border p-3 text-sm ${msg.type === "ok" ? "border-emerald-500/40 bg-emerald-500/10" : "border-red-500/40 bg-red-500/10"}`}>{msg.text}</div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {tabBtn("EXACT", "Exact same", counts?.pendingExact)}
          {tabBtn("SIMILAR", "Milte-julte", counts?.pendingSimilar)}
          {tabBtn("RESOLVED", "Ho chuke", counts?.resolved)}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input type="checkbox" checked={includeSimilar} onChange={(e) => setIncludeSimilar(e.target.checked)} /> scan me milte-julte bhi
            </label>
            <button onClick={scan} disabled={scanBusy} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:border-primary disabled:opacity-40">
              {scanBusy ? "Scan ho raha hai…" : "🔎 Bank me purane duplicates dhundo"}
            </button>
          </div>
        </div>

        {tab !== "RESOLVED" && items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2 text-xs">
            <label className="flex items-center gap-1"><input type="checkbox" checked={allOnPage} onChange={toggleAll} /> Page ke sab chunein</label>
            <span className="text-muted-foreground">{selected.size} selected</span>
            <div className="ml-auto flex flex-wrap gap-1.5">
              <button disabled={bulkBusy || selected.size === 0} onClick={() => bulk("KEEP_EXISTING", "selected")} className="rounded border border-border px-2 py-1 font-semibold disabled:opacity-40">Selected: purana rakho</button>
              <button disabled={bulkBusy || selected.size === 0} onClick={() => bulk("KEEP_NEW", "selected")} className="rounded border border-border px-2 py-1 font-semibold disabled:opacity-40">Selected: naya rakho</button>
              <button disabled={bulkBusy || selected.size === 0} onClick={() => bulk("KEEP_BOTH", "selected")} className="rounded border border-border px-2 py-1 font-semibold disabled:opacity-40">Selected: dono rakho</button>
              <button disabled={bulkBusy || total === 0} onClick={() => bulk(tab === "SIMILAR" ? "KEEP_BOTH" : "KEEP_EXISTING", "all")} className="rounded border border-primary/50 bg-primary/10 px-2 py-1 font-semibold text-primary disabled:opacity-40">
                {tab === "SIMILAR" ? `Is tab ke sabhi ${total}: dono rakho` : `Is tab ke sabhi ${total}: purana rakho`}
              </button>
            </div>
          </div>
        )}

        {loading && <p className="text-sm text-muted-foreground">Load ho raha hai…</p>}
        {!loading && items.length === 0 && (
          <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
            {tab === "RESOLVED" ? "Abhi koi resolved duplicate nahi." : "🎉 Review ke liye koi duplicate pending nahi."}
          </div>
        )}

        {items.map((it) => {
          const diffs = new Set(it.differences);
          const upload = it.mode === "UPLOAD";
          const leftTitle = upload ? "Purana (bank me)" : "Question A (purana)";
          const rightTitle = upload ? `Naya (upload${it.sourceRow ? ` · row ${it.sourceRow}` : ""})` : "Question B";
          const pending = it.status === "PENDING";
          const busy = busyId === it.id || bulkBusy;
          return (
            <section key={it.id} className="space-y-3 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                {pending && tab !== "RESOLVED" && <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} />}
                <span className={`rounded px-2 py-0.5 text-xs font-bold ${it.matchType === "EXACT" ? "bg-red-500/15 text-red-600" : "bg-amber-500/15 text-amber-700"}`}>
                  {it.matchType === "EXACT" ? "EXACT SAME" : "MILTA-JULTA"}
                </span>
                <span className="rounded bg-muted px-2 py-0.5 text-[11px]">{upload ? "Upload" : "Bank scan"}</span>
                {!pending && <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{STATUS_TEXT[it.status] ?? it.status}</span>}
                {it.differenceLabels.length > 0 && (
                  <span className="text-xs text-amber-700 dark:text-amber-400">Alag: {it.differenceLabels.join(", ")}</span>
                )}
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <QuestionColumn title={leftTitle} q={it.left} diffs={diffs} missing={it.leftMissing} />
                <QuestionColumn title={rightTitle} q={it.right} diffs={diffs} />
              </div>

              {pending && (
                <div className="flex flex-wrap gap-2">
                  <button disabled={busy} onClick={() => resolveOne(it.id, "KEEP_EXISTING")} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:border-primary disabled:opacity-40">
                    {upload ? "✅ Purana rakho (naya hatao)" : "✅ A rakho (B hide)"}
                  </button>
                  <button disabled={busy} onClick={() => resolveOne(it.id, "KEEP_NEW")} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:border-primary disabled:opacity-40">
                    {upload ? "🔄 Naya rakho (purana hatao)" : "🔄 B rakho (A hide)"}
                  </button>
                  <button disabled={busy} onClick={() => resolveOne(it.id, "KEEP_BOTH")} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">
                    ➕ Dono rakho
                  </button>
                  {busyId === it.id && <span className="self-center text-xs text-muted-foreground">Please wait…</span>}
                </div>
              )}
            </section>
          );
        })}

        {total > PAGE && (
          <div className="flex items-center justify-center gap-3 pb-8 text-sm">
            <button disabled={page === 0 || loading} onClick={() => { const p = page - 1; setPage(p); load(p, tab); }} className="rounded border border-border px-3 py-1 disabled:opacity-40">← Pichla</button>
            <span>{page + 1} / {pages}</span>
            <button disabled={page + 1 >= pages || loading} onClick={() => { const p = page + 1; setPage(p); load(p, tab); }} className="rounded border border-border px-3 py-1 disabled:opacity-40">Agla →</button>
          </div>
        )}
      </main>
    </div>
  );
}
