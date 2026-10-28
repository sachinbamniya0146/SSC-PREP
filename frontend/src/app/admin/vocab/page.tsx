"use client";

// Admin — Vocabulary Mastery upload + word list (NEW — Sep 2026)
// Upload a two-sheet Excel (Words + Questions) — see
// Vocabulary_30Words_Import.xlsx's Instructions sheet for the exact format.
import * as React from "react";
import { useRouter } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";

type AdminWord = {
  id: string;
  slug: string;
  word: string;
  orderIndex: number;
  isActive: boolean;
  questionCount: number;
  studentsProgressing: number;
};

type AdminQuestion = {
  id: string;
  questionText: string;
  optionsJson: { key: string; text: string }[] | null;
  correctAnswer: string;
  explanation: string | null;
  explanationHindi?: string | null;
  questionType: string | null;
};

type UploadResult = {
  success: boolean;
  dryRun?: boolean;
  wordsCreated: number;
  wordsUpdated?: number;
  wordsSkipped?: number;
  questionsCreated: number;
  questionsUpdated?: number;
  questionsSkipped?: number;
  errors: { sheet: string; row: number; error: string }[];
  skipped?: { sheet: string; row: number; word: string; code: string; message: string }[];
  wordReport?: { word: string; wordStatus: string; questionsCreated: number; rejected: Record<string, number> }[];
};

const CODE_LABEL: Record<string, string> = {
  DUPLICATE_WORD: "♻️ Duplicate word",
  DUPLICATE_QUESTION: "♻️ Duplicate question",
  MISSING_ANSWER: "🔑 Answer missing",
  MISSING_SOLUTION: "📝 Solution missing",
  MISSING_OPTIONS: "❗ Option missing",
  MISSING_MEANING: "❗ Meaning missing",
  MISSING_FIELD: "❗ Field missing",
  UNKNOWN_WORD: "🔗 Word not found",
};

export default function AdminVocabPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = React.useState(false);
  const [words, setWords] = React.useState<AdminWord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [file, setFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadResult, setUploadResult] = React.useState<UploadResult | null>(null);
  const [error, setError] = React.useState("");
  const [dryRun, setDryRun] = React.useState(false);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem("ssc_user");
      const user = raw ? JSON.parse(raw) : null;
      if (user?.role !== "ADMIN" && user?.role !== "MODERATOR") { router.replace("/dashboard"); return; }
    } catch { router.replace("/dashboard"); return; }
    setAuthChecked(true);
  }, [router]);

  const loadWords = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchAuth(`${API_BASE}/vocab/admin/words`);
      if (r.ok) setWords(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { if (authChecked) loadWords(); }, [authChecked, loadWords]);

  const submitUpload = async () => {
    if (!file) { setError("Please select an Excel file first"); return; }
    setUploading(true);
    setError("");
    setUploadResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("dryRun", String(dryRun));
      const r = await fetchAuth(`${API_BASE}/vocab/admin/upload`, { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d?.message || `HTTP ${r.status}`); return; }
      setUploadResult(d);
      if (!dryRun) await loadWords();
    } catch (e: any) {
      setError(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const toggleActive = async (w: AdminWord) => {
    await fetchAuth(`${API_BASE}/vocab/admin/words/${w.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !w.isActive }),
    });
    await loadWords();
  };

  // Delete = really remove the word (and its questions) from the list. Every student's unlock / mastery of it is
  // archived first by the server, so uploading the same word again brings their progress back.
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const deleteWord = async (w: AdminWord) => {
    if (!confirm(`Permanently delete "${w.word}" and its ${w.questionCount} question(s) from the list?\n\nStudents' unlocks and progress stay safe — if you upload the same word again, the unlock comes back.`)) return;
    setDeleting(w.id);
    setError("");
    try {
      const r = await fetchAuth(`${API_BASE}/vocab/admin/words/${w.id}?hard=true`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(Array.isArray(d?.message) ? d.message.join(", ") : d?.message || `Could not delete (HTTP ${r.status})`);
        return;
      }
      // close the gap in the numbering so ↑ ↓ / Move-to keep working
      await fetchAuth(`${API_BASE}/vocab/admin/words/normalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => undefined);
    } catch {
      setError("Network error — the word was not deleted.");
    } finally {
      setDeleting(null);
      await loadWords();
    }
  };

  // ---- one word's questions (delete a single question) ----
  const [qPanel, setQPanel] = React.useState<{ wordId: string; word: string; questions: AdminQuestion[] } | null>(null);
  const [qLoading, setQLoading] = React.useState(false);
  const [qBusy, setQBusy] = React.useState<string | null>(null);
  const [qError, setQError] = React.useState("");

  const openQuestions = async (w: AdminWord) => {
    setQError("");
    setQForm(null);
    setQLoading(true);
    setQPanel({ wordId: w.id, word: w.word, questions: [] });
    try {
      const r = await fetchAuth(`${API_BASE}/vocab/admin/words/${w.id}/questions`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setQError(d?.message || `Could not load questions (HTTP ${r.status})`); return; }
      setQPanel({ wordId: w.id, word: d.word ?? w.word, questions: d.questions ?? [] });
    } catch {
      setQError("Network error — the questions could not be loaded.");
    } finally {
      setQLoading(false);
    }
  };

  const deleteQuestion = async (q: AdminQuestion) => {
    if (!qPanel) return;
    if (!confirm("Delete this question?")) return;
    setQBusy(q.id);
    setQError("");
    try {
      const r = await fetchAuth(`${API_BASE}/vocab/admin/questions/${q.id}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setQError(Array.isArray(d?.message) ? d.message.join(", ") : d?.message || `Could not delete (HTTP ${r.status})`); return; }
      setQPanel((p) => (p ? { ...p, questions: p.questions.filter((x) => x.id !== q.id) } : p));
      await loadWords();
    } catch {
      setQError("Network error — the question was not deleted.");
    } finally {
      setQBusy(null);
    }
  };

  // ---- add / edit ONE question ----
  type QForm = {
    id: string | null; // null = adding a new question
    questionText: string;
    options: Record<"A" | "B" | "C" | "D", string>;
    correctAnswer: string;
    explanation: string;
    explanationHindi: string;
    questionType: string;
  };
  const blankQForm = (): QForm => ({
    id: null, questionText: "", options: { A: "", B: "", C: "", D: "" }, correctAnswer: "A", explanation: "", explanationHindi: "", questionType: "",
  });
  const [qForm, setQForm] = React.useState<QForm | null>(null);
  const [qSaving, setQSaving] = React.useState(false);

  const startEditQuestion = (q: AdminQuestion) => {
    const opts = { A: "", B: "", C: "", D: "" } as QForm["options"];
    for (const o of Array.isArray(q.optionsJson) ? q.optionsJson : []) {
      if (o.key === "A" || o.key === "B" || o.key === "C" || o.key === "D") opts[o.key] = o.text;
    }
    setQError("");
    setQForm({ id: q.id, questionText: q.questionText, options: opts, correctAnswer: q.correctAnswer || "A", explanation: q.explanation ?? "", explanationHindi: q.explanationHindi ?? "", questionType: q.questionType ?? "" });
  };

  const saveQuestion = async () => {
    if (!qPanel || !qForm) return;
    setQError("");
    if (!qForm.questionText.trim()) { setQError("Please write the question text."); return; }
    if (!(["A", "B", "C", "D"] as const).every((k) => qForm.options[k].trim())) { setQError("All four options (A–D) are required."); return; }
    if (!qForm.explanation.trim()) { setQError("A solution / explanation is required."); return; }
    const body = {
      questionText: qForm.questionText.trim(),
      optionsJson: (["A", "B", "C", "D"] as const).map((k) => ({ key: k, text: qForm.options[k].trim() })),
      correctAnswer: qForm.correctAnswer,
      explanation: qForm.explanation.trim(),
      explanationHindi: qForm.explanationHindi.trim() || null,
      questionType: qForm.questionType || null,
    };
    setQSaving(true);
    try {
      const url = qForm.id ? `${API_BASE}/vocab/admin/questions/${qForm.id}` : `${API_BASE}/vocab/admin/words/${qPanel.wordId}/questions`;
      const r = await fetchAuth(url, { method: qForm.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setQError(Array.isArray(d?.message) ? d.message.join(", ") : d?.message || `Could not save (HTTP ${r.status})`); return; }
      setQForm(null);
      const lr = await fetchAuth(`${API_BASE}/vocab/admin/words/${qPanel.wordId}/questions`);
      if (lr.ok) { const ld = await lr.json(); setQPanel({ wordId: qPanel.wordId, word: ld.word ?? qPanel.word, questions: ld.questions ?? [] }); }
      await loadWords();
    } catch {
      setQError("Network error — the question was not saved.");
    } finally {
      setQSaving(false);
    }
  };

  // ---- re-order / edit (admin can change any word after upload) ----
  const [moveTo, setMoveTo] = React.useState<Record<string, string>>({});
  const [editing, setEditing] = React.useState<Record<string, any> | null>(null);
  const [jsonText, setJsonText] = React.useState({ examplesJson: "", synonymsJson: "", antonymsJson: "" });
  const [saving, setSaving] = React.useState(false);
  const [editError, setEditError] = React.useState("");
  const [busyOrder, setBusyOrder] = React.useState(false);

  const callOrder = async (path: string, body?: unknown) => {
    setBusyOrder(true);
    setError("");
    try {
      const r = await fetchAuth(`${API_BASE}/vocab/admin/words/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setError(Array.isArray(d?.message) ? d.message.join(", ") : d?.message || "Could not change the order.");
      await loadWords();
    } catch {
      setError("Network error — order not changed.");
    } finally {
      setBusyOrder(false);
    }
  };
  const moveWordTo = async (w: AdminWord, position: number) => {
    if (!Number.isFinite(position) || position < 1 || position === w.orderIndex) return;
    await callOrder(`${w.id}/move`, { position });
    setMoveTo((m) => ({ ...m, [w.id]: "" }));
  };

  const openEdit = async (w: AdminWord) => {
    setEditError("");
    const r = await fetchAuth(`${API_BASE}/vocab/admin/words/${w.id}`);
    if (!r.ok) { setError("Could not load this word."); return; }
    const d = await r.json();
    setEditing(d);
    setJsonText({
      examplesJson: JSON.stringify(d.examplesJson ?? [], null, 2),
      synonymsJson: JSON.stringify(d.synonymsJson ?? [], null, 2),
      antonymsJson: JSON.stringify(d.antonymsJson ?? [], null, 2),
    });
  };

  const openNew = () => {
    setEditError("");
    setEditing({ isNew: true, word: "", partOfSpeech: "", meaningEnglish: "", meaningHindi: "", pronunciation: "", memoryTrick: "", etymology: "", registerNote: "", examTrendNote: "", confusingPairNote: "" });
    setJsonText({ examplesJson: "[]", synonymsJson: "[]", antonymsJson: "[]" });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setEditError("");
    if (editing.isNew && (!String(editing.word ?? "").trim() || !String(editing.meaningHindi ?? "").trim() || !String(editing.meaningEnglish ?? "").trim())) {
      setEditError("Word, Meaning (English) and Meaning (Hindi) are required.");
      return;
    }
    const body: Record<string, unknown> = {};
    for (const k of ["word", "meaningHindi", "meaningEnglish", "partOfSpeech", "pronunciation", "memoryTrick", "etymology", "registerNote", "examTrendNote", "confusingPairNote"]) {
      body[k] = editing[k] ?? "";
    }
    for (const k of ["examplesJson", "synonymsJson", "antonymsJson"] as const) {
      try {
        const v = JSON.parse(jsonText[k] || "[]");
        if (!Array.isArray(v)) throw new Error("not a list");
        body[k] = v;
      } catch {
        setEditError(`"${k}" must be a valid JSON list, e.g. [ { "en": "...", "hi": "..." } ]`);
        return;
      }
    }
    setSaving(true);
    try {
      const r = await fetchAuth(editing.isNew ? `${API_BASE}/vocab/admin/words` : `${API_BASE}/vocab/admin/words/${editing.id}`, {
        method: editing.isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setEditError(Array.isArray(d?.message) ? d.message.join(", ") : d?.message || "Save failed."); return; }
      setEditing(null);
      await loadWords();
    } finally {
      setSaving(false);
    }
  };

  if (!authChecked) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <a href="/admin" className="text-lg font-bold">← Vocabulary Manage</a>
          <a href="/vocabulary" className="btn btn-outline text-sm">Student view →</a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">📤 Bulk Import (Excel)</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Two sheets: <b>Words</b> (the full learning content) + <b>Questions</b> (linked by wordSlug). A word or question that already exists in the system
            is not created again — its content is <b>updated</b> from the new Excel data (an empty cell does not erase the old value; its position and students' progress stay safe).
            A question whose <b>answer</b> or <b>solution</b> is missing is not uploaded — it is listed word-wise in the report.
          </p>
          <div className="mt-3">
            <button
              type="button"
              onClick={async () => {
                setError("");
                try {
                  const r = await fetchAuth(`${API_BASE}/vocab/admin/template`);
                  if (!r.ok) throw new Error(`Template download failed (HTTP ${r.status})`);
                  const blob = await r.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "vocabulary_import_template.xlsx";
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  window.URL.revokeObjectURL(url);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Template download failed");
                }
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              ⬇️ Download Excel template
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" />
            <button
              onClick={submitUpload}
              disabled={uploading || !file}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {uploading ? "Uploading…" : dryRun ? "Check only" : "Upload"}
            </button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            Check only (do not save anything)
          </label>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          {uploadResult && (
            <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3 text-sm">
              {uploadResult.dryRun && <p className="mb-1 font-semibold text-amber-600">Check only — nothing was saved</p>}
              <p>Words: <b className="text-emerald-600">{uploadResult.wordsCreated}</b> new {uploadResult.dryRun ? "to be added" : "added"}, <b className="text-sky-600">{uploadResult.wordsUpdated ?? 0}</b> {uploadResult.dryRun ? "to be updated" : "updated"}, <b className="text-amber-600">{uploadResult.wordsSkipped ?? 0}</b> skipped</p>
              <p>Questions: <b className="text-emerald-600">{uploadResult.questionsCreated}</b> new {uploadResult.dryRun ? "to be added" : "added"}, <b className="text-sky-600">{uploadResult.questionsUpdated ?? 0}</b> {uploadResult.dryRun ? "to be updated" : "updated"}, <b className="text-amber-600">{uploadResult.questionsSkipped ?? 0}</b> skipped</p>
              {(uploadResult.wordReport?.length ?? 0) > 0 && (
                <div className="mt-2">
                  <p className="font-semibold text-amber-600">Word-wise report (what is missing / duplicate):</p>
                  <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto text-xs">
                    {uploadResult.wordReport!.map((w, i) => (
                      <li key={i} className="rounded border border-amber-500/20 bg-amber-500/5 p-1.5">
                        <b>{w.word}</b>
                        {w.wordStatus !== "OK" && <span className="ml-1 text-danger">— {CODE_LABEL[w.wordStatus === "DUPLICATE" ? "DUPLICATE_WORD" : w.wordStatus] ?? w.wordStatus}</span>}
                        {Object.entries(w.rejected).map(([code, n]) => (
                          <span key={code} className="ml-2 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-600">{CODE_LABEL[code] ?? code}: {n}</span>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(uploadResult.skipped?.length ?? 0) > 0 && (
                <div className="mt-2">
                  <p className="font-semibold text-amber-600">{uploadResult.skipped!.length} row(s) skipped:</p>
                  <ul className="mt-1 max-h-40 overflow-y-auto text-xs text-muted-foreground">
                    {uploadResult.skipped!.map((e, i) => (
                      <li key={i}>{e.sheet} row {e.row} · <b>{e.word}</b> · {CODE_LABEL[e.code] ?? e.code}: {e.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              {uploadResult.errors.length > 0 && (
                <div className="mt-2">
                  <p className="font-semibold text-danger">{uploadResult.errors.length} error(s):</p>
                  <ul className="mt-1 max-h-40 overflow-y-auto text-xs text-danger">
                    {uploadResult.errors.map((e, i) => (
                      <li key={i}>{e.sheet} row {e.row}: {e.error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 rounded-xl border border-border bg-card">
          <div className="border-b border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Words ({words.length})</h2>
              <div className="flex gap-2">
              <button
                onClick={openNew}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                + Naya word
              </button>
              <button
                onClick={() => callOrder("normalize")}
                disabled={busyOrder}
                title="Renumber 1..N in the current order (removes gaps / duplicate numbers)"
                className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
              >
                Fix numbering
              </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Type a number in <b>Move to #</b> and press Go (or use ↑ ↓) to put a word at any position — the other words shift automatically.
              Students who could already open a word keep it unlocked.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">#</th>
                  <th className="px-4 py-2">Move to #</th>
                  <th className="px-4 py-2">Word</th>
                  <th className="px-4 py-2">Slug</th>
                  <th className="px-4 py-2">Questions</th>
                  <th className="px-4 py-2">Students</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>}
                {!loading && words.map((w) => (
                  <tr key={w.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 text-muted-foreground">{w.orderIndex}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <button disabled={busyOrder || w.orderIndex <= 1} onClick={() => moveWordTo(w, w.orderIndex - 1)} aria-label="Move up" className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-muted disabled:opacity-30">↑</button>
                        <button disabled={busyOrder || w.orderIndex >= words.length} onClick={() => moveWordTo(w, w.orderIndex + 1)} aria-label="Move down" className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-muted disabled:opacity-30">↓</button>
                        <input
                          type="number"
                          min={1}
                          max={words.length}
                          value={moveTo[w.id] ?? ""}
                          onChange={(e) => setMoveTo((m) => ({ ...m, [w.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") moveWordTo(w, Number(moveTo[w.id])); }}
                          placeholder="#"
                          className="h-7 w-14 rounded border border-border bg-background px-1 text-center text-xs"
                        />
                        <button disabled={busyOrder || !moveTo[w.id]} onClick={() => moveWordTo(w, Number(moveTo[w.id]))} className="rounded border border-primary/40 px-2 py-0.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-30">Go</button>
                      </div>
                    </td>
                    <td className="px-4 py-2 font-medium">{w.word}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{w.slug}</td>
                    <td className="px-4 py-2">{w.questionCount}</td>
                    <td className="px-4 py-2">{w.studentsProgressing}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${w.isActive ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                        {w.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right space-x-1">
                      <button onClick={() => openEdit(w)} className="rounded-lg border border-primary/40 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10">
                        Edit
                      </button>
                      <button onClick={() => toggleActive(w)} className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted">
                        {w.isActive ? "Deactivate" : "Activate"}
                      </button>
                      <button onClick={() => openQuestions(w)} className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted">
                        Questions
                      </button>
                      <button
                        onClick={() => deleteWord(w)}
                        disabled={deleting === w.id}
                        className="rounded-lg border border-danger/30 px-2 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-50"
                      >
                        {deleting === w.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {qPanel && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => !qBusy && setQPanel(null)}>
          <div className="my-6 w-full max-w-2xl rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">Questions — {qPanel.word} ({qPanel.questions.length})</h3>
              <button onClick={() => setQPanel(null)} className="rounded-md px-2 py-1 text-sm hover:bg-muted" aria-label="Close">✕</button>
            </div>
            {!qForm && (
              <button onClick={() => { setQError(""); setQForm(blankQForm()); }} className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                + Naya question
              </button>
            )}
            {qForm && (
              <div className="mt-3 rounded-lg border border-primary/40 bg-muted/20 p-3 text-sm">
                <p className="mb-2 font-semibold">{qForm.id ? "Edit question" : "New question"}</p>
                <textarea
                  rows={2}
                  value={qForm.questionText}
                  onChange={(e) => setQForm({ ...qForm, questionText: e.target.value })}
                  placeholder="Question"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(["A", "B", "C", "D"] as const).map((k) => (
                    <label key={k} className="flex items-center gap-2 text-xs">
                      <input type="radio" name="correct" checked={qForm.correctAnswer === k} onChange={() => setQForm({ ...qForm, correctAnswer: k })} title="Sahi answer" />
                      <span className="font-semibold">{k}</span>
                      <input
                        value={qForm.options[k]}
                        onChange={(e) => setQForm({ ...qForm, options: { ...qForm.options, [k]: e.target.value } })}
                        placeholder={`Option ${k}`}
                        className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                      />
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">Choose the correct answer with the radio button (currently: {qForm.correctAnswer}).</p>
                <textarea
                  rows={2}
                  value={qForm.explanation}
                  onChange={(e) => setQForm({ ...qForm, explanation: e.target.value })}
                  placeholder="Solution / explanation (English)"
                  className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
                <textarea
                  rows={2}
                  value={qForm.explanationHindi}
                  onChange={(e) => setQForm({ ...qForm, explanationHindi: e.target.value })}
                  placeholder="Hindi solution / explanation (optional — shown with the English one after the test)"
                  className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-hindi"
                />
                <select
                  value={qForm.questionType}
                  onChange={(e) => setQForm({ ...qForm, questionType: e.target.value })}
                  className="mt-2 rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                >
                  <option value="">Type (optional)</option>
                  <option value="SYNONYM">SYNONYM</option>
                  <option value="ANTONYM">ANTONYM</option>
                  <option value="CONTEXT">CONTEXT</option>
                </select>
                <div className="mt-3 flex justify-end gap-2">
                  <button onClick={() => setQForm(null)} disabled={qSaving} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted">Cancel</button>
                  <button onClick={saveQuestion} disabled={qSaving} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
                    {qSaving ? "Saving…" : "Save question"}
                  </button>
                </div>
              </div>
            )}
            {qError && <p className="mt-3 text-xs font-medium text-danger">{qError}</p>}
            {qLoading && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
            {!qLoading && qPanel.questions.length === 0 && !qError && (
              <p className="mt-4 text-sm text-muted-foreground">This word has no questions left.</p>
            )}
            <ul className="mt-4 space-y-3">
              {qPanel.questions.map((q, i) => (
                <li key={q.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{i + 1}. {q.questionText}</p>
                    <div className="flex shrink-0 gap-1">
                      <button
                        onClick={() => startEditQuestion(q)}
                        className="rounded-lg border border-primary/40 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteQuestion(q)}
                        disabled={qBusy === q.id}
                        className="rounded-lg border border-danger/30 px-2 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-50"
                      >
                        {qBusy === q.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                  <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    {(Array.isArray(q.optionsJson) ? q.optionsJson : []).map((o) => (
                      <li key={o.key} className={o.key === q.correctAnswer ? "font-semibold text-emerald-600" : ""}>
                        {o.key}. {o.text}{o.key === q.correctAnswer ? "  ✓" : ""}
                      </li>
                    ))}
                  </ul>
                  {q.explanation && <p className="mt-2 text-xs text-muted-foreground">💡 {q.explanation}</p>}
                  {q.explanationHindi && <p className="mt-1 font-hindi text-xs text-muted-foreground">🇮🇳 {q.explanationHindi}</p>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => !saving && setEditing(null)}>
          <div className="my-6 w-full max-w-2xl rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">{editing.isNew ? "Add new word" : `Edit word #${editing.orderIndex}`}</h3>
              <button onClick={() => setEditing(null)} className="rounded-md px-2 py-1 text-sm hover:bg-muted" aria-label="Close">✕</button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {([
                ["word", "Word"],
                ["partOfSpeech", "Part of speech"],
                ["meaningEnglish", "Meaning (English)"],
                ["meaningHindi", "Meaning (Hindi)"],
                ["pronunciation", "Pronunciation"],
              ] as const).map(([k, label]) => (
                <label key={k} className="text-xs font-semibold text-muted-foreground">
                  {label}
                  <input
                    value={editing[k] ?? ""}
                    onChange={(e) => setEditing({ ...editing, [k]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground"
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 grid gap-3">
              {([
                ["memoryTrick", "Memory trick"],
                ["etymology", "Etymology"],
                ["registerNote", "Register / usage note"],
                ["examTrendNote", "Exam trend note"],
                ["confusingPairNote", "Confusing pair note"],
              ] as const).map(([k, label]) => (
                <label key={k} className="text-xs font-semibold text-muted-foreground">
                  {label}
                  <textarea
                    rows={2}
                    value={editing[k] ?? ""}
                    onChange={(e) => setEditing({ ...editing, [k]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground"
                  />
                </label>
              ))}
              {([
                ["examplesJson", "Examples — JSON list of { en, hi }"],
                ["synonymsJson", "Synonyms — JSON list of { word, hindi, sentence }"],
                ["antonymsJson", "Antonyms — JSON list of { word, hindi, sentence }"],
              ] as const).map(([k, label]) => (
                <label key={k} className="text-xs font-semibold text-muted-foreground">
                  {label}
                  <textarea
                    rows={4}
                    value={jsonText[k]}
                    onChange={(e) => setJsonText({ ...jsonText, [k]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs font-normal text-foreground"
                  />
                </label>
              ))}
            </div>
            {editError && <p className="mt-3 text-xs font-medium text-danger">{editError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} disabled={saving} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
              <button onClick={saveEdit} disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                {saving ? "Saving…" : editing.isNew ? "Add word" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
