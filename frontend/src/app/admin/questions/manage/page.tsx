"use client";

// Question Manager (NEW — Sep 21 2026)
//
// "admin chapter wise pyq dekh ske or unko subtopic me bhi align kr ske ...
// admin chapter topic manage se jo topic subtopic bnaata he vo sare topics
// subtopic wise list me rhe taki usko select karke direct usme set ho jaye
// us topic ke liye": filters the whole question bank by exam/subject/
// chapter/topic/sub-topic/kind(PYQ|Practice)/status/upload-batch/search,
// then lets the admin re-align (move) selected questions — or every question
// matching the current filter — into a chapter/topic/sub-topic picked from a
// dropdown built off the SAME syllabus tree Chapter/Topic Manage edits, so a
// question can only ever land on a topic that genuinely exists. No typing,
// so no typos. Publish/Unpublish and Delete work the same way.
//
// Backend: GET/POST /bank/admin/manage/* (BankAdminController / BankAdminService).

import * as React from "react";
import { useRouter } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";

type TaxTopic = { id: string; name: string; nameHindi?: string | null; slug: string; _count: { questions: number }; subTopics: TaxSubTopic[] };
type TaxSubTopic = { id: string; name: string; nameHindi?: string | null; slug: string; _count: { questions: number } };
type TaxChapter = { id: string; name: string; nameHindi?: string | null; slug: string; _count: { questions: number }; topics: TaxTopic[] };
type TaxSubject = { id: string; name: string; nameHindi?: string | null; slug: string; chapters: TaxChapter[] };

type Exam = { id: string; name: string };

type QuestionRow = {
  id: string;
  questionText: string;
  hasHindi: boolean;
  correctAnswer: string;
  year: number | null;
  shift: string | null;
  kind: "pyq" | "practice";
  status: "live" | "pending" | "hidden";
  uploadBatchId: string | null;
  createdAt: string;
  exam: { id: string; name: string } | null;
  subject: { id: string; name: string } | null;
  chapter: { id: string; name: string } | null;
  topic: { id: string; name: string } | null;
  subTopic: { id: string; name: string } | null;
};

type Stats = { total: number; pyq: number; practice: number; live: number; pending: number; pyqWithoutTopic: number; practiceWithoutTopic: number };

const PAGE_SIZE = 30;

export default function QuestionManagerPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = React.useState(false);

  const [exams, setExams] = React.useState<Exam[]>([]);
  const [taxonomy, setTaxonomy] = React.useState<TaxSubject[]>([]);
  const [stats, setStats] = React.useState<Stats | null>(null);

  // filters
  const [examId, setExamId] = React.useState("");
  const [subjectId, setSubjectId] = React.useState("");
  const [chapterId, setChapterId] = React.useState("");
  const [topicId, setTopicId] = React.useState("");
  const [subTopicId, setSubTopicId] = React.useState("");
  const [kind, setKind] = React.useState<"" | "pyq" | "practice">("");
  const [status, setStatus] = React.useState<"" | "live" | "pending" | "hidden">("");
  const [q, setQ] = React.useState("");

  const [rows, setRows] = React.useState<QuestionRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [info, setInfo] = React.useState("");

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);

  // target picker for Move
  const [targetSubjectId, setTargetSubjectId] = React.useState("");
  const [targetChapterId, setTargetChapterId] = React.useState("");
  const [targetTopicId, setTargetTopicId] = React.useState("");
  const [targetSubTopicId, setTargetSubTopicId] = React.useState("");

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem("ssc_user");
      const user = raw ? JSON.parse(raw) : null;
      const isAdmin = user?.role === "ADMIN" || user?.role === "MODERATOR";
      if (!isAdmin) { router.replace("/dashboard"); return; }
    } catch { router.replace("/dashboard"); return; }
    setAuthChecked(true);
  }, [router]);

  const loadStatic = React.useCallback(async () => {
    try {
      const [examsRes, treeRes] = await Promise.all([
        fetchAuth(`${API_BASE}/bank/meta`),
        fetchAuth(`${API_BASE}/bank/admin/taxonomy/tree`),
      ]);
      if (examsRes.ok) {
        const d = await examsRes.json();
        setExams(Array.isArray(d?.exams) ? d.exams : []);
      }
      if (treeRes.ok) setTaxonomy(await treeRes.json());
    } catch {
      /* non-fatal — filters/targets just show fewer options */
    }
  }, []);

  const loadStats = React.useCallback(async () => {
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/manage/stats${examId ? `?examId=${examId}` : ""}`);
      if (r.ok) setStats(await r.json());
    } catch { /* ignore */ }
  }, [examId]);

  const buildQuery = React.useCallback(
    (skip: number) => {
      const p = new URLSearchParams();
      if (examId) p.set("examId", examId);
      if (subjectId) p.set("subjectId", subjectId);
      if (chapterId) p.set("chapterId", chapterId);
      if (topicId) p.set("topicId", topicId);
      if (subTopicId) p.set("subTopicId", subTopicId);
      if (kind) p.set("kind", kind);
      if (status) p.set("status", status);
      if (q.trim()) p.set("q", q.trim());
      p.set("skip", String(skip));
      p.set("take", String(PAGE_SIZE));
      return p;
    },
    [examId, subjectId, chapterId, topicId, subTopicId, kind, status, q],
  );

  const load = React.useCallback(
    async (pageNum: number) => {
      setLoading(true);
      setError("");
      try {
        const r = await fetchAuth(`${API_BASE}/bank/admin/manage/questions?${buildQuery(pageNum * PAGE_SIZE)}`);
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d?.message || `HTTP ${r.status}`);
        }
        const d = await r.json();
        setRows(d.data || []);
        setTotal(d.total || 0);
        setSelected(new Set());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Load nahi hua");
      } finally {
        setLoading(false);
      }
    },
    [buildQuery],
  );

  React.useEffect(() => { if (authChecked) { loadStatic(); loadStats(); } }, [authChecked, loadStatic, loadStats]);
  React.useEffect(() => { if (authChecked) { setPage(0); load(0); } }, [authChecked, examId, subjectId, chapterId, topicId, subTopicId, kind, status]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (authChecked) load(page); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  // cascading option lists
  const subjectOptions = taxonomy;
  const chapterOptions = subjectOptions.find((s) => s.id === subjectId)?.chapters ?? [];
  const topicOptions = chapterOptions.find((c) => c.id === chapterId)?.topics ?? [];
  const subTopicOptions = topicOptions.find((t) => t.id === topicId)?.subTopics ?? [];

  const targetChapters = taxonomy.find((s) => s.id === targetSubjectId)?.chapters ?? [];
  const targetTopics = targetChapters.find((c) => c.id === targetChapterId)?.topics ?? [];
  const targetSubTopics = targetTopics.find((t) => t.id === targetTopicId)?.subTopics ?? [];

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleAllOnPage = () => {
    setSelected((prev) => {
      if (rows.every((r) => prev.has(r.id))) return new Set();
      const n = new Set(prev);
      rows.forEach((r) => n.add(r.id));
      return n;
    });
  };

  const currentFilter = () => ({
    examId: examId || undefined,
    subjectId: subjectId || undefined,
    chapterId: chapterId || undefined,
    topicId: topicId || undefined,
    subTopicId: subTopicId || undefined,
    kind: kind || undefined,
    status: status || undefined,
    q: q.trim() || undefined,
  });

  async function runBulk(path: string, body: any, successMsg: (d: any) => string) {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/manage/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.message || `HTTP ${r.status}`);
      setInfo(successMsg(d));
      await load(page);
      await loadStats();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action fail ho gaya");
    } finally {
      setBusy(false);
    }
  }

  const scopeForAction = (useFilterForAll: boolean) =>
    useFilterForAll || selected.size === 0
      ? { filter: currentFilter() }
      : { ids: Array.from(selected) };

  const doMove = (useFilterForAll: boolean) => {
    const target: any = {};
    if (targetSubTopicId) target.subTopicId = targetSubTopicId;
    else if (targetTopicId) target.topicId = targetTopicId;
    else if (targetChapterId) target.chapterId = targetChapterId;
    else { setError("Target chapter/topic/sub-topic pehle chunein"); return; }
    runBulk("questions/move", { ...scopeForAction(useFilterForAll), target }, (d) => `${d.moved} question(s) move ho gaye.`);
  };

  const doVisibility = (action: "publish" | "unpublish", useFilterForAll: boolean) =>
    runBulk("questions/visibility", { ...scopeForAction(useFilterForAll), action }, (d) => `${d.updated} question(s) update ho gaye.`);

  const doDelete = (useFilterForAll: boolean) => {
    const n = useFilterForAll || selected.size === 0 ? total : selected.size;
    if (!confirm(`${n} question(s) delete karein? Jo students already attempt kar chuke hain vo sirf hide honge, baaki permanently delete honge.`)) return;
    runBulk("questions/delete", { ...scopeForAction(useFilterForAll), confirm: true }, (d) => `${d.deleted} delete, ${d.hidden} hide (already attempted) ho gaye.`);
  };

  if (!authChecked) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <a href="/admin" className="text-lg font-bold">← Question Manager</a>
          <div className="flex gap-2 text-sm">
            <a href="/admin/topics" className="btn btn-outline">Topic Manage</a>
            <a href="/admin/chapters" className="btn btn-outline">Chapter Manage</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {stats && (
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7 text-sm">
            {[
              ["Total", stats.total, ""],
              ["PYQ", stats.pyq, "text-sky-600 dark:text-sky-400"],
              ["Practice", stats.practice, "text-emerald-600 dark:text-emerald-400"],
              ["Live", stats.live, "text-emerald-600 dark:text-emerald-400"],
              ["Pending", stats.pending, "text-amber-600 dark:text-amber-400"],
              ["PYQ w/o topic", stats.pyqWithoutTopic, "text-red-500"],
              ["Practice w/o topic", stats.practiceWithoutTopic, "text-red-500"],
            ].map(([label, val, cls]) => (
              <div key={label as string} className="rounded-lg border border-border bg-card p-2 text-center">
                <div className={`text-lg font-bold ${cls}`}>{val}</div>
                <div className="text-[11px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        )}

        {error && <div className="mb-3 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</div>}
        {info && <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">{info}</div>}

        {/* Filters */}
        <div className="mb-4 rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 font-semibold">Filters</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <select value={examId} onChange={(e) => setExamId(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
              <option value="">All Exams</option>
              {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setChapterId(""); setTopicId(""); setSubTopicId(""); }} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
              <option value="">All Subjects</option>
              {subjectOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={chapterId} onChange={(e) => { setChapterId(e.target.value); setTopicId(""); setSubTopicId(""); }} disabled={!subjectId} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-50">
              <option value="">All Chapters</option>
              {chapterOptions.map((c) => <option key={c.id} value={c.id}>{c.name} ({c._count.questions})</option>)}
            </select>
            <select value={topicId} onChange={(e) => { setTopicId(e.target.value); setSubTopicId(""); }} disabled={!chapterId} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-50">
              <option value="">All Topics</option>
              <option value="none">— No topic —</option>
              {topicOptions.map((t) => <option key={t.id} value={t.id}>{t.name} ({t._count.questions})</option>)}
            </select>
            <select value={subTopicId} onChange={(e) => setSubTopicId(e.target.value)} disabled={!topicId || topicId === "none"} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-50">
              <option value="">All Sub-topics</option>
              <option value="none">— No sub-topic —</option>
              {subTopicOptions.map((st) => <option key={st.id} value={st.id}>{st.name} ({st._count.questions})</option>)}
            </select>
            <select value={kind} onChange={(e) => setKind(e.target.value as any)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
              <option value="">PYQ + Practice</option>
              <option value="pyq">PYQ only</option>
              <option value="practice">Practice only</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
              <option value="">All Status</option>
              <option value="live">Live</option>
              <option value="pending">Pending</option>
              <option value="hidden">Hidden</option>
            </select>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { setPage(0); load(0); } }}
              placeholder="Search question text…"
              className="col-span-2 rounded-lg border border-border bg-background px-2 py-1.5 text-sm sm:col-span-3 lg:col-span-2"
            />
            <button onClick={() => { setPage(0); load(0); }} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">
              Search
            </button>
          </div>
        </div>

        {/* Bulk actions */}
        <div className="mb-4 rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 font-semibold">
            Actions — {selected.size > 0 ? `${selected.size} selected` : `filter se match: ${total}`}
          </h2>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-muted-foreground">Move to → Subject</label>
              <select value={targetSubjectId} onChange={(e) => { setTargetSubjectId(e.target.value); setTargetChapterId(""); setTargetTopicId(""); setTargetSubTopicId(""); }} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
                <option value="">—</option>
                {taxonomy.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground">Chapter</label>
              <select value={targetChapterId} onChange={(e) => { setTargetChapterId(e.target.value); setTargetTopicId(""); setTargetSubTopicId(""); }} disabled={!targetSubjectId} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-50">
                <option value="">—</option>
                {targetChapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground">Topic</label>
              <select value={targetTopicId} onChange={(e) => { setTargetTopicId(e.target.value); setTargetSubTopicId(""); }} disabled={!targetChapterId} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-50">
                <option value="">—</option>
                {targetTopics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground">Sub-topic</label>
              <select value={targetSubTopicId} onChange={(e) => setTargetSubTopicId(e.target.value)} disabled={!targetTopicId} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-50">
                <option value="">—</option>
                {targetSubTopics.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
              </select>
            </div>
            <button onClick={() => doMove(false)} disabled={busy || (selected.size === 0)} className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary disabled:opacity-40">
              Move Selected
            </button>
            <button onClick={() => doMove(true)} disabled={busy} className="rounded-lg border border-primary/40 px-3 py-1.5 text-sm text-primary disabled:opacity-40">
              Move ALL matching filter
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => doVisibility("publish", false)} disabled={busy || selected.size === 0} className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-600 disabled:opacity-40 dark:text-emerald-400">Publish Selected</button>
            <button onClick={() => doVisibility("unpublish", false)} disabled={busy || selected.size === 0} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-600 disabled:opacity-40 dark:text-amber-400">Unpublish Selected</button>
            <button onClick={() => doDelete(false)} disabled={busy || selected.size === 0} className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-sm text-danger disabled:opacity-40">Delete Selected</button>
            <span className="mx-2 text-muted-foreground">|</span>
            <button onClick={() => doVisibility("publish", true)} disabled={busy} className="rounded-lg border border-emerald-500/40 px-3 py-1.5 text-sm text-emerald-600 disabled:opacity-40 dark:text-emerald-400">Publish ALL matching filter</button>
            <button onClick={() => doDelete(true)} disabled={busy} className="rounded-lg border border-danger/40 px-3 py-1.5 text-sm text-danger disabled:opacity-40">Delete ALL matching filter</button>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2"><input type="checkbox" checked={rows.length > 0 && rows.every((r) => selected.has(r.id))} onChange={toggleAllOnPage} /></th>
                  <th className="px-3 py-2">Question</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Chapter › Topic › Sub-topic</th>
                  <th className="px-3 py-2">Year</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>}
                {!loading && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Koi question nahi mila.</td></tr>}
                {!loading && rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 align-top"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} /></td>
                    <td className="max-w-xs px-3 py-2 align-top">
                      <p className="line-clamp-2">{r.questionText}</p>
                      {!r.hasHindi && r.subject && !/english/i.test(r.subject.name) && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400">Hindi missing</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${r.kind === "pyq" ? "bg-sky-500/10 text-sky-600 dark:text-sky-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"}`}>
                        {r.kind.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${r.status === "live" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : r.status === "pending" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                      {[r.chapter?.name, r.topic?.name, r.subTopic?.name].filter(Boolean).join(" › ") || "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-xs">{r.year ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-sm">
            <span className="text-muted-foreground">{total} total — page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="rounded-lg border border-border px-2 py-1 disabled:opacity-40">Prev</button>
              <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total} className="rounded-lg border border-border px-2 py-1 disabled:opacity-40">Next</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
