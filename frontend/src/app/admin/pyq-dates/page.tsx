"use client";

// Admin → PYQ Date Mapping (manual)
// Har PYQ question ki asli exam date (aur Tier 1 / Tier 2) admin khud daalta hai. Koi automatic internet search / AI nahi.
//   • "Bina date" = PYQ jinki date abhi khaali hai
//   • purani auto-finder wali rows (Date lagi / Admin check / ...) dikhti rehti hain: accept, reject ya haath se date badlo
import * as React from "react";
import { useRouter } from "next/navigation";
import { API_BASE, api, fetchAuth } from "@/lib/api";

type Counts = Record<string, number>;
interface Overview {
  totals: { pyqTotal: number; pyqWithDate: number; pyqWithoutDate: number; notQueued: number };
  counts: Counts;
  tiers: Array<{ tier: string; count: number }>;
  byExam: Array<{ exam: string; counts: Counts }>;
}
interface Item {
  id: string; questionId: string; status: string; examTier: string | null; proposedDate: string | null; note: string | null; updatedAt: string; appliedAt: string | null;
  question: { questionNo: number; questionText: string; year: number | null; shift: string | null; examDate: string | null; examTier: string | null; exam: { name: string } | null; subject: { name: string } | null; chapter: { name: string } | null };
}
type Exam = { id: string; name: string };

const STATUS_LABEL: Record<string, { t: string; c: string }> = {
  UNMAPPED: { t: "Bina date", c: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  MANUAL: { t: "Haath se ✍️", c: "bg-purple-500/15 text-purple-700 dark:text-purple-300" },
  MAPPED: { t: "Date lagi ✅", c: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  NEEDS_REVIEW: { t: "Admin check", c: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  NOT_FOUND: { t: "Nahi mili", c: "bg-red-500/10 text-red-700 dark:text-red-300" },
  FAILED: { t: "Fail", c: "bg-red-500/20 text-red-700 dark:text-red-300" },
  PENDING: { t: "Purani queue", c: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  RUNNING: { t: "Purani queue", c: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
};
const FILTER_STATUSES = ["UNMAPPED", "MANUAL", "MAPPED", "NEEDS_REVIEW", "NOT_FOUND", "FAILED", "PENDING"];
const CARD_STATUSES = ["UNMAPPED", "MANUAL", "MAPPED", "NEEDS_REVIEW"];
const tierText = (t: string | null) => (t === "TIER_1" ? "Tier 1" : t === "TIER_2" ? "Tier 2" : "—");

export default function AdminPyqDatesPage() {
  const router = useRouter();
  const [ok, setOk] = React.useState(false);
  const [ov, setOv] = React.useState<Overview | null>(null);
  const [err, setErr] = React.useState("");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [exams, setExams] = React.useState<Exam[]>([]);
  const [status, setStatus] = React.useState("UNMAPPED");
  const [examId, setExamId] = React.useState("");
  const [year, setYear] = React.useState("");
  const [tier, setTier] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [items, setItems] = React.useState<Item[]>([]);
  const [total, setTotal] = React.useState(0);
  const [open, setOpen] = React.useState<string>("");
  const [manual, setManual] = React.useState({ date: "", tier: "" });
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
      setOv(await api<Overview>("/admin/pyq-dates/overview"));
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

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: true, text: `${label} ✅ ${r && typeof r === "object" ? JSON.stringify(r) : ""}` });
      setOpen("");
      await Promise.all([loadOverview(), loadItems()]);
    } catch (e) {
      setMsg({ ok: false, text: `${label}: ${(e as Error).message}` });
    }
  };
  const post = (path: string, body: unknown = {}) => api(`/admin/pyq-dates/${path}`, { method: "POST", body: JSON.stringify(body) });

  function toggleOpen(it: Item) {
    if (open === it.questionId) { setOpen(""); return; }
    setOpen(it.questionId);
    setManual({ date: it.question.examDate || it.proposedDate || "", tier: it.examTier || it.question.examTier || "" });
  }

  async function downloadLog() {
    const res = await fetchAuth(`${API_BASE}/admin/pyq-dates/export${status && status !== "UNMAPPED" ? `?status=${status}` : ""}`);
    if (!res.ok) { setMsg({ ok: false, text: `Export fail (HTTP ${res.status})` }); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "pyq_date_mapping.xlsx";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
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
          <div className="flex gap-3 text-xs"><a href="/admin/pyq-export" className="text-primary underline">Excel export</a></div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-3 py-5">
        {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-700">{err}</p>}
        {msg && <p className={`rounded-lg border p-2 text-sm break-all ${msg.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" : "border-red-500/40 bg-red-500/10 text-red-700"}`}>{msg.text}</p>}

        <section className={card}>
          <p className="text-sm">Exam date aur Tier 1 / Tier 2 yahan <b>khud</b> daalein: neeche list me question kholo → date (YYYY-MM-DD ya DD-MM-YYYY) likho → <b>Date save karein</b>. Date save hote hi us paper ka shift-wise mock bhi nayi date dikhane lagta hai.</p>
          <div className="mt-3"><button onClick={downloadLog} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">⬇️ Status Excel</button></div>
        </section>

        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {[
            ["PYQ total", ov?.totals.pyqTotal], ["Date lagi hai", ov?.totals.pyqWithDate], ["Bina date", ov?.totals.pyqWithoutDate],
          ].map(([l, v]) => <div key={String(l)} className="rounded-lg border border-border bg-card p-3"><p className="text-[11px] text-muted-foreground">{l}</p><p className="text-lg font-bold">{(v as number | undefined)?.toLocaleString() ?? "…"}</p></div>)}
          {CARD_STATUSES.map((s) => (
            <button key={s} onClick={() => { setStatus(status === s ? "" : s); setPage(0); }} className={`rounded-lg border p-3 text-left ${status === s ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
              <p className="text-[11px] text-muted-foreground">{STATUS_LABEL[s].t}</p><p className="text-lg font-bold">{(c[s] ?? 0).toLocaleString()}</p>
            </button>
          ))}
        </section>

        {ov && (ov.tiers.length > 0 || ov.byExam.length > 0) && (
          <section className="grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h2 className="mb-2 text-sm font-bold">Tier</h2>
              <div className="flex flex-wrap gap-2 text-xs">{ov.tiers.map((t) => <span key={t.tier} className="rounded-full border border-border px-3 py-1">{t.tier === "UNKNOWN" ? "Tier pata nahi" : tierText(t.tier)}: <b>{t.count}</b></span>)}</div>
            </div>
            <div className={card}>
              <h2 className="mb-2 text-sm font-bold">Exam-wise status (purani rows + haath se)</h2>
              <ul className="space-y-1 text-xs">{ov.byExam.map((e) => <li key={e.exam} className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{e.exam}</span><span className="text-muted-foreground">{Object.entries(e.counts).map(([k, v]) => `${STATUS_LABEL[k]?.t ?? k}: ${v}`).join(" · ")}</span></li>)}</ul>
            </div>
          </section>
        )}

        <section className={card}>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <select className={field} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
              <option value="">Sab status</option>{FILTER_STATUSES.map((k) => <option key={k} value={k}>{STATUS_LABEL[k].t}</option>)}
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
                      <span className="block text-[11px] text-muted-foreground">{tierText(it.examTier ?? it.question.examTier)}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="mt-2 space-y-2 rounded-lg border border-border bg-background p-3 text-xs">
                      {it.note && <p><b>Note:</b> {it.note}</p>}
                      <div className="flex flex-wrap items-end gap-2">
                        {it.proposedDate && it.status !== "MAPPED" && it.status !== "MANUAL" && (
                          <button onClick={() => act("Accept", () => post(`items/${it.questionId}/accept`))} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white">✔ {it.proposedDate} accept karein</button>
                        )}
                        {it.proposedDate && it.status === "NEEDS_REVIEW" && <button onClick={() => act("Reject", () => post(`items/${it.questionId}/reject`))} className="rounded-lg border border-red-500/40 px-3 py-1.5 font-semibold text-red-600">✖ Reject</button>}
                        <input className={`${field} w-32`} placeholder="YYYY-MM-DD" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} />
                        <select className={field} value={manual.tier} onChange={(e) => setManual({ ...manual, tier: e.target.value })}><option value="">Tier?</option><option value="TIER_1">Tier 1</option><option value="TIER_2">Tier 2</option></select>
                        <button onClick={() => act("Date save", () => post(`items/${it.questionId}/manual`, { examDate: manual.date, examTier: manual.tier || null }))} className="rounded-lg border border-primary/40 px-3 py-1.5 font-semibold text-primary">✍️ Date save karein</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
            {items.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">Is filter me koi question nahi hai.</li>}
          </ul>

          <div className="mt-3 flex items-center justify-between text-xs">
            <button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded border border-border px-3 py-1.5 disabled:opacity-40">← Pehle</button>
            <span>Page {page + 1} / {Math.max(1, Math.ceil(total / PAGE))}</span>
            <button disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)} className="rounded border border-border px-3 py-1.5 disabled:opacity-40">Aage →</button>
          </div>
        </section>
      </main>
    </div>
  );
}
