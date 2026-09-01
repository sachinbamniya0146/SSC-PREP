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
// Backend only exposes LIST + CREATE for chapters (no update/delete route
// exists in bank.controller.ts), and createChapter() is idempotent by
// (subjectId, slug) — re-submitting the same name just returns the
// existing row instead of erroring or duplicating. The UI reflects exactly
// that: no rename/delete controls, and a "already existed" hint after a
// create that didn't grow the list.

import * as React from "react";
import { useRouter } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";

type Subject = {
  id: string;
  name: string;
  slug: string;
  questionCount: number;
  chapterCount: number;
};

type AdminChapter = {
  id: string;
  name: string;
  slug: string;
  subjectId: string;
  subject: { name: string; slug: string };
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
  const [creating, setCreating] = React.useState(false);
  const [createMsg, setCreateMsg] = React.useState("");
  const [createErr, setCreateErr] = React.useState("");

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
        body: JSON.stringify({ subjectId: selectedSubjectId, name: trimmed }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setCreateErr(d?.message || `HTTP ${r.status}`);
        return;
      }
      const created: AdminChapter = await r.json();
      setNewName("");
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
                  {s.name} <span className="opacity-70">({s.chapterCount} ch)</span>
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
                  placeholder="Chapter ka naam, jaise 'Percentage' ya 'Modern History'"
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
                    <th className="px-4 py-3">Slug</th>
                    <th className="px-4 py-3">Chapter ID</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {chaptersErr && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-danger">{chaptersErr}</td>
                    </tr>
                  )}
                  {!chaptersErr && chaptersLoading && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">Loading chapters...</td>
                    </tr>
                  )}
                  {!chaptersErr && !chaptersLoading && chapters.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">
                        Is subject mein abhi koi chapter nahi hai — upar se pehla chapter banayein.
                      </td>
                    </tr>
                  )}
                  {!chaptersErr && !chaptersLoading && chapters.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-medium">{c.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{c.slug}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.id}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => copyId(c.id)}
                          className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted"
                        >
                          Copy ID
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
