"use client";

// Chapter Management panel — admin UI for GET/POST /bank/admin/chapters
// (backend/src/bank/bank.service.ts listAllChaptersForAdmin() / createChapter()).
//
// SESSION 14 FIX (see next-session-prompt-session14.md pending item #1):
// backend/src/bank-upload/bank-upload.service.ts's validateReferences()
// requires every uploaded question row to carry a valid, pre-existing
// chapterId — it will NOT create a chapter on the fly. But there was no
// page anywhere to actually create one. On a subject with zero chapters
// (e.g. a brand-new subject, or the current still-growing question bank)
// this made the entire Bulk Question Upload flow (frontend/src/app/admin
// /page.tsx) a dead end: every row would fail "chapterId not found" with
// no way to fix it from the UI. This page closes that gap.
//
// createChapter() is idempotent by (subjectId, slug) — re-submitting the
// same name just returns the existing row instead of erroring or
// duplicating, and the UI shows an "already existed" hint when that happens.
//
// UPDATED (Sep 21 2026): rename / delete / merge added, backed by the new
// /bank/admin/manage/chapters/:id routes (BankAdminController). Delete only
// works on an EMPTY chapter (0 questions, 0 paid purchases) — otherwise use
// Merge, which folds a duplicate chapter's topics/sub-topics/questions/paid
// purchases into another chapter of the SAME subject (same-slug topics are
// combined, not duplicated) and then deletes the empty duplicate. This is
// the fix for a duplicate chapter like the two "Spotting Errors" rows shown
// on the syllabus screen.

import * as React from "react";
import { useRouter } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";

type Subject = {
  id: string;
  name: string;
  nameHindi?: string | null;
  slug: string;
  questionCount: number;
  chapterCount: number;
};

type AdminChapter = {
  id: string;
  name: string;
  nameHindi?: string | null;
  slug: string;
  subjectId: string;
  subject: { name: string; nameHindi?: string | null; slug: string };
  _count?: { questions: number; topics: number };
};

export default function ChapterManagementPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = React.useState(false);

  const [subjects, setSubjects] = React.useState<Subject[]>([]);
  const [subjectsLoading, setSubjectsLoading] = React.useState(true);
  const [subjectsErr, setSubjectsErr] = React.useState("");

  const [selectedSubjectId, setSelectedSubjectId] = React.useState("");
  const [chapters, setChapters] = React.useState<AdminChapter[]>([]);
  const [chaptersLoading, setChaptersLoading] = React.useState(false);
  const [chaptersErr, setChaptersErr] = React.useState("");

  const [newName, setNewName] = React.useState("");
  const [newNameHindi, setNewNameHindi] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [createMsg, setCreateMsg] = React.useState("");
  const [createErr, setCreateErr] = React.useState("");

  // NEW (Sep 21 2026) — inline rename + delete + merge for an existing chapter.
  const [editingId, setEditingId] = React.useState("");
  const [editName, setEditName] = React.useState("");
  const [editNameHindi, setEditNameHindi] = React.useState("");
  const [rowBusyId, setRowBusyId] = React.useState("");
  const [rowErr, setRowErr] = React.useState("");
  const [mergeSourceId, setMergeSourceId] = React.useState("");
  const [mergeTargetId, setMergeTargetId] = React.useState("");

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem("ssc_user");
      const user = raw ? JSON.parse(raw) : null;
      const isAdmin = user?.role === "ADMIN" || user?.role === "MODERATOR";
      if (!isAdmin) {
        router.replace("/dashboard");
        return;
      }
    } catch {
      router.replace("/dashboard");
      return;
    }
    setAuthChecked(true);
  }, [router]);

  const loadSubjects = React.useCallback(async () => {
    setSubjectsLoading(true);
    setSubjectsErr("");
    try {
      const r = await fetchAuth(`${API_BASE}/bank/subjects`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setSubjectsErr(d?.message || `HTTP ${r.status}`);
        return;
      }
      const data: Subject[] = await r.json();
      setSubjects(data);
      // Default to the first subject so the page isn't blank on load.
      setSelectedSubjectId((prev) => prev || data[0]?.id || "");
    } catch (e) {
      setSubjectsErr(e instanceof Error ? e.message : "Subjects load nahi hue");
    } finally {
      setSubjectsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (authChecked) loadSubjects();
  }, [authChecked, loadSubjects]);

  // Returns the freshly-fetched list (not just setting state) so callers
  // like createChapter() can compare before/after counts without relying on
  // the `chapters` state closure, which wouldn't reflect this update until
  // the next render.
  const loadChapters = React.useCallback(async (subjectId: string): Promise<AdminChapter[]> => {
    if (!subjectId) {
      setChapters([]);
      return [];
    }
    setChaptersLoading(true);
    setChaptersErr("");
    try {
      const r = await fetchAuth(
        `${API_BASE}/bank/admin/chapters?subjectId=${encodeURIComponent(subjectId)}`,
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setChaptersErr(d?.message || `HTTP ${r.status}`);
        return [];
      }
      const data: AdminChapter[] = await r.json();
      setChapters(data);
      return data;
    } catch (e) {
      setChaptersErr(e instanceof Error ? e.message : "Chapters load nahi hue");
      return [];
    } finally {
      setChaptersLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (authChecked && selectedSubjectId) loadChapters(selectedSubjectId);
  }, [authChecked, selectedSubjectId, loadChapters]);

  const selectedSubject = React.useMemo(
    () => subjects.find((s) => s.id === selectedSubjectId) || null,
    [subjects, selectedSubjectId],
  );

  async function createChapter() {
    const trimmed = newName.trim();
    if (!selectedSubjectId) {
      setCreateErr("Pehle ek subject select karein");
      return;
    }
    if (!trimmed) {
      setCreateErr("Chapter ka naam likhein");
      return;
    }
    setCreating(true);
    setCreateErr("");
    setCreateMsg("");
    try {
      const countBefore = chapters.length;
      const r = await fetchAuth(`${API_BASE}/bank/admin/chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId: selectedSubjectId, name: trimmed, nameHindi: newNameHindi.trim() || undefined }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setCreateErr(d?.message || `HTTP ${r.status}`);
        return;
      }
      const created: AdminChapter = await r.json();
      setNewName("");
      setNewNameHindi("");
      const refreshed = await loadChapters(selectedSubjectId);
      // createChapter() on the backend is idempotent by (subjectId, slug) —
      // if the list didn't grow, this name already existed and the
      // existing chapter was returned instead of a new one.
      setCreateMsg(
        refreshed.length === countBefore
          ? `"${created.name}" pehle se maujood tha — usi ka ID use karein (koi duplicate nahi bana).`
          : `"${created.name}" ban gaya. Ab yeh chapterId bulk upload sheet mein use kar sakte hain.`,
      );
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : "Chapter create nahi hua");
    } finally {
      setCreating(false);
    }
  }

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCreateMsg("Chapter ID copy ho gaya.");
    } catch {
      // Clipboard API can be unavailable (older browsers, insecure
      // context) — the ID is still visible in the row for manual copy.
    }
  }

  function startEdit(c: AdminChapter) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditNameHindi(c.nameHindi || "");
    setRowErr("");
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) { setRowErr("Chapter ka naam khali nahi ho sakta"); return; }
    setRowBusyId(id);
    setRowErr("");
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/manage/chapters/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), nameHindi: editNameHindi.trim() || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setRowErr(d?.message || `HTTP ${r.status}`); return; }
      setEditingId("");
      await loadChapters(selectedSubjectId);
    } catch (e) {
      setRowErr(e instanceof Error ? e.message : "Rename nahi hua");
    } finally {
      setRowBusyId("");
    }
  }

  async function deleteChapterRow(c: AdminChapter) {
    if (!confirm(`"${c.name}" chapter delete karein? (Sirf tabhi hoga agar isme koi question na ho.)`)) return;
    setRowBusyId(c.id);
    setRowErr("");
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/manage/chapters/${c.id}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setRowErr(d?.message || `HTTP ${r.status}`); return; }
      await loadChapters(selectedSubjectId);
    } catch (e) {
      setRowErr(e instanceof Error ? e.message : "Delete nahi hua");
    } finally {
      setRowBusyId("");
    }
  }

  async function mergeChapters() {
    if (!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId) {
      setRowErr("Merge ke liye alag-alag source aur target chapter chunein");
      return;
    }
    const src = chapters.find((c) => c.id === mergeSourceId);
    if (!confirm(`"${src?.name}" ke sabhi topics/questions doosre chapter me move karke "${src?.name}" delete kar diya jayega. Continue?`)) return;
    setRowBusyId(mergeSourceId);
    setRowErr("");
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/manage/chapters/${mergeSourceId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: mergeTargetId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setRowErr(d?.message || `HTTP ${r.status}`); return; }
      setMergeSourceId("");
      setMergeTargetId("");
      await loadChapters(selectedSubjectId);
    } catch (e) {
      setRowErr(e instanceof Error ? e.message : "Merge nahi hua");
    } finally {
      setRowBusyId("");
    }
  }

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Checking access...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">← <span className="text-primary">SSC</span>PrepHub</a>
          <span className="text-sm text-muted-foreground">🧩 Chapter Management</span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-bold">🧩 Chapter Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bulk question upload ke liye har row ko ek valid chapterId chahiye — yahan se subject ke andar naye chapters banayein aur unke ID copy karein.
        </p>

        {subjectsErr && (
          <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{subjectsErr}</p>
        )}

        {subjectsLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">Loading subjects...</p>
        ) : subjects.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">Koi subject nahi mila.</p>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap gap-2">
              {subjects.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSubjectId(s.id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    selectedSubjectId === s.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {s.name}{s.nameHindi ? ` / ${s.nameHindi}` : ""} <span className="opacity-70">({s.chapterCount} ch)</span>
                </button>
              ))}
            </div>

            {/* Create chapter form */}
            <div className="card mt-6 p-4">
              <h2 className="font-semibold">
                ➕ New Chapter{selectedSubject ? ` — ${selectedSubject.name}` : ""}
              </h2>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createChapter()}
                  placeholder="Chapter ka naam (English), jaise 'Percentage' ya 'Modern History'"
                  className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                  disabled={!selectedSubjectId || creating}
                />
                <input
                  value={newNameHindi}
                  onChange={(e) => setNewNameHindi(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createChapter()}
                  placeholder="Hindi naam (optional), jaise 'प्रतिशत'"
                  className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                  disabled={!selectedSubjectId || creating}
                />
                <button
                  onClick={createChapter}
                  disabled={!selectedSubjectId || creating || !newName.trim()}
                  className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create"}
                </button>
              </div>
              {createErr && <p className="mt-2 text-sm text-danger">{createErr}</p>}
              {createMsg && <p className="mt-2 text-sm text-success">{createMsg}</p>}
            </div>

            {/* Existing chapters for the selected subject */}
            <div className="card mt-4 overflow-x-auto p-0">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Chapter</th>
                    <th className="px-4 py-3">हिंदी नाम</th>
                    <th className="px-4 py-3">Slug</th>
                    <th className="px-4 py-3">Chapter ID</th>
                    <th className="px-4 py-3">Questions</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {chaptersErr && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-sm text-danger">{chaptersErr}</td>
                    </tr>
                  )}
                  {!chaptersErr && chaptersLoading && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">Loading chapters...</td>
                    </tr>
                  )}
                  {!chaptersErr && !chaptersLoading && chapters.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">
                        Is subject mein abhi koi chapter nahi hai — upar se pehla chapter banayein.
                      </td>
                    </tr>
                  )}
                  {!chaptersErr && !chaptersLoading && chapters.map((c) =>
                    editingId === c.id ? (
                      <tr key={c.id} className="border-b border-border last:border-0 bg-primary/5">
                        <td className="px-4 py-2">
                          <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full rounded border border-border bg-background px-2 py-1 text-sm" />
                        </td>
                        <td className="px-4 py-2">
                          <input value={editNameHindi} onChange={(e) => setEditNameHindi(e.target.value)} className="w-full rounded border border-border bg-background px-2 py-1 text-sm" />
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{c.slug}</td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{c.id}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{c._count?.questions ?? "—"}</td>
                        <td className="px-4 py-2 text-right space-x-1">
                          <button onClick={() => saveEdit(c.id)} disabled={rowBusyId === c.id} className="rounded-lg bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50">Save</button>
                          <button onClick={() => setEditingId("")} className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted">Cancel</button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={c.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 font-medium">{c.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{c.nameHindi || "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{c.slug}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.id}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{c._count?.questions ?? "—"}</td>
                        <td className="px-4 py-3 text-right space-x-1">
                          <button onClick={() => copyId(c.id)} className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted">Copy ID</button>
                          <button onClick={() => startEdit(c)} className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted">Rename</button>
                          <button onClick={() => deleteChapterRow(c)} disabled={rowBusyId === c.id} className="rounded-lg border border-danger/30 px-2 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-50">Delete</button>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>

            {rowErr && <p className="mt-2 text-sm text-danger">{rowErr}</p>}

            {/* Merge — for duplicate chapters under this subject (e.g. two
                "Spotting Errors" chapters shown on the syllabus screen). */}
            {chapters.length > 1 && (
              <div className="card mt-4 p-4">
                <h2 className="font-semibold">🔀 Merge duplicate chapters</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Source chapter ke sabhi topics/sub-topics/questions/paid purchases target chapter me chale jayenge, phir source delete ho jayega.
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div>
                    <label className="block text-xs text-muted-foreground">Source (ye delete hoga)</label>
                    <select value={mergeSourceId} onChange={(e) => setMergeSourceId(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
                      <option value="">—</option>
                      {chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground">Target (ismein merge hoga)</label>
                    <select value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
                      <option value="">—</option>
                      {chapters.filter((c) => c.id !== mergeSourceId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <button onClick={mergeChapters} disabled={!mergeSourceId || !mergeTargetId || rowBusyId === mergeSourceId} className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary disabled:opacity-40">
                    Merge
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
