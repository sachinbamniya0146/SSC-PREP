"use client";

// Admin → PYQ Excel Export (NEW Oct 7 2026)
// "PYQ ki chapter-wise / subject-wise / exam-wise Excel file download":
//   * pick filters (exam, subject, chapter, year, tier, date mapped or not)
//   * pick the grouping: exam / subject / chapter / exam>subject>chapter / tier / year / exam date
//   * pick the file: ONE Excel with a sheet per group (+ Summary sheet) or a ZIP with a folder tree
import * as React from "react";
import { useRouter } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";

type TaxChapter = { id: string; name: string };
type TaxSubject = { id: string; name: string; chapters: TaxChapter[] };
type Exam = { id: string; name: string };

const GROUPS: Array<{ id: string; label: string; hint: string }> = [
  { id: "exam", label: "Exam-wise", hint: "CGL, CHSL, CPO … har exam ki alag sheet/file" },
  { id: "subject", label: "Subject-wise", hint: "Reasoning, Maths … har subject ki alag sheet/file" },
  { id: "chapter", label: "Chapter-wise", hint: "Subject → Chapter, har chapter ki alag sheet/file" },
  { id: "hierarchy", label: "Exam → Subject → Chapter", hint: "ZIP me folder tree: Exam/Subject/Chapter.xlsx" },
  { id: "tier", label: "Tier-wise", hint: "Tier 1 / Tier 2 / unknown" },
  { id: "year", label: "Year-wise", hint: "har year ki alag sheet/file" },
  { id: "date", label: "Exam date-wise", hint: "har exam date ki alag sheet/file" },
  { id: "none", label: "Sab ek sheet me", hint: "ek hi sheet, Summary ke saath" },
];

export default function AdminPyqExportPage() {
  const router = useRouter();
  const [ok, setOk] = React.useState(false);
  const [exams, setExams] = React.useState<Exam[]>([]);
  const [tax, setTax] = React.useState<TaxSubject[]>([]);
  const [examId, setExamId] = React.useState("");
  const [subjectId, setSubjectId] = React.useState("");
  const [chapterId, setChapterId] = React.useState("");
  const [year, setYear] = React.useState("");
  const [tier, setTier] = React.useState("");
  const [dateState, setDateState] = React.useState("all");
  const [published, setPublished] = React.useState("all");
  const [groupBy, setGroupBy] = React.useState("chapter");
  const [layout, setLayout] = React.useState<"sheets" | "zip">("sheets");
  const [count, setCount] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem("ssc_user") || "null");
      if (u?.role !== "ADMIN" && u?.role !== "MODERATOR") { router.replace("/dashboard"); return; }
    } catch { router.replace("/dashboard"); return; }
    setOk(true);
  }, [router]);

  React.useEffect(() => {
    if (!ok) return;
    (async () => {
      try {
        const [m, t] = await Promise.all([fetchAuth(`${API_BASE}/bank/meta`), fetchAuth(`${API_BASE}/bank/admin/taxonomy/tree`)]);
        if (m.ok) { const d = await m.json(); setExams(Array.isArray(d?.exams) ? d.exams : []); }
        if (t.ok) { const d = await t.json(); setTax(Array.isArray(d) ? d : []); }
      } catch { /* filters just stay empty */ }
    })();
  }, [ok]);

  const query = React.useMemo(() => {
    const p = new URLSearchParams();
    if (examId) p.set("examId", examId);
    if (subjectId) p.set("subjectId", subjectId);
    if (chapterId) p.set("chapterId", chapterId);
    if (year.trim()) p.set("year", year.trim());
    if (tier) p.set("tier", tier);
    if (dateState !== "all") p.set("dateState", dateState);
    if (published !== "all") p.set("published", published);
    return p;
  }, [examId, subjectId, chapterId, year, tier, dateState, published]);

  React.useEffect(() => {
    if (!ok) return;
    let alive = true;
    setCount(null);
    const t = setTimeout(async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/bank/admin/pyq-export/count?${query.toString()}`);
        if (r.ok && alive) setCount((await r.json()).count);
      } catch { /* ignore */ }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [ok, query]);

  const chapters = tax.find((s) => s.id === subjectId)?.chapters ?? [];

  async function download() {
    setBusy(true);
    setMsg(null);
    try {
      const p = new URLSearchParams(query);
      p.set("groupBy", groupBy);
      p.set("layout", layout);
      const res = await fetchAuth(`${API_BASE}/bank/admin/pyq-export?${p.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error((body as { message?: string } | null)?.message || `Export fail (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const m = (res.headers.get("Content-Disposition") || "").match(/filename="(.+)"/);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = m ? m[1] : layout === "zip" ? "pyq_export.zip" : "pyq_export.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setMsg({ ok: true, text: "Download shuru ho gaya ✅" });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!ok) return null;
  const sel = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <a href="/admin" className="text-sm font-semibold">← Admin</a>
          <span className="text-sm font-bold">📥 PYQ Excel Export</span>
          <a href="/admin/pyq-dates" className="text-xs text-primary underline">Date mapping →</a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-3 py-5">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-bold">1. Kaunse PYQ chahiye (filters)</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs">Exam
              <select className={sel} value={examId} onChange={(e) => setExamId(e.target.value)}>
                <option value="">Sab exams</option>
                {exams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className="text-xs">Tier
              <select className={sel} value={tier} onChange={(e) => setTier(e.target.value)}>
                <option value="">Sab</option>
                <option value="TIER_1">Tier 1</option>
                <option value="TIER_2">Tier 2</option>
                <option value="UNKNOWN">Tier pata nahi</option>
              </select>
            </label>
            <label className="text-xs">Subject
              <select className={sel} value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setChapterId(""); }}>
                <option value="">Sab subjects</option>
                {tax.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className="text-xs">Chapter
              <select className={sel} value={chapterId} onChange={(e) => setChapterId(e.target.value)} disabled={!subjectId}>
                <option value="">{subjectId ? "Sab chapters" : "Pehle subject chunein"}</option>
                {chapters.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className="text-xs">Year
              <input className={sel} inputMode="numeric" placeholder="jaise 2024 (khali = sab)" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} />
            </label>
            <label className="text-xs">Exam date
              <select className={sel} value={dateState} onChange={(e) => setDateState(e.target.value)}>
                <option value="all">Sab</option>
                <option value="mapped">Sirf jinki date lagi hai</option>
                <option value="unmapped">Sirf jinki date nahi lagi</option>
              </select>
            </label>
            <label className="text-xs sm:col-span-2">Students ko dikh raha hai?
              <select className={sel} value={published} onChange={(e) => setPublished(e.target.value)}>
                <option value="all">Sab</option>
                <option value="published">Sirf published</option>
                <option value="unpublished">Sirf unpublished / hidden</option>
              </select>
            </label>
          </div>
          <p className="mt-3 text-sm">Is filter me <b>{count === null ? "…" : count.toLocaleString()}</b> PYQ questions hain.</p>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-bold">2. Kaise alag-alag karna hai</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {GROUPS.map((g) => (
              <button key={g.id} onClick={() => setGroupBy(g.id)} className={`rounded-lg border p-3 text-left ${groupBy === g.id ? "border-primary bg-primary/10" : "border-border"}`}>
                <p className="text-sm font-semibold">{g.label}</p>
                <p className="text-[11px] text-muted-foreground">{g.hint}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-bold">3. File ka type</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <button onClick={() => setLayout("sheets")} className={`rounded-lg border p-3 text-left ${layout === "sheets" ? "border-primary bg-primary/10" : "border-border"}`}>
              <p className="text-sm font-semibold">📄 Ek Excel (.xlsx)</p>
              <p className="text-[11px] text-muted-foreground">Har group ki alag sheet + Summary sheet</p>
            </button>
            <button onClick={() => setLayout("zip")} className={`rounded-lg border p-3 text-left ${layout === "zip" ? "border-primary bg-primary/10" : "border-border"}`}>
              <p className="text-sm font-semibold">🗂️ ZIP (alag Excel files)</p>
              <p className="text-[11px] text-muted-foreground">Har group ki apni .xlsx file, folders ke saath</p>
            </button>
          </div>
          <button onClick={download} disabled={busy || count === 0} className="mt-4 w-full rounded-lg bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-40">
            {busy ? "File ban rahi hai… (badi file me thoda time lagta hai)" : "⬇️ Download karein"}
          </button>
          {msg && <p className={`mt-3 rounded-lg border p-2 text-sm ${msg.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" : "border-red-500/40 bg-red-500/10 text-red-700"}`}>{msg.text}</p>}
          <p className="mt-2 text-[11px] text-muted-foreground">Ek file me max 1,20,000 questions. Zyada hon to exam/subject/year filter lagayein.</p>
        </section>
      </main>
    </div>
  );
}
