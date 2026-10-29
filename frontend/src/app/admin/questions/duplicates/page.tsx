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
import { isoToDmy } from "@/lib/exam-date";

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
  examTier?: string | null;
  tierPaper?: string | null;
  paperCode: string | null;
};
type Item = {
  id: string;
  status: string;
  matchType: "EXACT" | "SIMILAR";
  mode: "UPLOAD" | "SCAN";
  differences: string[];
  differenceLabels: string[];
  /** same question but a different paper (shift / date / tier ...) */
  crossPaper?: boolean;
  crossPaperLabels?: string[];
  suggestedAction?: Action | null;
  /** decided by the 24-hour auto-publish rules, not by a person */
  autoResolved?: boolean;
  autoReason?: string | null;
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
  KEPT_EXISTING: "Kept old",
  KEPT_NEW: "Kept new",
  KEPT_BOTH: "Kept both",
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
        {missing ? "This question is no longer in the database (it was deleted)." : "The question on this side is still pending."}
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
        {q.source === "UPLOAD" && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] text-sky-600">Not saved yet</span>}
      </div>
      <div className="text-[11px] text-muted-foreground">
        {[q.examName, q.subjectName, q.chapterName].filter(Boolean).join(" › ") || "—"}
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Field label="Exam" diff={diffs.has("examId")}>{q.examName ?? "—"}</Field>
        <Field label="Year" diff={diffs.has("year")}>{q.year ?? "—"}</Field>
        <Field label="Shift" diff={diffs.has("shift")}>{q.shift ?? "—"}</Field>
        <Field label="Date" diff={diffs.has("examDate")}>{isoToDmy(q.examDate) || "—"}</Field>
      </div>
      {(q.examTier || q.tierPaper) && (
        <div className="grid grid-cols-2 gap-1.5">
          <Field label="Tier" diff={diffs.has("examTier")}>{q.examTier ? q.examTier.replace("TIER_", "Tier ") : "—"}</Field>
          <Field label="Paper" diff={diffs.has("tierPaper")}>{q.tierPaper ? q.tierPaper.replace("PAPER_", "Paper ") : "Paper 1"}</Field>
        </div>
      )}
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
            <summary className="cursor-pointer text-xs text-primary">View solution</summary>
            <p className="mt-1 whitespace-pre-wrap text-xs">{q.explanation}</p>
            {q.explanationHindi && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{q.explanationHindi}</p>}
          </details>
        ) : (
          <span className="text-xs text-muted-foreground">No solution</span>
        )}
      </Field>
    </div>
  );
}

type AutoCfg = { enabled: boolean; afterHours: number; includeSimilar: boolean };
type AutoRun = { at: string; trigger: "auto" | "manual"; keptNew: number; keptExisting: number; keptBoth: number; needsHuman: number; failed: number };
type AutoPreview = { pending: number; due: number; notDueYet: number; keepBoth: number; keepExisting: number; keepNew: number; needsHuman: number; cappedAt: number | null };

/** 24-hour auto-publish: duplicates nobody answered are decided by safe rules; every decision is marked "Auto" and can be undone. */
function AutoPublishCard({ onRan }: { onRan: () => void }) {
  const [cfg, setCfg] = React.useState<AutoCfg | null>(null);
  const [log, setLog] = React.useState<AutoRun[]>([]);
  const [prev, setPrev] = React.useState<AutoPreview | null>(null);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [hours, setHours] = React.useState("24");

  const jsonOrThrow = async (r: Response) => {
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new Error(Array.isArray(d?.message) ? d.message.join("; ") : d?.message || `HTTP ${r.status}`);
    return d;
  };

  const load = React.useCallback(async () => {
    try {
      const d = await jsonOrThrow(await fetchAuth(`${API_BASE}/bank/admin/auto-publish`));
      setCfg(d.config);
      setLog(d.log || []);
      setHours(String(d.config.afterHours));
      setPrev(await jsonOrThrow(await fetchAuth(`${API_BASE}/bank/admin/auto-publish/preview`)));
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Could not load auto-publish" });
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const save = async (patch: Partial<AutoCfg>) => {
    setBusy("save");
    setNote(null);
    try {
      const d = await jsonOrThrow(await fetchAuth(`${API_BASE}/bank/admin/auto-publish`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }));
      setCfg(d.config);
      setHours(String(d.config.afterHours));
      setNote({ ok: true, text: "Saved." });
      setPrev(await jsonOrThrow(await fetchAuth(`${API_BASE}/bank/admin/auto-publish/preview`)));
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setBusy("");
    }
  };

  const runNow = async () => {
    if (!window.confirm("Run the auto-publish rules now on every duplicate that is older than the waiting time?")) return;
    setBusy("run");
    setNote(null);
    try {
      const d = await jsonOrThrow(await fetchAuth(`${API_BASE}/bank/admin/auto-publish/run`, { method: "POST" }));
      const r = d.summary as AutoRun | null;
      setNote({ ok: true, text: r ? `Done: ${r.keptNew} new kept, ${r.keptExisting} old kept, ${r.keptBoth} both kept, ${r.needsHuman} need you${r.failed ? `, ${r.failed} failed` : ""}.` : "Nothing to do." });
      await load();
      onRan();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Run failed" });
    } finally {
      setBusy("");
    }
  };

  if (!cfg) return note ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">{note.text}</div> : null;

  return (
    <div className="rounded-xl border border-violet-500/40 bg-violet-500/5 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1 text-sm">
          <div className="font-bold">🤖 Auto-publish after {cfg.afterHours}h <span className={`ml-1 rounded px-1.5 py-0.5 text-[11px] ${cfg.enabled ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"}`}>{cfg.enabled ? "ON" : "OFF"}</span></div>
          <div className="text-xs text-muted-foreground">
            Same question in another paper (only shift / date / tier / year differ): kept in <b>both</b> papers <b>at once</b>. A duplicate nobody answered for {cfg.afterHours} hour(s) is decided by safe rules -
            same exam + year, new copy has the exam date and the old one has none: the <b>dated copy replaces the old one</b>; identical copy: keep the old one;
            old one not live: publish the new one. If the question, options or answer differ, <b>you</b> decide, always. Every automatic decision is marked 🤖 Auto and can be undone.
          </div>
          {prev && (
            <div className="mt-1 text-xs">
              Waiting: <b>{prev.pending}</b> · ready for auto now: <b>{prev.due}</b> (new {prev.keepNew}, old {prev.keepExisting}, both {prev.keepBoth}; <b>{prev.needsHuman}</b> need you)
              {prev.cappedAt ? ` · preview capped at ${prev.cappedAt}` : ""}
            </div>
          )}
        </div>
        <button onClick={() => setOpen((v) => !v)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold" aria-expanded={open}>{open ? "Hide settings" : "Settings & history"}</button>
        <button onClick={runNow} disabled={!!busy} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">{busy === "run" ? "Running…" : "Run now"}</button>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-violet-500/30 pt-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={cfg.enabled} disabled={!!busy} onChange={(e) => save({ enabled: e.target.checked })} />
            Switched on (runs by itself every 15 minutes)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold">Wait for a person (hours, 0-168)</label>
            <input type="number" min={0} max={168} value={hours} onChange={(e) => setHours(e.target.value)} className="w-20 border bg-background px-2 py-1 text-sm" />
            <button onClick={() => save({ afterHours: Number(hours) })} disabled={!!busy || hours === "" || Number(hours) === cfg.afterHours} className="rounded border border-border px-2 py-1 text-xs font-semibold disabled:opacity-40">Save hours</button>
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={cfg.includeSimilar} disabled={!!busy} onChange={(e) => save({ includeSimilar: e.target.checked })} />
            <span>Also decide “similar” copies whose only difference is the solution, picture or paper question number (the newer paper&apos;s copy is kept). <span className="text-xs text-muted-foreground">Off by default.</span></span>
          </label>
          <p className="text-xs text-muted-foreground">Auto-publish never bypasses the Hindi check: a question without its Hindi version still waits for it.</p>
          {log.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="text-muted-foreground"><th className="pr-3">When</th><th className="pr-3">By</th><th className="pr-3">New</th><th className="pr-3">Old</th><th className="pr-3">Both</th><th className="pr-3">Need you</th><th>Failed</th></tr></thead>
                <tbody>
                  {log.map((r, i) => (
                    <tr key={i}><td className="pr-3">{new Date(r.at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</td><td className="pr-3">{r.trigger === "auto" ? "🤖 auto" : "you"}</td><td className="pr-3">{r.keptNew}</td><td className="pr-3">{r.keptExisting}</td><td className="pr-3">{r.keptBoth}</td><td className="pr-3">{r.needsHuman}</td><td>{r.failed}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {note && <p role="status" className={`mt-2 text-xs ${note.ok ? "text-emerald-600" : "text-red-600"}`}>{note.text}</p>}
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
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Could not load the list" });
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
      setMsg({ type: "ok", text: "Decision saved." });
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
    const label = action === "KEEP_EXISTING" ? "keep old" : action === "KEEP_NEW" ? "keep new" : "keep both";
    const pendingAll = (counts?.pending ?? total);
    const effTotal = allMode ? Math.max(total - excluded.size, 0) : total;
    const count = mode === "selected" ? selected.size : opts.scopeAll ? pendingAll : effTotal;
    if (count === 0) return;
    const scope = mode === "selected" ? `${count} selected` : opts.scopeAll ? `all ${count} pending` : `all ${count} in this tab`;
    const extra = opts.publish ? " aur naye questions PUBLISH (live)" : "";
    if (!window.confirm(`Apply "${label}"${extra} to ${scope} duplicate(s)?`)) return;
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
          setMsg({ type: "ok", text: `Working… ${done} / ${ids.length}` });
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
          setMsg({ type: "ok", text: `Working… ${done} done, ${d.remaining ?? 0} left${failed ? `, ${failed} failed` : ""}` });
          if (!d.remaining || (d.done ?? 0) === 0) break;
        }
      }
      setMsg({
        type: failed ? "err" : "ok",
        text: `✅ ${done} duplicate(s) resolved${opts.publish ? " (new questions published)" : ""}${failed ? `, ${failed} failed — first reason: ${firstErr}` : ""}.`,
      });
      setPage(0);
      await refreshAll(0);
    } catch (e) {
      setMsg({ type: "err", text: `${done} done, then it stopped: ${e instanceof Error ? e.message : "Failed"}` });
      await refreshAll(0);
    } finally {
      setBulkBusy(false);
      setAllMode(false);
      setExcluded(new Set());
    }
  };

  // ---- UNDO (NEW Oct 14 2026): a resolved duplicate goes back to Pending — new question hidden, old one live again
  const undoOne = async (id: string) => {
    if (!window.confirm("Undo this decision? The new question will be hidden, the old one will go live again, and this duplicate returns to Pending.")) return;
    setBusyId(id);
    setMsg(null);
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/duplicates/${id}/undo`, { method: "POST" });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(Array.isArray(d?.message) ? d.message.join("; ") : d?.message || `HTTP ${r.status}`);
      setMsg({ type: "ok", text: `↩️ Undone${d?.restoredQuestionId ? " — the old question is live again" : ""}${d?.hiddenQuestionId ? " — the new question is hidden" : ""}. This duplicate is now Pending.` });
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
    const scope = mode === "selected" ? `${count} selected` : `all ${count} in this list`;
    if (!window.confirm(`UNDO ${scope} resolved duplicate(s)?\nThe new questions will be hidden, the old ones go live again, and all of them return to Pending.`)) return;
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
          setMsg({ type: "ok", text: `Undoing… ${done} / ${ids.length}` });
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
          setMsg({ type: "ok", text: `Undoing… ${done} done, ${d.remaining ?? 0} left${failed ? `, ${failed} failed` : ""}` });
          if (!d.remaining || (d.done ?? 0) === 0) break;
        }
      }
      setMsg({
        type: failed ? "err" : "ok",
        text: `↩️ ${done} duplicate(s) undone (now Pending)${failed ? `, ${failed} failed — first reason: ${firstErr}` : ""}.`,
      });
      setPage(0);
      await refreshAll(0);
    } catch (e) {
      setMsg({ type: "err", text: `${done} undone, then it stopped: ${e instanceof Error ? e.message : "Failed"}` });
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
      setMsg({ type: "ok", text: `Scan complete: ${d.groupsChecked} group(s) checked, ${d.queued} new duplicate(s) sent to review${d.alreadyReviewed ? `, ${d.alreadyReviewed} already reviewed` : ""}${d.similarSkipped ? `, ${d.similarSkipped} with a different shift / year skipped (normal repeats)` : ""}.` });
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
          {items.length} on this page are selected.
          <button onClick={() => { setAllMode(true); setExcluded(new Set()); }} className="rounded bg-primary px-2 py-1 font-bold text-primary-foreground">Select all {total} (all pages)</button>
        </div>
      )}
      {allMode && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-primary/40 bg-primary/10 px-2 py-1.5 text-xs">
          ✅ <b>{selectedCount}</b> selected across all pages{excluded.size > 0 ? ` (${excluded.size} removed by you)` : ""}.
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
          If a question that is already in the bank is uploaded again, it shows up here. <strong>Exact</strong> = question, options, solution,
          year and shift all identical. <strong>Similar</strong> = same question, but some detail such as the solution / shift / year differs.
          For each one choose: keep old, keep new, or keep both. The one that is &quot;removed&quot; is only hidden (you can bring it back from Question Manager).
        </p>

        {batchId && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
            Showing duplicates of one upload only.
            <a href="/admin/questions/duplicates" className="font-semibold text-primary underline">View all duplicates</a>
          </div>
        )}

        {msg && (
          <div className={`rounded-lg border p-3 text-sm ${msg.type === "ok" ? "border-emerald-500/40 bg-emerald-500/10" : "border-red-500/40 bg-red-500/10"}`}>{msg.text}</div>
        )}

        <AutoPublishCard onRan={() => { setPage(0); void refreshAll(0); }} />

        {(counts?.pending ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-primary/50 bg-primary/5 p-3">
            <div className="min-w-[220px] flex-1 text-sm">
              <div className="font-bold">⚡ One click: keep the NEWER (latest) question in all {counts?.pending} duplicates</div>
              <div className="text-xs text-muted-foreground">The old one is hidden (it can be restored from Question Manager); the new question is saved and published. Applies to both Exact and Similar.</div>
            </div>
            <button
              disabled={bulkBusy}
              onClick={() => bulk("KEEP_NEW", "all", { publish: true, scopeAll: true })}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-40"
            >
              {bulkBusy ? "Working…" : "✅ Keep all newer + Publish"}
            </button>
          </div>
        )}

        {(counts?.resolved ?? 0) > 0 && tab !== "RESOLVED" && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <span>Decided or published by mistake? You can <b>Undo</b> the {counts?.resolved} resolved duplicates.</span>
            <button onClick={() => setTab("RESOLVED")} className="rounded-lg border border-amber-500/60 px-3 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">↩️ View resolved / Undo</button>
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
              {scanBusy ? "Scanning…" : "🔎 Find old duplicates in the bank"}
            </button>
          </div>
        </div>

        {tab === "RESOLVED" && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">What was decided:</span>
              {([["", "All"], ["KEPT_NEW", "Kept new"], ["KEPT_EXISTING", "Kept old"], ["KEPT_BOTH", "Kept both"]] as const).map(([v, l]) => (
                <button key={v || "all"} onClick={() => setResolvedFilter(v)} className={`rounded border px-2 py-1 font-semibold ${resolvedFilter === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{l}</button>
              ))}
            </div>
            {items.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1"><input type="checkbox" checked={allOnPage} onChange={toggleAll} /> Select all on this page</label>
                <span className="text-muted-foreground">{selectedCount} selected</span>
                <div className="ml-auto flex flex-wrap gap-1.5">
                  <button disabled={bulkBusy || selectedCount === 0} onClick={undoSel} className="rounded border border-border px-2 py-1 font-semibold disabled:opacity-40">↩️ Selected ({selectedCount}): Undo</button>
                  <button disabled={bulkBusy || total === 0} onClick={() => undoBulk("all")} className="rounded border border-amber-500/60 bg-amber-500/10 px-2 py-1 font-semibold text-amber-700 disabled:opacity-40 dark:text-amber-400">↩️ Undo all {total} in this list</button>
                </div>
              </div>
            )}
            {selectBanner}
            <p className="text-[11px] text-muted-foreground">Undo = the new (published) question is hidden, the old (hidden) question goes live again, and the duplicate returns to Pending — then you can decide again.</p>
          </div>
        )}

        {tab !== "RESOLVED" && items.length > 0 && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2 text-xs">
          {selectBanner}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1"><input type="checkbox" checked={allOnPage} onChange={toggleAll} /> Select all on this page</label>
            <span className="text-muted-foreground">{selectedCount} selected</span>
            <div className="ml-auto flex flex-wrap gap-1.5">
              <button disabled={bulkBusy || selectedCount === 0} onClick={() => bulkSel("KEEP_EXISTING")} className="rounded border border-border px-2 py-1 font-semibold disabled:opacity-40">Selected: keep old</button>
              <button disabled={bulkBusy || selectedCount === 0} onClick={() => bulkSel("KEEP_NEW", { publish: true })} className="rounded border border-primary/50 bg-primary/10 px-2 py-1 font-semibold text-primary disabled:opacity-40">Selected ({selectedCount}): keep new + Publish</button>
              <button disabled={bulkBusy || total === 0} onClick={() => bulk("KEEP_NEW", "all", { publish: true })} className="rounded border border-primary/50 bg-primary/10 px-2 py-1 font-semibold text-primary disabled:opacity-40">All {total} in this tab: keep new + Publish</button>
              <button disabled={bulkBusy || selectedCount === 0} onClick={() => bulkSel("KEEP_NEW")} className="rounded border border-border px-2 py-1 font-semibold disabled:opacity-40">Selected: keep new</button>
              <button disabled={bulkBusy || selectedCount === 0} onClick={() => bulkSel("KEEP_BOTH")} className="rounded border border-border px-2 py-1 font-semibold disabled:opacity-40">Selected: keep both</button>
              <button disabled={bulkBusy || total === 0} onClick={() => bulk(tab === "SIMILAR" ? "KEEP_BOTH" : "KEEP_EXISTING", "all")} className="rounded border border-primary/50 bg-primary/10 px-2 py-1 font-semibold text-primary disabled:opacity-40">
                {tab === "SIMILAR" ? `All ${total} in this tab: keep both` : `All ${total} in this tab: keep old`}
              </button>
            </div>
          </div>
          </div>
        )}

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && items.length === 0 && (
          <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
            {tab === "RESOLVED" ? "No resolved duplicates yet." : "🎉 No duplicates are waiting for review."}
          </div>
        )}

        {items.map((it) => {
          const diffs = new Set(it.differences);
          const upload = it.mode === "UPLOAD";
          const leftTitle = upload ? "Old (in the bank)" : "Question A (old)";
          const rightTitle = upload ? `Naya (upload${it.sourceRow ? ` · row ${it.sourceRow}` : ""})` : "Question B";
          const pending = it.status === "PENDING";
          const busy = busyId === it.id || bulkBusy;
          return (
            <section key={it.id} className="space-y-3 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                {(pending ? tab !== "RESOLVED" : tab === "RESOLVED") && <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} />}
                <span className={`rounded px-2 py-0.5 text-xs font-bold ${it.matchType === "EXACT" ? "bg-red-500/15 text-red-600" : "bg-amber-500/15 text-amber-700"}`}>
                  {it.matchType === "EXACT" ? "EXACT SAME" : "SIMILAR"}
                </span>
                <span className="rounded bg-muted px-2 py-0.5 text-[11px]">{upload ? "Upload" : "Bank scan"}</span>
                {!pending && <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{STATUS_TEXT[it.status] ?? it.status}</span>}
                {!pending && it.autoResolved && <span title={it.autoReason ?? "Decided automatically"} className="rounded bg-violet-500/15 px-2 py-0.5 text-[11px] font-semibold text-violet-600 dark:text-violet-400">🤖 Auto{it.autoReason ? `: ${it.autoReason}` : ""}</span>}
                {it.differenceLabels.length > 0 && (
                  <span className="text-xs text-amber-700 dark:text-amber-400">Alag: {it.differenceLabels.join(", ")}</span>
                )}
              </div>

              {pending && it.crossPaper && (
                <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-xs leading-relaxed">
                  <p className="font-semibold text-sky-700 dark:text-sky-300">🔁 This question is repeated in another paper</p>
                  <p className="mt-0.5 text-muted-foreground">
                    Also in: {(it.crossPaperLabels ?? []).join(", ")}. SSC often repeats a question in a different shift / date / tier. Compare both and decide:
                    <b> &quot;Keep in both papers&quot;</b> puts this question in both papers (each paper keeps its full count).{upload ? " Until you decide, the new question is not added to any mock." : ""}
                  </p>
                </div>
              )}

              <div className="grid gap-3 lg:grid-cols-2">
                <QuestionColumn title={leftTitle} q={it.left} diffs={diffs} missing={it.leftMissing} />
                <QuestionColumn title={rightTitle} q={it.right} diffs={diffs} />
              </div>

              {!pending && (
                <div className="flex flex-wrap items-center gap-2">
                  <button disabled={busy} onClick={() => undoOne(it.id)} className="rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-700 disabled:opacity-40 dark:text-amber-400">
                    ↩️ Undo (take back the decision)
                  </button>
                  {busyId === it.id && <span className="text-xs text-muted-foreground">Please wait…</span>}
                </div>
              )}

              {pending && (
                <div className="flex flex-wrap gap-2">
                  <button disabled={busy} onClick={() => resolveOne(it.id, "KEEP_EXISTING")} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:border-primary disabled:opacity-40">
                    {upload ? "✅ Keep old (remove new)" : "✅ Keep A (hide B)"}
                  </button>
                  <button disabled={busy} onClick={() => resolveOne(it.id, "KEEP_NEW")} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:border-primary disabled:opacity-40">
                    {upload ? "🔄 Keep new (remove old)" : "🔄 Keep B (hide A)"}
                  </button>
                  <button disabled={busy} onClick={() => resolveOne(it.id, "KEEP_BOTH")} className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-40 ${it.crossPaper ? "bg-primary text-primary-foreground ring-2 ring-primary/40" : "border border-border hover:border-primary"}`}>
                    {it.crossPaper ? "➕ One question in both papers (recommended)" : "➕ Keep both"}
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
