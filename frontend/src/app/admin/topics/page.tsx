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

type AdminTopic = {
  id: string;
  name: string;
  slug: string;
  chapterId: string;
  chapter: { name: string; slug: string; subject: { name: string } };
};

type AdminSubTopic = {
  id: string;
  name: string;
  nameHindi?: string | null;
  slug: string;
  topicId: string;
  topic: { name: string; slug: string; chapter: { name: string; subject: { name: string } } };
};

// Phase 2 (Sep 2026) — shape returned by POST /bank/admin/upload/taxonomy-excel
type TaxonomyImportResult = {
  sheet: string;
  subjectName: string;
  subjectCreated: boolean;
  chaptersCreated: number;
  topicsCreated: number;
  subTopicsCreated: number;
  rowsProcessed: number;
  warnings: string[];
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
  const [creating, setCreating] = React.useState(false);
  const [createMsg, setCreateMsg] = React.useState("");
  const [createErr, setCreateErr] = React.useState("");

  // Phase 2 — sub-topics under the selected topic (Chapter → Topic → SubTopic).
  const [selectedTopicId, setSelectedTopicId] = React.useState("");
  const [subTopics, setSubTopics] = React.useState<AdminSubTopic[]>([]);
  const [subTopicsLoading, setSubTopicsLoading] = React.useState(false);
  const [subTopicsErr, setSubTopicsErr] = React.useState("");
  const [newSubTopicName, setNewSubTopicName] = React.useState("");
  const [newSubTopicNameHindi, setNewSubTopicNameHindi] = React.useState("");
  const [creatingSubTopic, setCreatingSubTopic] = React.useState(false);
  const [subTopicMsg, setSubTopicMsg] = React.useState("");
  const [subTopicErr, setSubTopicErr] = React.useState("");

  // Phase 2 — bulk syllabus-Excel taxonomy import.
  const [importFile, setImportFile] = React.useState<File | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [importResults, setImportResults] = React.useState<TaxonomyImportResult[] | null>(null);
  const [importErr, setImportErr] = React.useState("");

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

  // Phase 2 — sub-topics under the selected topic.
  const loadSubTopics = React.useCallback(async (topicId: string): Promise<AdminSubTopic[]> => {
    if (!topicId) {
      setSubTopics([]);
      return [];
    }
    setSubTopicsLoading(true);
    setSubTopicsErr("");
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/subtopics?topicId=${encodeURIComponent(topicId)}`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setSubTopicsErr(d?.message || `HTTP ${r.status}`);
        return [];
      }
      const data: AdminSubTopic[] = await r.json();
      setSubTopics(data);
      return data;
    } catch (e) {
      setSubTopicsErr(e instanceof Error ? e.message : "Sub-topics load nahi hue");
      return [];
    } finally {
      setSubTopicsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (authChecked && selectedTopicId) loadSubTopics(selectedTopicId);
    else setSubTopics([]);
  }, [authChecked, selectedTopicId, loadSubTopics]);

  async function createSubTopicHandler() {
    const trimmed = newSubTopicName.trim();
    if (!selectedTopicId) {
      setSubTopicErr("Pehle ek topic select karein");
      return;
    }
    if (!trimmed) {
      setSubTopicErr("Sub-topic ka naam likhein");
      return;
    }
    setCreatingSubTopic(true);
    setSubTopicErr("");
    setSubTopicMsg("");
    try {
      const countBefore = subTopics.length;
      const r = await fetchAuth(`${API_BASE}/bank/admin/subtopics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId: selectedTopicId,
          name: trimmed,
          nameHindi: newSubTopicNameHindi.trim() || undefined,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setSubTopicErr(d?.message || `HTTP ${r.status}`);
        return;
      }
      const created: AdminSubTopic = await r.json();
      setNewSubTopicName("");
      setNewSubTopicNameHindi("");
      const refreshed = await loadSubTopics(selectedTopicId);
      setSubTopicMsg(
        refreshed.length === countBefore
          ? `"${created.name}" pehle se maujood tha — usi ka ID use karein.`
          : `"${created.name}" ban gaya. Ab yeh subTopicId bulk upload sheet mein use kar sakte hain.`,
      );
    } catch (e) {
      setSubTopicErr(e instanceof Error ? e.message : "Sub-topic create nahi hua");
    } finally {
      setCreatingSubTopic(false);
    }
  }

  async function deleteSubTopicHandler(id: string) {
    if (!confirm("Ye sub-topic delete karein? Questions delete nahi honge, bas unse sub-topic tag hat jayega.")) return;
    try {
      const r = await fetchAuth(`${API_BASE}/bank/admin/subtopics/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setSubTopicErr(d?.message || `HTTP ${r.status}`);
        return;
      }
      await loadSubTopics(selectedTopicId);
    } catch (e) {
      setSubTopicErr(e instanceof Error ? e.message : "Delete nahi hua");
    }
  }

  // Phase 2 — bulk syllabus-Excel taxonomy import (Subject → Chapter → Topic
  // → SubTopic in one shot). Closes the "chapterId not found" root cause —
  // once this runs, question-upload Excels can reference the resulting IDs.
  async function importTaxonomyExcel() {
    if (!importFile) {
      setImportErr("Pehle Excel file choose karein");
      return;
    }
    setImporting(true);
    setImportErr("");
    setImportResults(null);
    try {
      const form = new FormData();
      form.append("file", importFile);
      const r = await fetchAuth(`${API_BASE}/bank/admin/upload/taxonomy-excel`, {
        method: "POST",
        body: form,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setImportErr(d?.message || `HTTP ${r.status}`);
        return;
      }
      setImportResults(d.results || []);
      setImportFile(null);
      // refresh whatever's currently on screen so new chapters/topics show up
      await loadSubjects();
      if (selectedSubjectId) await loadChapters(selectedSubjectId);
      if (selectedChapterId) await loadTopics(selectedChapterId);
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : "Import fail ho gaya");
    } finally {
      setImporting(false);
    }
  }

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
        body: JSON.stringify({ chapterId: selectedChapterId, name: trimmed }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setCreateErr(d?.message || `HTTP ${r.status}`);
        return;
      }
      const created: AdminTopic = await r.json();
      setNewName("");
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

        {/* Phase 2 — bulk syllabus-Excel import: Subject → Chapter → Topic →
            SubTopic tree in one shot, bilingual. Closes the "chapterId not
            found in database" error from question-upload Excels — run this
            FIRST, before uploading questions. Expected sheet layout: one
            sheet per subject, row 1 = subject name (English), row 2 =
            subject name (Hindi), then a header row with Chapter No. /
            Chapter / Topic / Sub-Topic columns — same as
            SSC_Exams_Complete_Syllabus_Hindi.xlsx. Each cell can hold
            "English<newline>Hindi" for bilingual names. */}
        <div className="card mt-6 border-primary/30 bg-primary/5 p-4">
          <h2 className="font-semibold">📥 Bulk Import from Syllabus Excel</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Ek Excel se poora Subject → Chapter → Topic → Sub-Topic tree bana dega (bilingual). Question upload
            se PEHLE ye chalayein, warna &quot;chapterId not found&quot; wali error aayegi.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              disabled={importing}
            />
            <button
              onClick={importTaxonomyExcel}
              disabled={importing || !importFile}
              className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {importing ? "Importing..." : "Import Excel"}
            </button>
          </div>
          {importErr && <p className="mt-2 text-sm text-danger">{importErr}</p>}
          {importResults && (
            <div className="mt-3 space-y-2">
              {importResults.map((r) => (
                <div key={r.sheet} className="rounded-lg border border-border bg-background p-3 text-xs">
                  <p className="font-semibold">
                    {r.sheet} → {r.subjectName} {r.subjectCreated ? "(nayi subject)" : ""}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {r.chaptersCreated} chapters, {r.topicsCreated} topics, {r.subTopicsCreated} sub-topics banaye ·{" "}
                    {r.rowsProcessed} rows processed
                  </p>
                  {r.warnings.length > 0 && (
                    <ul className="mt-1 list-inside list-disc text-amber-600">
                      {r.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
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
                      setSelectedTopicId("");
                    }}
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
            </div>

            {/* Step 2: Chapter */}
            {selectedSubjectId && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold text-muted-foreground">
                  2. Chapter चुनें {selectedSubject ? `(${selectedSubject.name})` : ""}
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
                        onClick={() => {
                          setSelectedChapterId(c.id);
                          setSelectedTopicId("");
                        }}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                          selectedChapterId === c.id
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {c.name}
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
                    ➕ New Topic{selectedChapter ? ` — ${selectedChapter.name}` : ""}
                  </h2>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && createTopic()}
                      placeholder="Topic ka naam, jaise 'Noun' ya 'Percentage Basics'"
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
                        <th className="px-4 py-3">Slug</th>
                        <th className="px-4 py-3">Topic ID</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {topicsErr && (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-center text-sm text-danger">{topicsErr}</td>
                        </tr>
                      )}
                      {!topicsErr && topicsLoading && (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">
                            Loading topics...
                          </td>
                        </tr>
                      )}
                      {!topicsErr && !topicsLoading && topics.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">
                            Is chapter mein abhi koi topic nahi hai — upar se pehla topic banayein.
                          </td>
                        </tr>
                      )}
                      {!topicsErr &&
                        !topicsLoading &&
                        topics.map((t) => (
                          <tr
                            key={t.id}
                            className={`border-b border-border last:border-0 ${selectedTopicId === t.id ? "bg-primary/5" : ""}`}
                          >
                            <td className="px-4 py-3 font-medium">{t.name}</td>
                            <td className="px-4 py-3 text-muted-foreground">{t.slug}</td>
                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{t.id}</td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => copyId(t.id)}
                                className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted"
                              >
                                Copy ID
                              </button>
                              <button
                                onClick={() => setSelectedTopicId(t.id)}
                                className={`ml-2 rounded-lg border px-2 py-1 text-xs ${
                                  selectedTopicId === t.id
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border hover:bg-muted"
                                }`}
                              >
                                Sub-topics →
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                {/* Step 4: Sub-topics under selected topic (English chapter
                    example: Noun topic → "Common vs Proper Nouns" sub-topic) */}
                {selectedTopicId && (
                  <>
                    <div className="card mt-6 p-4">
                      <h2 className="font-semibold">
                        ➕ New Sub-Topic
                        {(() => {
                          const t = topics.find((x) => x.id === selectedTopicId);
                          return t ? ` — ${t.name}` : "";
                        })()}
                      </h2>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input
                          value={newSubTopicName}
                          onChange={(e) => setNewSubTopicName(e.target.value)}
                          placeholder="English naam, jaise 'Common vs Proper Nouns'"
                          className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                          disabled={creatingSubTopic}
                        />
                        <input
                          value={newSubTopicNameHindi}
                          onChange={(e) => setNewSubTopicNameHindi(e.target.value)}
                          placeholder="Hindi naam (optional)"
                          className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                          disabled={creatingSubTopic}
                        />
                        <button
                          onClick={createSubTopicHandler}
                          disabled={creatingSubTopic || !newSubTopicName.trim()}
                          className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                        >
                          {creatingSubTopic ? "Creating..." : "Create"}
                        </button>
                      </div>
                      {subTopicErr && <p className="mt-2 text-sm text-danger">{subTopicErr}</p>}
                      {subTopicMsg && <p className="mt-2 text-sm text-success">{subTopicMsg}</p>}
                    </div>

                    <div className="card mt-4 overflow-x-auto p-0">
                      <table className="w-full text-left text-sm">
                        <thead className="border-b border-border text-xs text-muted-foreground">
                          <tr>
                            <th className="px-4 py-3">Sub-Topic</th>
                            <th className="px-4 py-3">Hindi</th>
                            <th className="px-4 py-3">Sub-Topic ID</th>
                            <th className="px-4 py-3"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {subTopicsErr && (
                            <tr>
                              <td colSpan={4} className="px-4 py-6 text-center text-sm text-danger">{subTopicsErr}</td>
                            </tr>
                          )}
                          {!subTopicsErr && subTopicsLoading && (
                            <tr>
                              <td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">
                                Loading sub-topics...
                              </td>
                            </tr>
                          )}
                          {!subTopicsErr && !subTopicsLoading && subTopics.length === 0 && (
                            <tr>
                              <td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">
                                Is topic mein abhi koi sub-topic nahi hai.
                              </td>
                            </tr>
                          )}
                          {!subTopicsErr &&
                            !subTopicsLoading &&
                            subTopics.map((st) => (
                              <tr key={st.id} className="border-b border-border last:border-0">
                                <td className="px-4 py-3 font-medium">{st.name}</td>
                                <td className="px-4 py-3 text-muted-foreground">{st.nameHindi || "—"}</td>
                                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{st.id}</td>
                                <td className="px-4 py-3 text-right">
                                  <button
                                    onClick={() => copyId(st.id)}
                                    className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted"
                                  >
                                    Copy ID
                                  </button>
                                  <button
                                    onClick={() => deleteSubTopicHandler(st.id)}
                                    className="ml-2 rounded-lg border border-danger/30 px-2 py-1 text-xs text-danger hover:bg-danger/10"
                                  >
                                    Delete
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
          </>
        )}
      </main>
    </div>
  );
}
