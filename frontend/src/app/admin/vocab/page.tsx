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

type UploadResult = {
  success: boolean;
  dryRun?: boolean;
  wordsCreated: number;
  wordsSkipped?: number;
  questionsCreated: number;
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
    if (!file) { setError("Pehle Excel file select karein"); return; }
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

  const deleteWord = async (w: AdminWord) => {
    if (!confirm(`"${w.word}" ko list se hata dein? Word students se chhup jayega, lekin unka unlock/progress safe rahega. Wahi word dobara upload karenge to wo unlock hi dikhega.`)) return;
    await fetchAuth(`${API_BASE}/vocab/admin/words/${w.id}`, { method: "DELETE" });
    await loadWords();
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
            Do sheets: <b>Words</b> (poora learning content) + <b>Questions</b> (wordSlug se link). Duplicate word ya duplicate question
            upload nahi hota (skip hokar report me aata hai). Jis question ka <b>answer</b> ya <b>solution</b> missing hai wo bhi upload nahi hota — report me
            word-wise dikhta hai.
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
              ⬇️ Excel Template download karein
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
            Sirf check karo (kuch save mat karo)
          </label>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          {uploadResult && (
            <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3 text-sm">
              {uploadResult.dryRun && <p className="mb-1 font-semibold text-amber-600">Sirf check hua — kuch save nahi hua</p>}
              <p>Words: <b className="text-emerald-600">{uploadResult.wordsCreated}</b> {uploadResult.dryRun ? "upload honge" : "upload hue"}, <b className="text-amber-600">{uploadResult.wordsSkipped ?? 0}</b> skip</p>
              <p>Questions: <b className="text-emerald-600">{uploadResult.questionsCreated}</b> {uploadResult.dryRun ? "upload honge" : "upload hue"}, <b className="text-amber-600">{uploadResult.questionsSkipped ?? 0}</b> skip</p>
              {(uploadResult.wordReport?.length ?? 0) > 0 && (
                <div className="mt-2">
                  <p className="font-semibold text-amber-600">Word-wise report (kya missing / duplicate hai):</p>
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
                  <p className="font-semibold text-amber-600">{uploadResult.skipped!.length} row(s) skip hui:</p>
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
            <h2 className="font-semibold">Words ({words.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">#</th>
                  <th className="px-4 py-2">Word</th>
                  <th className="px-4 py-2">Slug</th>
                  <th className="px-4 py-2">Questions</th>
                  <th className="px-4 py-2">Students</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>}
                {!loading && words.map((w) => (
                  <tr key={w.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 text-muted-foreground">{w.orderIndex}</td>
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
                      <button onClick={() => toggleActive(w)} className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted">
                        {w.isActive ? "Deactivate" : "Activate"}
                      </button>
                      <button onClick={() => deleteWord(w)} className="rounded-lg border border-danger/30 px-2 py-1 text-xs text-danger hover:bg-danger/10">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
