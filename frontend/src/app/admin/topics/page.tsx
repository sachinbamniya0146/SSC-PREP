"use client";

// Topic Management panel — admin UI for GET/POST /bank/admin/topics
// (backend/src/bank/bank.service.ts listAllTopicsForAdmin() / createTopic()).
//
// NEW ("chapter mein bhi topic hona tha jaise English mein Noun, Pronoun —
// vesa har subject mein"): the Topic model (Chapter → Topic → SubTopic)
// already existed in schema.prisma and questions already carry an optional
// topicId, but there was no page anywhere to create one — the exact same
// gap Chapter Management (frontend/src/app/admin/chapters/page.tsx) closed
// for chapters, one level deeper. Same idempotent-by-slug behavior, same
// no-rename/no-delete-because-backend-doesn't-expose-it design.

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
};

type AdminTopic = {
  id: string;
  name: string;
  nameHindi?: string | null;
  slug: string;
  chapterId: string;
  chapter: { name: string; nameHindi?: string | null; slug: string; subject: { name: string; nameHindi?: string | null } };
};

type TaxonomyImportSummary = {
  subjects: number;
  chapters: number;
  topics: number;
  subTopics: number;
  details: { subject: string; chapters: number; topics: number; subTopics: number }[];
};

export default function TopicManagementPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = React.useState(false);

  const [subjects, setSubjects] = React.useState<Subject[]>([]);
  const [subjectsLoading, setSubjectsLoading] = React.useState(true);
  const [subjectsErr, setSubjectsErr] = React.useState("");
  const [selectedSubjectId, setSelectedSubjectId] = React.useState("");

  const [chapters, setChapters] = React.useState<AdminChapter[]>([]);
  const [chaptersLoading, setChaptersLoading] = React.useState(false);
  const [chaptersErr, setChaptersErr] = React.useState("");
  const [selectedChapterId, setSelectedChapterId] = React.useState("");

  const [topics, setTopics] = React.useState<AdminTopic[]>([]);
  const [topicsLoading, setTopicsLoading] = React.useState(false);
  const [topicsErr, setTopicsErr] = React.useState("");

  const [newName, setNewName] = React.useState("");
  const [newNameHindi, setNewNameHindi] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [createMsg, setCreateMsg] = React.useState("");
  const [createErr, setCreateErr] = React.useState("");

  // Bulk syllabus (taxonomy) import — upload a bilingual syllabus workbook
  // laid out like SSC_Exams_Complete_Syllabus_Hindi.xlsx and it gets upserted
  // straight into Subject -> Chapter -> Topic -> SubTopic via
  // POST /bank/admin/upload/syllabus-excel (TaxonomyImportService).
  const [syllabusFile, setSyllabusFile] = React.useState<File | null>(null);
  const [syllabusUploading, setSyllabusUploading] = React.useState(false);
  const [syllabusErr, setSyllabusErr] = React.useState("");
  const [syllabusResult, setSyllabusResult] = React.useState<TaxonomyImportSummary | null>(null);

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
      setSelectedChapterId((prev) =>
        data.some((c) => c.id === prev) ? prev : data[0]?.id || "",
      );
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

  const loadTopics = React.useCallback(async (chapterId: string): Promise<AdminTopic[]> => {
    if (!chapterId) {
      setTopics([]);
      return [];
    }
    setTopicsLoading(true);
    setTopicsErr("");
    try {
      const r = await fetchAuth(
        `${API_BASE}/bank/admin/topics?chapterId=${encodeURIComponent(chapterId)}`,
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setTopicsErr(d?.message || `HTTP ${r.status}`);
        return [];
      }
      const data: AdminTopic[] = await r.json();
      setTopics(data);
      return data;
    } catch (e) {
      setTopicsErr(e instanceof Error ? e.message : "Topics load nahi hue");
      return [];
    } finally {
      setTopicsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (authChecked && selectedChapterId) loadTopics(selectedChapterId);
    else setTopics([]);
  }, [authChecked, selectedChapterId, loadTopics]);

  const selectedSubject = React.useMemo(
    () => subjects.find((s) => s.id === selectedSubjectId) || null,
    [subjects, selectedSubjectId],
  );
  const selectedChapter = React.useMemo(
    () => chapters.find((c) => c.id === selectedChapterId) || null,
    [chapters, selectedChapterId],
  );

  async function createTopic() {
    const trimmed = newName.trim();
    if (!selectedChapterId) {
      setCreateErr("Pehle ek chapter select karein");
      return;
    }
    if (!trimmed) {
      setCreateErr("Topic ka naam likhein");
      return;
    }
    setCreating(true);
    setCreateErr("");
    setCreateMsg("");
    try {
      const countBefore = topics.length;
      const r = await fetchAuth(`${API_BASE}/bank/admin/topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId: selectedChapterId, name: trimmed, nameHindi: newNameHindi.trim() || undefined }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setCreateErr(d?.message || `HTTP ${r.status}`);
        return;
      }
      const created: AdminTopic = await r.json();
      setNewName("");
      setNewNameHindi("");
      const refreshed = await loadTopics(selectedChapterId);
      setCreateMsg(
        refreshed.length === countBefore
          ? `"${created.name}" pehle se maujood tha — usi ka ID use karein (koi duplicate nahi bana).`
          : `"${created.name}" ban gaya. Ab yeh topicId bulk upload sheet mein use kar sakte hain.`,
      );
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : "Topic create nahi hua");
    } finally {
      setCreating(false);
    }
  }

  async function submitSyllabusUpload() {
    if (!syllabusFile) {
      setSyllabusErr("Pehle syllabus Excel file select karein");
      return;
    }
    setSyllabusUploading(true);
    setSyllabusErr("");
    setSyllabusResult(null);
    try {
      const formData = new FormData();
      formData.append("file", syllabusFile);
      const r = await fetchAuth(`${API_BASE}/bank/admin/upload/syllabus-excel`, {
        method: "POST",
        body: formData,
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) {
        throw new Error((data as { message?: string } | null)?.message || `Upload failed (HTTP ${r.status})`);
      }
      setSyllabusResult(data as TaxonomyImportSummary);
      // Newly created subjects/chapters/topics won't show up until we reload.
      await loadSubjects();
      if (selectedSubjectId) await loadChapters(selectedSubjectId);
      if (selectedChapterId) await loadTopics(selectedChapterId);
    } catch (e) {
      setSyllabusErr(e instanceof Error ? e.message : "Syllabus upload nahi hua");
    } finally {
      setSyllabusUploading(false);
    }
  }

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCreateMsg("Topic ID copy ho gaya.");
    } catch {
      // Clipboard API unavailable — ID is still visible for manual copy.
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
          <a href="/dashboard" className="text-lg font-bold">
            ← <span className="text-primary">SSC</span>PrepHub
          </a>
          <span className="text-sm text-muted-foreground">🏷️ Topic Management</span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-bold">🏷️ Topic Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Har chapter ke andar topics banayein — jaise English chapter mein Noun, Pronoun, Tenses.
          Question upload karte waqt topicId (optional) daalne se analysis aur weak-area report topic-level
          tak drill ho paayega.
        </p>

        {/* Bulk syllabus import — upload SSC_Exams_Complete_Syllabus_Hindi.xlsx-style
            workbook and it upserts straight into Subject -> Chapter -> Topic -> SubTopic,
            with English + Hindi names both saved. Safe to re-run on the same or an edited file. */}
        <div className="card mt-6 p-4">
          <h2 className="font-semibold">📘 Bulk Syllabus Import (Excel)</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            SSC_Exams_Complete_Syllabus_Hindi.xlsx jaisi file upload karein — Subject, Chapter, Topic, Sub-Topic
            (English + Hindi dono naam) seedhe database mein ban jayenge. Dobara upload karna bhi safe hai,
            duplicate nahi banega.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 min-w-[220px]">
              <label className="mb-1.5 block text-sm font-medium">Syllabus File</label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setSyllabusFile(e.target.files?.[0] ?? null)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <button
              onClick={submitSyllabusUpload}
              disabled={syllabusUploading || !syllabusFile}
              className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {syllabusUploading ? "Importing..." : "Import Syllabus"}
            </button>
          </div>

          {syllabusErr && <p className="mt-3 text-sm text-danger">{syllabusErr}</p>}

          {syllabusResult && (
            <div className="mt-4 rounded-lg border border-border bg-background p-3 text-sm">
              <div className="flex flex-wrap items-center gap-4">
                <span>Subjects: <strong>{syllabusResult.subjects}</strong></span>
                <span>Chapters: <strong>{syllabusResult.chapters}</strong></span>
                <span>Topics: <strong>{syllabusResult.topics}</strong></span>
                <span>Sub-Topics: <strong>{syllabusResult.subTopics}</strong></span>
              </div>
              <div className="mt-3 space-y-1">
                {syllabusResult.details.map((d) => (
                  <p key={d.subject} className="text-xs text-muted-foreground">
                    <strong className="text-foreground">{d.subject}</strong> — {d.chapters} chapters, {d.topics} topics,{" "}
                    {d.subTopics} sub-topics
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        {subjectsErr && (
          <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{subjectsErr}</p>
        )}

        {subjectsLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">Loading subjects...</p>
        ) : subjects.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">Koi subject nahi mila.</p>
        ) : (
          <>
            {/* Step 1: Subject */}
            <div className="mt-6">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">1. Subject चुनें</p>
              <div className="flex flex-wrap gap-2">
                {subjects.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSelectedSubjectId(s.id);
                      setSelectedChapterId("");
                    }}
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
            </div>

            {/* Step 2: Chapter */}
            {selectedSubjectId && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold text-muted-foreground">
                  2. Chapter चुनें {selectedSubject ? `(${selectedSubject.name}${selectedSubject.nameHindi ? ` / ${selectedSubject.nameHindi}` : ""})` : ""}
                </p>
                {chaptersErr && <p className="text-sm text-danger">{chaptersErr}</p>}
                {chaptersLoading ? (
                  <p className="text-sm text-muted-foreground">Loading chapters...</p>
                ) : chapters.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Is subject mein koi chapter nahi hai.{" "}
                    <a href="/admin/chapters" className="font-semibold text-primary underline">
                      Pehle chapter banayein →
                    </a>
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {chapters.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setSelectedChapterId(c.id)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                          selectedChapterId === c.id
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {c.name}{c.nameHindi ? ` / ${c.nameHindi}` : ""}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Topics under selected chapter */}
            {selectedChapterId && (
              <>
                <div className="card mt-6 p-4">
                  <h2 className="font-semibold">
                    ➕ New Topic{selectedChapter ? ` — ${selectedChapter.name}${selectedChapter.nameHindi ? ` / ${selectedChapter.nameHindi}` : ""}` : ""}
                  </h2>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && createTopic()}
                      placeholder="Topic ka naam (English), jaise 'Noun' ya 'Percentage Basics'"
                      className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                      disabled={creating}
                    />
                    <input
                      value={newNameHindi}
                      onChange={(e) => setNewNameHindi(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && createTopic()}
                      placeholder="Hindi naam (optional), jaise 'संज्ञा'"
                      className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                      disabled={creating}
                    />
                    <button
                      onClick={createTopic}
                      disabled={creating || !newName.trim()}
                      className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      {creating ? "Creating..." : "Create"}
                    </button>
                  </div>
                  {createErr && <p className="mt-2 text-sm text-danger">{createErr}</p>}
                  {createMsg && <p className="mt-2 text-sm text-success">{createMsg}</p>}
                </div>

                <div className="card mt-4 overflow-x-auto p-0">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-border text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Topic</th>
                        <th className="px-4 py-3">हिंदी नाम</th>
                        <th className="px-4 py-3">Slug</th>
                        <th className="px-4 py-3">Topic ID</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {topicsErr && (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-sm text-danger">{topicsErr}</td>
                        </tr>
                      )}
                      {!topicsErr && topicsLoading && (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">
                            Loading topics...
                          </td>
                        </tr>
                      )}
                      {!topicsErr && !topicsLoading && topics.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">
                            Is chapter mein abhi koi topic nahi hai — upar se pehla topic banayein.
                          </td>
                        </tr>
                      )}
                      {!topicsErr &&
                        !topicsLoading &&
                        topics.map((t) => (
                          <tr key={t.id} className="border-b border-border last:border-0">
                            <td className="px-4 py-3 font-medium">{t.name}</td>
                            <td className="px-4 py-3 text-muted-foreground">{t.nameHindi || "—"}</td>
                            <td className="px-4 py-3 text-muted-foreground">{t.slug}</td>
                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{t.id}</td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => copyId(t.id)}
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
          </>
        )}
      </main>
    </div>
  );
}
