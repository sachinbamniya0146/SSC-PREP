"use client";

// Admin → Date-wise + Tier-wise PYQ papers (26 Oct 2026, polished 27 Oct 2026)
// Shows every real paper (exam + tier + paper + date + shift) with build progress, what is still missing
// (short subjects, missing question numbers), and lets the admin rebuild all mocks from the bank, show / hide a
// paper, rename it, delete it (only when nobody attempted it) and open it the way a student sees it.
import * as React from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { isoToDmy } from "@/lib/exam-date";

interface Paper {
  id: string; title: string; titleLocked?: boolean; examId: string | null; examName?: string | null; examTier: string | null; tierPaper: string | null;
  examDate: string | null; shift: string | null; year: number | null;
  totalQuestions: number; targetQuestions: number | null; target: number; patternLinked: boolean;
  isActive: boolean; status: "LIVE" | "READY_HIDDEN" | "BUILDING"; updatedAt: string;
}
interface Overview { papers: Paper[]; exams: { id: string; name: string }[]; questionsWithDateButNoTier: number }
interface Detail {
  id: string; built: number; target: number; patternLinked: boolean; duplicatesDropped: number;
  subjects: { name: string; slug: string; have: number; need: number | null }[];
  shortSections: string[];
  numbering: { numbered: number; unnumbered: number; missing: string[] | null };
}

const STATUS: Record<Paper["status"], { t: string; c: string }> = {
  LIVE: { t: "Live ✅", c: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  READY_HIDDEN: { t: "Ready (hidden) 🙈", c: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  BUILDING: { t: "Building 🛠️", c: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
};
const tierText = (t: string | null) => (t === "TIER_2" ? "Tier 2" : t === "TIER_1" ? "Tier 1" : "—");
const paperText = (p: string | null) => (p && p !== "PAPER_1" ? p.replace("PAPER_", "Paper ") : "");

export default function AdminPyqPapersPage() {
  const router = useRouter();
  const [ok, setOk] = React.useState(false);
  const [data, setData] = React.useState<Overview | null>(null);
  const [err, setErr] = React.useState("");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState("");
  const [filter, setFilter] = React.useState<"ALL" | Paper["status"]>("ALL");
  const [q, setQ] = React.useState("");
  const [examId, setExamId] = React.useState("");
  const [open, setOpen] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<Record<string, Detail | { error: string } | undefined>>({});

  React.useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem("ssc_user") || "null");
      if (u?.role !== "ADMIN") { router.replace("/admin"); return; }
    } catch { router.replace("/dashboard"); return; }
    setOk(true);
  }, [router]);

  const load = React.useCallback(async () => {
    try {
      setData(await api<Overview>(`/bank/admin/upload/pyq-papers${examId ? `?examId=${encodeURIComponent(examId)}` : ""}`));
      setErr("");
    } catch (e) { setErr((e as Error).message); }
  }, [examId]);
  React.useEffect(() => { if (ok) void load(); }, [ok, load]);

  async function run(key: string, label: string, path: string, init: { method?: string; body?: unknown } = {}) {
    setBusy(key); setMsg(null);
    try {
      const method = init.method ?? "POST";
      const r = await api<unknown>(path, { method, ...(method === "DELETE" ? {} : { body: JSON.stringify(init.body ?? {}) }) });
      setMsg({ ok: true, text: `${label} ✅ ${r ? JSON.stringify(r) : ""}` });
      setDetail({}); // numbers changed: reopen a row to see fresh gaps
      await load();
    } catch (e) { setMsg({ ok: false, text: `${label}: ${(e as Error).message}` }); }
    setBusy("");
  }

  async function toggleDetail(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    if (detail[id]) return;
    try {
      const d = await api<Detail>(`/bank/admin/upload/pyq-papers/${encodeURIComponent(id)}/detail`);
      setDetail((prev) => ({ ...prev, [id]: d }));
    } catch (e) { setDetail((prev) => ({ ...prev, [id]: { error: (e as Error).message } })); }
  }

  function rename(p: Paper) {
    const title = window.prompt("New name for this paper (it will not be changed by later uploads):", p.title);
    if (title === null || title.trim() === "" || title.trim() === p.title) return;
    void run(`${p.id}:rename`, "Naam badla", `/bank/admin/upload/pyq-papers/${encodeURIComponent(p.id)}/rename`, { body: { title: title.trim() } });
  }

  function remove(p: Paper) {
    if (!window.confirm(`Delete the mock "${p.title}"?\n\nOnly the mock is removed; the questions stay in the bank. If any student has attempted this paper it cannot be deleted (use "Hide" instead). The next upload or Rebuild for the same exam + tier + date + shift will create it again.`)) return;
    void run(`${p.id}:delete`, "Paper delete", `/bank/admin/upload/pyq-papers/${encodeURIComponent(p.id)}`, { method: "DELETE" });
  }

  if (!ok) return null;
  const papers = data?.papers ?? [];
  const count = (s: Paper["status"]) => papers.filter((p) => p.status === s).length;
  const needle = q.trim().toLowerCase();
  const rows = papers.filter((p) => (filter === "ALL" || p.status === filter) && (!needle || `${p.title} ${p.examName ?? ""} ${p.examDate ?? ""} ${isoToDmy(p.examDate)} ${p.shift ?? ""}`.toLowerCase().includes(needle)));
  const card = "rounded-xl border border-border bg-card p-4";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
          <a href="/admin" className="text-sm font-semibold">← Admin</a>
          <span className="text-sm font-bold">🗓️ Date-wise PYQ Papers</span>
          <a href="/admin/pyq-dates" className="text-xs text-primary underline">Date Mapping</a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-3 py-5">
        {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-700">{err}</p>}
        {msg && <p className={`break-all rounded-lg border p-2 text-sm ${msg.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" : "border-red-500/40 bg-red-500/10 text-red-700"}`}>{msg.text}</p>}

        <section className="grid gap-3 sm:grid-cols-4">
          {(["LIVE", "READY_HIDDEN", "BUILDING"] as const).map((s) => (
            <button key={s} onClick={() => setFilter(filter === s ? "ALL" : s)} className={`${card} text-left ${filter === s ? "ring-2 ring-primary" : ""}`}>
              <p className="text-2xl font-bold">{count(s)}</p>
              <p className="text-xs text-muted-foreground">{STATUS[s].t}</p>
            </button>
          ))}
          <div className={card}>
            <p className="text-2xl font-bold">{data?.questionsWithDateButNoTier ?? "…"}</p>
            <p className="text-xs text-muted-foreground">Has a date but no tier — will not be added to any mock</p>
          </div>
        </section>

        <section className={`${card} flex flex-wrap items-center gap-2`}>
          <button disabled={!!busy} onClick={() => run("rebuild", "Sab papers rebuild", "/bank/admin/upload/pyq-papers/rebuild")}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
            {busy === "rebuild" ? "Rebuilding…" : "🔄 Rebuild all papers from the bank"}
          </button>
          <button disabled={!!busy} onClick={() => void load()} className="rounded-lg border border-border px-3 py-1.5 text-xs">↻ Refresh</button>
          <select value={examId} onChange={(e) => { setExamId(e.target.value); setOpen(null); }} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs">
            <option value="">Sab exams</option>
            {(data?.exams ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: exam / date / shift"
            className="ml-auto w-56 rounded-lg border border-border bg-background px-2 py-1.5 text-xs" />
        </section>
        <p className="text-[11px] text-muted-foreground">
          A paper stays hidden until all its questions (as per the pattern) have arrived. You can show it to students earlier with "Show now".
          If no pattern is linked, 100 questions are assumed — create a pattern named "… Tier 1/2 …" in Exam Patterns.
        </p>

        <section className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
              <tr><th className="p-2">Paper</th><th className="p-2">Date</th><th className="p-2">Shift</th><th className="p-2">Tier</th><th className="p-2">Progress</th><th className="p-2">Status</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">{data ? "No papers found." : "Loading…"}</td></tr>}
              {rows.map((p) => {
                const pct = Math.min(100, Math.round((p.totalQuestions / Math.max(1, p.target)) * 100));
                const d = detail[p.id];
                const isOpen = open === p.id;
                const btn = "rounded-lg border border-border px-2 py-1 text-[11px] disabled:opacity-50";
                return (
                  <React.Fragment key={p.id}>
                    <tr className="border-t border-border align-top">
                      <td className="p-2">
                        <p className="font-medium">{p.title}{p.titleLocked && <span title="You renamed this paper" className="ml-1">✏️</span>}</p>
                        <p className="text-[10px] text-muted-foreground">{p.examName ?? "—"}</p>
                        <p className="break-all text-[10px] text-muted-foreground">{p.id}</p>
                      </td>
                      <td className="p-2 whitespace-nowrap">{isoToDmy(p.examDate) || "—"}</td>
                      <td className="p-2">{p.shift ?? "—"}</td>
                      <td className="p-2 whitespace-nowrap">{tierText(p.examTier)} {paperText(p.tierPaper)}</td>
                      <td className="p-2">
                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
                        <p className="mt-1 text-[11px]">{p.totalQuestions}/{p.target}{!p.patternLinked && <span className="text-amber-600"> · no pattern linked</span>}</p>
                        <button onClick={() => void toggleDetail(p.id)} className="mt-1 text-[11px] text-primary underline">{isOpen ? "Close" : "What is missing?"}</button>
                      </td>
                      <td className="p-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS[p.status].c}`}>{STATUS[p.status].t}</span></td>
                      <td className="p-2">
                        <div className="flex flex-wrap justify-end gap-1">
                          {!p.isActive ? (
                            <button disabled={!!busy} onClick={() => run(`${p.id}:show`, "Paper live", `/bank/admin/upload/pyq-papers/${encodeURIComponent(p.id)}/publish-now`)}
                              className="rounded-lg border border-emerald-500/50 px-2 py-1 text-[11px] text-emerald-700 disabled:opacity-50">
                              {busy === `${p.id}:show` ? "…" : "Show now"}
                            </button>
                          ) : (
                            <button disabled={!!busy} onClick={() => run(`${p.id}:hide`, "Paper chhupaya", `/bank/admin/upload/pyq-papers/${encodeURIComponent(p.id)}/visibility`, { body: { visible: false } })} className={btn}>
                              {busy === `${p.id}:hide` ? "…" : "Chhupao"}
                            </button>
                          )}
                          <a href={`/test?template=${encodeURIComponent(p.id)}`} target="_blank" rel="noreferrer" className={btn}>Student view ↗</a>
                          <button disabled={!!busy} onClick={() => rename(p)} className={btn}>Rename</button>
                          <button disabled={!!busy} onClick={() => remove(p)} className="rounded-lg border border-red-500/40 px-2 py-1 text-[11px] text-red-700 disabled:opacity-50">Delete</button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-border bg-muted/20">
                        <td colSpan={7} className="p-3 text-[11px]">
                          {!d && <span className="text-muted-foreground">Loading…</span>}
                          {d && "error" in d && <span className="text-red-700">{d.error}</span>}
                          {d && !("error" in d) && (
                            <div className="grid gap-3 sm:grid-cols-3">
                              <div>
                                <p className="mb-1 font-semibold">Subject-wise</p>
                                {d.subjects.length === 0 && <p className="text-muted-foreground">No questions yet.</p>}
                                {d.subjects.map((s) => (
                                  <p key={s.slug}>{s.name}: <b>{s.have}</b>{s.need != null ? ` / ${s.need}` : ""}{s.need != null && s.have < s.need && <span className="text-amber-600"> (kam)</span>}</p>
                                ))}
                                {d.shortSections.map((t) => <p key={t} className="text-amber-700">⚠ {t}</p>)}
                              </div>
                              <div>
                                <p className="mb-1 font-semibold">Question numbers</p>
                                {d.numbering.missing === null
                                  ? <p className="text-muted-foreground">No question has a questionNo — the mock will follow upload order.</p>
                                  : d.numbering.missing.length === 0
                                    ? <p className="text-emerald-700">No number gaps ✅</p>
                                    : <p className="text-amber-700">Missing: {d.numbering.missing.map((r) => `Q${r}`).join(", ")}</p>}
                                <p className="text-muted-foreground">{d.numbering.numbered} numbered · {d.numbering.unnumbered} without a number</p>
                              </div>
                              <div>
                                <p className="mb-1 font-semibold">Total</p>
                                <p>{d.built} / {d.target} questions{!d.patternLinked && " (no pattern linked: 100 assumed)"}</p>
                                {d.duplicatesDropped > 0 && <p className="text-amber-700">{d.duplicatesDropped} duplicate(s) (same text) not counted.</p>}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
