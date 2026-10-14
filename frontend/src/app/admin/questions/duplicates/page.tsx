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
  // NEW (Oct 14 2026): "select all" across ALL pages (not only the 20 on screen).
  // allMode = every duplicate matching the current tab/filter is selected; `excluded` = ones the admin un-ticked.
  const [allMode, setAllMode] = React.useState(false);
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set());
  const [msg, setMsg] = React.useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [scanBusy, setScanBusy] = React.useState(false);
  const [includeSimilar, setIncludeSimilar] = React.useState(false);
  // NEW (Oct 14 2026): "Ho chuke" tab can be narrowed to what was decided, and every decision can be undone
  const [resolvedFilter, setResolvedFilter] = React.useState<"" | "KEPT_NEW" | "KEPT_EXISTING" | "KEPT_BOTH">("");
  // ?batch=<uploadId> comes from the Upload History ("Duplicate review" column)
  const [batchId, setBatchId] = React.useState("");
  React.useEffect(() => {
    const b = new URLSearchParams(window.location.search).get("batch");
    if (b) setBatchId(b);
  }, []);

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

  const load = React.useCallback(async (p: number, t: Tab, batch: string = batchId, rf: string = resolvedFilter) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ skip: String(p * PAGE), take: String(PAGE) });
      if (t === "RESOLVED") { qs.set("status", "RESOLVED"); if (rf) qs.set("resolvedStatus", rf); }
      else { qs.set("status", "PENDING"); qs.set("matchType", t); }
      if (batch) qs.set("batchId", batch);
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
  }, [batchId, resolvedFilter]);

  React.useEffect(() => { if (authChecked) { loadCounts(); } }, [authChecked, loadCounts]);
  React.useEffect(() => { if (authChecked) { setPage(0); load(0, tab); } }, [authChecked, tab, load]);

  React.useEffect(() => { setAllMode(false); setExcluded(new Set()); setSelected(new Set()); }, [tab, resolvedFilter, batchId]);

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

  // Runs bulk-resolve again and again (the server handles ~40 s of work per call) until nothing is left.
  // publish=true makes every kept NEW question live at once. `scopeAll` = every pending duplicate (Exact + Milte-julte).
  const bulk = async (action: Action, mode: "selected" | "all", opts: { publish?: boolean; scopeAll?: boolean } = {}) => {
    const label = action === "KEEP_EXISTING" ? "purana rakho" : action === "KEEP_NEW" ? "naya rakho" : "dono rakho";
    const pendingAll = (counts?.pending ?? total);
    const effTotal = allMode ? Math.max(total - excluded.size, 0) : total;
    const count = mode === "selected" ? selected.size : opts.scopeAll ? pendingAll : effTotal;
    if (count === 0) return;
    const scope = mode === "selected" ? `${count} selected` : opts.scopeAll ? `sabhi ${count} pending` : `is tab ke sabhi ${count}`;
    const extra = opts.publish ? " aur naye questions PUBLISH (live)" : "";
    if (!window.confirm(`${scope} duplicate par "${label}"${extra} lagana hai?`)) return;
    setBulkBusy(true);
    setMsg(null);
    let done = 0;
    let failed = 0;
    let firstErr = "";
    // un-ticked items of an "all pages" selection are never touched
    const skipIds: string[] = mode === "all" && allMode && !opts.scopeAll ? Array.from(excluded) : [];
    try {
      if (mode === "selected") {
        // chunks of 300 so one request stays short
        const ids = Array.from(selected);
        for (let i = 0; i < ids.length; i += 300) {
          const r = await fetchAuth(`${API_BASE}/bank/admin/duplicates/bulk-resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, ids: ids.slice(i, i + 300), publish: !!opts.publish }),
          });
          const d = await r.json().catch(() => null);
          if (!r.ok) throw new Error(Array.isArray(d?.message) ? d.message.join("; ") : d?.message || `HTTP ${r.status}`);
          done += d.done ?? 0;
          failed += d.failed ?? 0;
          if (!firstErr && d.errors?.[0]?.error) firstErr = d.errors[0].error;
          setMsg({ type: "ok", text: `Ho raha hai… ${done} / ${ids.length}` });
        }
      } else {
        for (let round = 0; round < 1000; round++) {
          const body: Record<string, unknown> = { action, confirm: true, publish: !!opts.publish, skipIds };
          if (!opts.scopeAll && tab !== "RESOLVED") body.matchType = tab;
          if (batchId) body.batchId = batchId;
          const r = await fetchAuth(`${API_BASE}/bank/admin/duplicates/bulk-resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const d = await r.json().catch(() => null);
          if (!r.ok) throw new Error(Array.isArray(d?.message) ? d.message.join("; ") : d?.message || `HTTP ${r.status}`);
          done += d.done ?? 0;
          failed += d.failed ?? 0;
          if (!firstErr && d.errors?.[0]?.error) firstErr = d.errors[0].error;
          if (Array.isArray(d.failedIds)) skipIds.push(...d.failedIds);
          setMsg({ type: "ok", text: `Ho raha hai… ${done} ho gaye, ${d.remaining ?? 0} baaki${failed ? `, ${failed} fail` : ""}` });
          if (!d.remaining || (d.done ?? 0) === 0) break;
        }
      }
      setMsg({
        type: failed ? "err" : "ok",
        text: `✅ ${done} duplicate resolve hue${opts.publish ? " (naye questions publish)" : ""}${failed ? `, ${failed} fail — pehla karan: ${firstErr}` : ""}.`,
      });
      setPage(0);
      await refreshAll(0);
    } catch (e) {
      setMsg({ type: "err", text: `${done} ho chuke, phir ruk gaya: ${e instanceof Error ? e.message : "Failed"}` });
      await refreshAll(0);
    } finally {
      setBulkBusy(false);
      setAllMode(false);
      setExcluded(new Set());
    }
  };

  // ---- UNDO (NEW Oct 14 2026): a resolved duplicate goes back to Pending — new question hidden, old one live again
  const undoOne = async (id: string) => {
    if (!window.confirm("Is decision ko undo karein? Naya question hide hoga, purana wapas live hoga, aur ye duplicate dobara Pending me aa jayega.")) return;
    setBusyId(id);
    setMsg(null);
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/duplicates/${id}/undo`, { method: "POST" });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(Array.isArray(d?.message) ? d.message.join("; ") : d?.message || `HTTP ${r.status}`);
      setMsg({ type: "ok", text: `↩️ Undo ho gaya${d?.restoredQuestionId ? " — purana question wapas live" : ""}${d?.hiddenQuestionId ? " — naya question hide" : ""}. Ye duplicate ab Pending me hai.` });
      await refreshAll(items.length === 1 && page > 0 ? page - 1 : page);
      if (items.length === 1 && page > 0) setPage(page - 1);
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Undo failed" });
    } finally {
      setBusyId(null);
    }
  };

  // runs bulk-undo again and again (server does ~40 s of work per call) until nothing is left
  const undoBulk = async (mode: "selected" | "all") => {
    const effTotal = allMode ? Math.max(total - excluded.size, 0) : total;
    const count = mode === "selected" ? selected.size : effTotal;
    if (count === 0) return;
    const scope = mode === "selected" ? `${count} selected` : `is list ke sabhi ${count}`;
    if (!window.confirm(`${scope} resolved duplicates UNDO karein?\nNaye questions hide honge, purane wapas live honge, aur ye sab dobara Pending me aayenge.`)) return;
    setBulkBusy(true);
    setMsg(null);
    let done = 0;
    let failed = 0;
    let firstErr = "";
    const skipIds: string[] = mode === "all" && allMode ? Array.from(excluded) : [];
    try {
      if (mode === "selected") {
        const ids = Array.from(selected);
        for (let i = 0; i < ids.length; i += 300) {
          const r = await fetchAuth(`${API_BASE}/bank/admin/duplicates/bulk-undo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: ids.slice(i, i + 300) }),
          });
          const d = await r.json().catch(() => null);
          if (!r.ok) throw new Error(Array.isArray(d?.message) ? d.message.join("; ") : d?.message || `HTTP ${r.status}`);
          done += d.done ?? 0;
          failed += d.failed ?? 0;
          if (!firstErr && d.errors?.[0]?.error) firstErr = d.errors[0].error;
          setMsg({ type: "ok", text: `Undo ho raha hai… ${done} / ${ids.length}` });
        }
      } else {
        for (let round = 0; round < 1000; round++) {
          const body: Record<string, unknown> = { confirm: true, skipIds };
          if (resolvedFilter) body.resolvedStatus = resolvedFilter;
          if (batchId) body.batchId = batchId;
          const r = await fetchAuth(`${API_BASE}/bank/admin/duplicates/bulk-undo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const d = await r.json().catch(() => null);
          if (!r.ok) throw new Error(Array.isArray(d?.message) ? d.message.join("; ") : d?.message || `HTTP ${r.status}`);
          done += d.done ?? 0;
          failed += d.failed ?? 0;
          if (!firstErr && d.errors?.[0]?.error) firstErr = d.errors[0].error;
          if (Array.isArray(d.failedIds)) skipIds.push(...d.failedIds);
          setMsg({ type: "ok", text: `Undo ho raha hai… ${done} ho gaye, ${d.remaining ?? 0} baaki${failed ? `, ${failed} fail` : ""}` });
          if (!d.remaining || (d.done ?? 0) === 0) break;
        }
      }
      setMsg({
        type: failed ? "err" : "ok",
        text: `↩️ ${done} duplicate undo hue (ab Pending me hain)${failed ? `, ${failed} fail — pehla karan: ${firstErr}` : ""}.`,
      });
      setPage(0);
      await refreshAll(0);
    } catch (e) {
      setMsg({ type: "err", text: `${done} undo ho chuke, phir ruk gaya: ${e instanceof Error ? e.message : "Failed"}` });
      await refreshAll(0);
    } finally {
      setBulkBusy(false);
      setAllMode(false);
      setExcluded(new Set());
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

  const isChecked = (id: string) => (allMode ? !excluded.has(id) : selected.has(id));
  const flip = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };
  const toggle = (id: string) => { if (allMode) setExcluded((e) => flip(e, id)); else setSelected((x) => flip(x, id)); };
  const allOnPage = items.length > 0 && items.every((i) => isChecked(i.id));
  const toggleAll = () => {
    if (allMode) {
      // un-tick / re-tick the whole page inside an "all pages" selection
      setExcluded((e) => { const n = new Set(e); for (const i of items) { if (allOnPage) n.add(i.id); else n.delete(i.id); } return n; });
      return;
    }
    setSelected(allOnPage ? new Set() : new Set(items.map((i) => i.id)));
  };
  const selectedCount = allMode ? Math.max(total - excluded.size, 0) : selected.size;
  // act on the selection: "all pages" selection goes through the server-side filter (with the un-ticked ones skipped)
  const bulkSel = (action: Action, opts: { publish?: boolean } = {}) => (allMode ? bulk(action, "all", opts) : bulk(action, "selected", opts));
  const undoSel = () => (allMode ? undoBulk("all") : undoBulk("selected"));
  const selectBanner = (
    <>
      {!allMode && allOnPage && total > items.length && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-primary/40 bg-primary/10 px-2 py-1.5 text-xs">
          Is page ke {items.length} chune gaye hain.
          <button onClick={() => { setAllMode(true); setExcluded(new Set()); }} className="rounded bg-primary px-2 py-1 font-bold text-primary-foreground">Sabhi {total} chunein (saare pages)</button>
        </div>
      )}
      {allMode && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-primary/40 bg-primary/10 px-2 py-1.5 text-xs">
          ✅ Saare pages ke <b>{selectedCount}</b> chune gaye hain{excluded.size > 0 ? ` (${excluded.size} aapne hataye)` : ""}.
          <button onClick={() => { setAllMode(false); setExcluded(new Set()); setSelected(new Set()); }} className="rounded border border-border px-2 py-1 font-semibold">Selection hatao</button>
        </div>
      )}
    </>
  );
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

        {batchId && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
            Sirf ek upload ke duplicates dikh rahe hain.
            <a href="/admin/questions/duplicates" className="font-semibold text-primary underline">Sabhi duplicates dekhein</a>
          </div>
        )}

        {msg && (
          <div className={`rounded-lg border p-3 text-sm ${msg.type === "ok" ? "border-emerald-500/40 bg-emerald-500/10" : "border-red-500/40 bg-red-500/10"}`}>{msg.text}</div>
        )}

        {(counts?.pending ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-primary/50 bg-primary/5 p-3">
            <div className="min-w-[220px] flex-1 text-sm">
              <div className="font-bold">⚡ Ek click: sabhi {counts?.pending} duplicates me NAYA (latest) rakho</div>
              <div className="text-xs text-muted-foreground">Purana hide ho jayega (Question Manager se wapas aa sakta hai), naya question save + publish ho jayega. Exact aur Milte-julte dono.</div>
            </div>
            <button
              disabled={bulkBusy}
              onClick={() => bulk("KEEP_NEW", "all", { publish: true, scopeAll: true })}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-40"
            >
              {bulkBusy ? "Ho raha hai…" : "✅ Sab naya rakho + Publish"}
            </button>
          </div>
        )}

        {(counts?.resolved ?? 0) > 0 && tab !== "RESOLVED" && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <span>Galti se decision/publish ho gaya? {counts?.resolved} resolved duplicates ko <b>Undo</b> kar sakte hain.</span>
            <button onClick={() => setTab("RESOLVED")} className="rounded-lg border border-amber-500/60 px-3 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">↩️ Ho chuke dekhein / Undo</button>
          </div>
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

        {tab === "RESOLVED" && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">Kya decide hua tha:</span>
              {([["", "Sab"], ["KEPT_NEW", "Naya rakha"], ["KEPT_EXISTING", "Purana rakha"], ["KEPT_BOTH", "Dono rakhe"]] as const).map(([v, l]) => (
                <button key={v || "all"} onClick={() => setResolvedFilter(v)} className={`rounded border px-2 py-1 font-semibold ${resolvedFilter === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{l}</button>
              ))}
            </div>
            {items.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1"><input type="checkbox" checked={allOnPage} onChange={toggleAll} /> Page ke sab chunein</label>
                <span className="text-muted-foreground">{selectedCount} selected</span>
                <div className="ml-auto flex flex-wrap gap-1.5">
                  <button disabled={bulkBusy || selectedCount === 0} onClick={undoSel} className="rounded border border-border px-2 py-1 font-semibold disabled:opacity-40">↩️ Selected ({selectedCount}): Undo</button>
                  <button disabled={bulkBusy || total === 0} onClick={() => undoBulk("all")} className="rounded border border-amber-500/60 bg-amber-500/10 px-2 py-1 font-semibold text-amber-700 disabled:opacity-40 dark:text-amber-400">↩️ Is list ke sabhi {total}: Undo</button>
                </div>
              </div>
            )}
            {selectBanner}
            <p className="text-[11px] text-muted-foreground">Undo = naya (publish hua) question hide, purana (hide hua) question wapas live, aur duplicate dobara Pending me — phir aap naya decision le sakte hain.</p>
          </div>
        )}

        {tab !== "RESOLVED" && items.length > 0 && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2 text-xs">
          {selectBanner}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1"><input type="checkbox" checked={allOnPage} onChange={toggleAll} /> Page ke sab chunein</label>
            <span className="text-muted-foreground">{selectedCount} selected</span>
            <div className="ml-auto flex flex-wrap gap-1.5">
              <button disabled={bulkBusy || selectedCount === 0} onClick={() => bulkSel("KEEP_EXISTING")} className="rounded border border-border px-2 py-1 font-semibold disabled:opacity-40">Selected: purana rakho</button>
              <button disabled={bulkBusy || selectedCount === 0} onClick={() => bulkSel("KEEP_NEW", { publish: true })} className="rounded border border-primary/50 bg-primary/10 px-2 py-1 font-semibold text-primary disabled:opacity-40">Selected ({selectedCount}): naya rakho + Publish</button>
              <button disabled={bulkBusy || total === 0} onClick={() => bulk("KEEP_NEW", "all", { publish: true })} className="rounded border border-primary/50 bg-primary/10 px-2 py-1 font-semibold text-primary disabled:opacity-40">Is tab ke sabhi {total}: naya rakho + Publish</button>
              <button disabled={bulkBusy || selectedCount === 0} onClick={() => bulkSel("KEEP_NEW")} className="rounded border border-border px-2 py-1 font-semibold disabled:opacity-40">Selected: naya rakho</button>
              <button disabled={bulkBusy || selectedCount === 0} onClick={() => bulkSel("KEEP_BOTH")} className="rounded border border-border px-2 py-1 font-semibold disabled:opacity-40">Selected: dono rakho</button>
              <button disabled={bulkBusy || total === 0} onClick={() => bulk(tab === "SIMILAR" ? "KEEP_BOTH" : "KEEP_EXISTING", "all")} className="rounded border border-primary/50 bg-primary/10 px-2 py-1 font-semibold text-primary disabled:opacity-40">
                {tab === "SIMILAR" ? `Is tab ke sabhi ${total}: dono rakho` : `Is tab ke sabhi ${total}: purana rakho`}
              </button>
            </div>
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
                {(pending ? tab !== "RESOLVED" : tab === "RESOLVED") && <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} />}
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

              {!pending && (
                <div className="flex flex-wrap items-center gap-2">
                  <button disabled={busy} onClick={() => undoOne(it.id)} className="rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-700 disabled:opacity-40 dark:text-amber-400">
                    ↩️ Undo (decision wapas lo)
                  </button>
                  {busyId === it.id && <span className="text-xs text-muted-foreground">Please wait…</span>}
                </div>
              )}

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
