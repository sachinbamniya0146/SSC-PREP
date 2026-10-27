"use client";

// Admin → Date-wise + Tier-wise PYQ papers (26 Oct 2026)
// Shows every real paper (exam + tier + paper + date + shift) with build progress, lets the admin
// rebuild all mocks from the bank and make a still-building paper visible right now.
import * as React from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface Paper {
  id: string; title: string; examId: string | null; examTier: string | null; tierPaper: string | null;
  examDate: string | null; shift: string | null; year: number | null;
  totalQuestions: number; targetQuestions: number | null; target: number; patternLinked: boolean;
  isActive: boolean; status: "LIVE" | "READY_HIDDEN" | "BUILDING"; updatedAt: string;
}
interface Overview { papers: Paper[]; questionsWithDateButNoTier: number }

const STATUS: Record<Paper["status"], { t: string; c: string }> = {
  LIVE: { t: "Live ✅", c: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  READY_HIDDEN: { t: "Ready (hidden) 🙈", c: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  BUILDING: { t: "Ban raha 🛠️", c: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
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

  React.useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem("ssc_user") || "null");
      if (u?.role !== "ADMIN") { router.replace("/admin"); return; }
    } catch { router.replace("/dashboard"); return; }
    setOk(true);
  }, [router]);

  const load = React.useCallback(async () => {
    try {
      setData(await api<Overview>("/bank/admin/upload/pyq-papers"));
      setErr("");
    } catch (e) { setErr((e as Error).message); }
  }, []);
  React.useEffect(() => { if (ok) void load(); }, [ok, load]);

  async function run(key: string, label: string, path: string) {
    setBusy(key); setMsg(null);
    try {
      const r = await api<unknown>(path, { method: "POST", body: JSON.stringify({}) });
      setMsg({ ok: true, text: `${label} ✅ ${r ? JSON.stringify(r) : ""}` });
      await load();
    } catch (e) { setMsg({ ok: false, text: `${label}: ${(e as Error).message}` }); }
    setBusy("");
  }

  if (!ok) return null;
  const papers = data?.papers ?? [];
  const count = (s: Paper["status"]) => papers.filter((p) => p.status === s).length;
  const needle = q.trim().toLowerCase();
  const rows = papers.filter((p) => (filter === "ALL" || p.status === filter) && (!needle || `${p.title} ${p.examDate} ${p.shift ?? ""}`.toLowerCase().includes(needle)));
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
            <p className="text-xs text-muted-foreground">Date hai par Tier nahi — kisi mock me nahi judenge</p>
          </div>
        </section>

        <section className={`${card} flex flex-wrap items-center gap-2`}>
          <button disabled={!!busy} onClick={() => run("rebuild", "Sab papers rebuild", "/bank/admin/upload/pyq-papers/rebuild")}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
            {busy === "rebuild" ? "Rebuild ho raha…" : "🔄 Bank se sab papers rebuild karo"}
          </button>
          <button disabled={!!busy} onClick={() => void load()} className="rounded-lg border border-border px-3 py-1.5 text-xs">↻ Refresh</button>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: exam / date / shift"
            className="ml-auto w-56 rounded-lg border border-border bg-background px-2 py-1.5 text-xs" />
        </section>
        <p className="text-[11px] text-muted-foreground">
          Paper tab tak hidden rehta hai jab tak uske sare questions (pattern ke hisaab se) na aa jayen. "Abhi dikhao" se aap use pehle bhi student ko dikha sakte hain.
          Pattern link nahi hai to 100 questions maane jaate hain — Exam Patterns me "… Tier 1/2 …" naam ka pattern banayein.
        </p>

        <section className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
              <tr><th className="p-2">Paper</th><th className="p-2">Date</th><th className="p-2">Shift</th><th className="p-2">Tier</th><th className="p-2">Progress</th><th className="p-2">Status</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">{data ? "Koi paper nahi mila." : "Load ho raha…"}</td></tr>}
              {rows.map((p) => {
                const pct = Math.min(100, Math.round((p.totalQuestions / Math.max(1, p.target)) * 100));
                return (
                  <tr key={p.id} className="border-t border-border align-top">
                    <td className="p-2"><p className="font-medium">{p.title}</p><p className="break-all text-[10px] text-muted-foreground">{p.id}</p></td>
                    <td className="p-2 whitespace-nowrap">{p.examDate ?? "—"}</td>
                    <td className="p-2">{p.shift ?? "—"}</td>
                    <td className="p-2 whitespace-nowrap">{tierText(p.examTier)} {paperText(p.tierPaper)}</td>
                    <td className="p-2">
                      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
                      <p className="mt-1 text-[11px]">{p.totalQuestions}/{p.target}{!p.patternLinked && <span className="text-amber-600"> · pattern link nahi</span>}</p>
                    </td>
                    <td className="p-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS[p.status].c}`}>{STATUS[p.status].t}</span></td>
                    <td className="p-2 text-right">
                      {!p.isActive && (
                        <button disabled={!!busy} onClick={() => run(p.id, "Paper live", `/bank/admin/upload/pyq-papers/${encodeURIComponent(p.id)}/publish-now`)}
                          className="rounded-lg border border-emerald-500/50 px-2 py-1 text-[11px] text-emerald-700 disabled:opacity-50">
                          {busy === p.id ? "…" : "Abhi dikhao"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
