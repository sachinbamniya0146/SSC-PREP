"use client";

// Practice coverage gauge (S39, 29 Oct 2026) - admin only.
// "Har topic / sub-topic me 100 practice question" - lowest coverage first, with the PYQ count next to it and an Excel
// download of the same list (so the next upload can be planned).
import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";

type GRow = {
  level: "chapter" | "topic" | "subTopic";
  subjectId: string;
  subject: string;
  chapterId: string;
  chapter: string;
  topicId?: string;
  topic?: string;
  subTopicId?: string;
  subTopic?: string;
  practice: number;
  pyq: number;
  target: number;
  missing: number;
  pct: number;
};
type Gauge = { target: number; rows: GRow[]; totals: { nodes: number; complete: number; practice: number; pyq: number } };

export default function PracticeGaugeTab() {
  const [data, setData] = React.useState<Gauge | null>(null);
  const [subjects, setSubjects] = React.useState<{ id: string; name: string }[]>([]);
  const [subjectId, setSubjectId] = React.useState("");
  const [onlyLow, setOnlyLow] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const r = await fetchAuth(`${API_BASE}/bank/admin/manage/practice-gauge${subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : ""}`);
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error((Array.isArray(d?.message) ? d.message.join("; ") : d?.message) || `HTTP ${r.status}`);
        if (!off) setData(d as Gauge);
      } catch (e) {
        if (!off) setErr(e instanceof Error ? e.message : "Could not load the gauge");
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => {
      off = true;
    };
  }, [subjectId]);

  // subject list for the filter (from the unfiltered gauge rows)
  React.useEffect(() => {
    if (!data || subjectId) return;
    const m = new Map<string, string>();
    for (const r of data.rows) m.set(r.subjectId, r.subject);
    setSubjects([...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
  }, [data, subjectId]);

  async function download() {
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/manage/practice-gauge/export${subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : ""}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `practice-coverage-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Download failed");
    }
  }

  const rows = (data?.rows ?? []).filter((r) => !onlyLow || r.missing > 0);
  const shown = rows.slice(0, 400);

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm">
          <option value="">All subjects</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Sirf wo jahan 100 se kam hain
        </label>
        <button onClick={download} className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:bg-muted">
          ⬇️ Excel
        </button>
      </div>
      {data && (
        <p className="mt-3 text-sm text-muted-foreground">
          {data.totals.nodes} topic / sub-topic · <b>{data.totals.complete}</b> me {data.target} practice poore · Live practice <b>{data.totals.practice}</b> · Live PYQ <b>{data.totals.pyq}</b>
        </p>
      )}
      {err && <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{err}</p>}
      {loading && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
      <div className="mt-3 overflow-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Subject</th>
              <th className="p-2">Chapter</th>
              <th className="p-2">Topic</th>
              <th className="p-2">Sub-topic</th>
              <th className="p-2">Practice</th>
              <th className="p-2">Kam</th>
              <th className="p-2">PYQ</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="p-2">{r.subject}</td>
                <td className="p-2">{r.chapter}</td>
                <td className="p-2">{r.topic ?? "—"}</td>
                <td className="p-2">{r.subTopic ?? "—"}</td>
                <td className="p-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full ${r.pct >= 100 ? "bg-emerald-500" : r.pct >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${r.pct}%` }} />
                    </div>
                    <span className="text-xs">
                      {r.practice}/{r.target}
                    </span>
                  </div>
                </td>
                <td className={`p-2 ${r.missing > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-600"}`}>{r.missing > 0 ? r.missing : "✓"}</td>
                <td className="p-2">{r.pyq}</td>
                <td className="p-2">
                  <a
                    href={`/admin/questions/manage?${new URLSearchParams({ subject: r.subjectId, chapter: r.chapterId, ...(r.topicId ? { topic: r.topicId } : {}), ...(r.subTopicId ? { subtopic: r.subTopicId } : {}) }).toString()}`}
                    className="text-xs text-primary underline"
                  >
                    dekhein
                  </a>
                </td>
              </tr>
            ))}
            {!loading && shown.length === 0 && (
              <tr>
                <td colSpan={8} className="p-4 text-center text-sm text-muted-foreground">
                  Kuch nahi mila.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length && <p className="mt-2 text-xs text-muted-foreground">Pehli {shown.length} dikhayi gayi hain - baaki ke liye Excel download karein.</p>}
    </div>
  );
}
