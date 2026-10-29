"use client";

// "Already uploaded here" panel (S39, 29 Oct 2026) - admin only.
//
// Sachin: "admin chapter / topic / sub-topic select kare to wahan pehle se upload hue questions dikhen, taaki duplicate na ho."
// Shows, for the selected node: how many PYQ / practice / live / hidden questions exist (with the gap to the 100-question
// practice target), and a searchable list. The list carries the exam DATE: that is fine here, the endpoint is admin / moderator
// only (students never get a date anywhere).
import * as React from "react";
import { API_BASE, fetchAuth } from "@/lib/api";
import { isoToDmy } from "@/lib/exam-date";

type Row = {
  id: string;
  questionNo: number | null;
  questionText: string;
  hasHindi: boolean;
  hasImage: boolean;
  year: number | null;
  shift: string | null;
  examDate: string | null;
  kind: "pyq" | "practice";
  status: "live" | "pending" | "hidden";
  exam?: { name: string } | null;
};
type Counts = { total: number; pyq: number; practice: number; live: number; hidden: number; practiceTarget: number; practiceMissing: number };

export default function ExistingQuestions(props: { examId?: string; subjectId?: string; chapterId?: string; topicId?: string; subTopicId?: string }) {
  const { examId, subjectId, chapterId, topicId, subTopicId } = props;
  const [kind, setKind] = React.useState<"" | "pyq" | "practice">("");
  const [q, setQ] = React.useState("");
  const [dq, setDq] = React.useState("");
  const [rows, setRows] = React.useState<Row[]>([]);
  const [counts, setCounts] = React.useState<Counts | null>(null);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [open, setOpen] = React.useState(true);
  const PAGE = 20;

  // wait for the typing to stop
  React.useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const has = !!(chapterId || topicId || subTopicId);
  const query = React.useCallback(
    (skip: number) => {
      const p = new URLSearchParams();
      if (examId) p.set("examId", examId);
      if (subjectId) p.set("subjectId", subjectId);
      if (chapterId) p.set("chapterId", chapterId);
      if (topicId) p.set("topicId", topicId);
      if (subTopicId) p.set("subTopicId", subTopicId);
      if (kind) p.set("kind", kind);
      if (dq) p.set("q", dq);
      p.set("skip", String(skip));
      p.set("take", String(PAGE));
      return p.toString();
    },
    [examId, subjectId, chapterId, topicId, subTopicId, kind, dq],
  );

  const load = React.useCallback(
    async (append: boolean) => {
      if (!has) {
        setRows([]);
        setCounts(null);
        setTotal(0);
        return;
      }
      setLoading(true);
      setErr("");
      try {
        const r = await fetchAuth(`${API_BASE}/bank/admin/manage/existing?${query(append ? rows.length : 0)}`);
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error((Array.isArray(d?.message) ? d.message.join("; ") : d?.message) || `HTTP ${r.status}`);
        setCounts(d.counts);
        setTotal(d.total);
        setRows((prev) => (append ? [...prev, ...(d.data as Row[])] : (d.data as Row[])));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not load the existing questions");
      } finally {
        setLoading(false);
      }
    },
    // rows.length is read only when appending
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [has, query],
  );

  React.useEffect(() => {
    void load(false);
  }, [load]);

  if (!has) return null;

  const chip = (label: string, v: "" | "pyq" | "practice", n?: number) => (
    <button
      type="button"
      onClick={() => setKind(v)}
      className={`rounded-full border px-3 py-1 text-xs font-semibold ${kind === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
    >
      {label}
      {n !== undefined ? ` (${n})` : ""}
    </button>
  );

  return (
    <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-bold">🔎 Is chapter / topic me pehle se ye questions hain {counts ? `(${counts.total})` : ""}</span>
        <span className="text-xs text-muted-foreground">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <div className="mt-3">
          {counts && (
            <p className="text-xs text-muted-foreground">
              PYQ <b>{counts.pyq}</b> · Practice <b>{counts.practice}</b> ({counts.practiceMissing > 0 ? `${counts.practiceMissing} aur chahiye ${counts.practiceTarget} tak` : `${counts.practiceTarget} ka target poora ✓`}) · Live <b>{counts.live}</b> · Hidden/pending <b>{counts.hidden}</b>
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {chip("All", "", counts?.total)}
            {chip("PYQ", "pyq", counts?.pyq)}
            {chip("Practice", "practice", counts?.practice)}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Question ka ek hissa ya option likh kar dhoondhein (duplicate check)"
              className="min-w-[200px] flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
            />
          </div>
          {err && <p className="mt-2 rounded-lg border border-danger/30 bg-danger/10 p-2 text-xs text-danger">{err}</p>}
          <ul className="mt-3 max-h-96 space-y-2 overflow-auto">
            {rows.map((r) => (
              <li key={r.id} className="rounded-lg border border-border bg-background p-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  {r.questionNo != null && <span className="font-mono">Q{r.questionNo}</span>}
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${r.kind === "pyq" ? "bg-sky-500/15 text-sky-700 dark:text-sky-400" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"}`}>{r.kind === "pyq" ? "PYQ" : "Practice"}</span>
                  {r.kind === "pyq" && (
                    <span>
                      {r.exam?.name ? `${r.exam.name} · ` : ""}
                      {r.year ?? ""}
                      {r.shift ? ` · ${r.shift}` : ""}
                      {r.examDate ? ` · ${isoToDmy(r.examDate)}` : ""}
                    </span>
                  )}
                  {r.status !== "live" && <span className="rounded bg-amber-500/20 px-1.5 py-0.5">{r.status}</span>}
                  {!r.hasHindi && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-red-600">no Hindi</span>}
                  {r.hasImage && <span>🖼</span>}
                  {r.questionNo != null && (
                    <a href={`/admin/questions/edit?q=${r.questionNo}`} target="_blank" rel="noreferrer" className="ml-auto text-primary underline">
                      edit
                    </a>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap">{r.questionText}</p>
              </li>
            ))}
            {!loading && rows.length === 0 && !err && <li className="text-xs text-muted-foreground">Yahan abhi koi question nahi hai{dq ? " (is search se)" : ""}.</li>}
          </ul>
          {rows.length < total && (
            <button type="button" onClick={() => void load(true)} disabled={loading} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
              {loading ? "Loading…" : `Aur dikhayein (${rows.length}/${total})`}
            </button>
          )}
          {loading && rows.length === 0 && <p className="mt-2 text-xs text-muted-foreground">Loading…</p>}
          <a
            href={`/admin/questions/manage?${new URLSearchParams({ ...(subjectId ? { subject: subjectId } : {}), ...(chapterId ? { chapter: chapterId } : {}), ...(topicId ? { topic: topicId } : {}), ...(subTopicId ? { subtopic: subTopicId } : {}) }).toString()}`}
            className="mt-2 inline-block text-xs text-primary underline"
          >
            Sab questions manager me kholein →
          </a>
        </div>
      )}
    </section>
  );
}
