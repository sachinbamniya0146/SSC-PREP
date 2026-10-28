"use client";
import * as React from "react";
import { api } from "@/lib/api";
import { StemMedia, OptionBody, RichText } from "@/components/QuestionMedia";
import { SkeletonCards } from "@/components/Skeleton";
import { clearBookmarkCache } from "@/lib/bookmark-store";
import { useFeatures } from "@/lib/features";
import { useT } from "@/lib/i18n";
import { ShellHeader } from "@/components/AppShell";

type Opt = { key: string; text: string; textHi?: string | null; diagramType?: string | null; diagramLabels?: (string | null)[] | null; imageUrl?: string | null };
type Bm = {
  bookmarkedAt: string;
  question: {
    id: string;
    questionNo?: number | null;
    paperQuestionNo?: number | null;
    questionText: string;
    questionTextHindi: string | null;
    questionDiagramType?: string | null;
    questionDiagramLabels?: (string | null)[] | null;
    questionImageUrl?: string | null;
    options: Opt[];
    // The server fills these in only once the student has finished a test / practice set with the question,
    // so bookmarking alone can never reveal the answer key.
    correctAnswer: string | null;
    explanation: string | null;
    explanationHindi?: string | null;
    attempted: boolean;
    examName?: string;
    subject: string | null;
    chapter?: string | null;
    topic?: string | null;
    year?: number | null;
    shift?: string | null;
  };
  myAnswer?: { selectedOption: string | null; isCorrect: boolean; attemptId: string } | null;
  note?: string | null;
};
type Resp = { total: number; offset: number; hasMore: boolean; subjects: { id: string; name: string; count: number }[]; bookmarks: Bm[] };

const PAGE = 20;

export default function BookmarksPage() {
  const tr = useT();
  const { on } = useFeatures();
  const [items, setItems] = React.useState<Bm[]>([]);
  const [total, setTotal] = React.useState(0);
  const [subjects, setSubjects] = React.useState<Resp["subjects"]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [moreBusy, setMoreBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [subjectId, setSubjectId] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [q, setQ] = React.useState("");
  const [wrongOnly, setWrongOnly] = React.useState(false);
  const [editingNoteId, setEditingNoteId] = React.useState("");
  const [noteDraft, setNoteDraft] = React.useState("");
  const [noteBusyId, setNoteBusyId] = React.useState("");
  const [removing, setRemoving] = React.useState<Set<string>>(new Set());
  const [startingPractice, setStartingPractice] = React.useState(false);
  const [practiceError, setPracticeError] = React.useState("");
  const [showHindi, setShowHindi] = React.useState(true);
  const reqId = React.useRef(0);

  // search box -> query, after a short pause
  React.useEffect(() => {
    const t = window.setTimeout(() => setQ(search.trim()), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  const params = React.useCallback(
    (offset: number) => {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (subjectId) p.set("subjectId", subjectId);
      if (q) p.set("q", q);
      if (wrongOnly) p.set("wrongOnly", "1");
      return p.toString();
    },
    [subjectId, q, wrongOnly],
  );

  const load = React.useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError("");
    try {
      const d = await api<Resp>(`/bookmarks?${params(0)}`);
      if (id !== reqId.current) return;
      setItems(d.bookmarks || []);
      setTotal(d.total ?? 0);
      setSubjects(d.subjects || []);
      setHasMore(!!d.hasMore);
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e instanceof Error ? e.message : tr("Failed to load bookmarks", "Bookmarks load nahi hue"));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    const id = reqId.current;
    setMoreBusy(true);
    try {
      const d = await api<Resp>(`/bookmarks?${params(items.length)}`);
      if (id !== reqId.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((b) => b.question.id));
        return [...prev, ...(d.bookmarks || []).filter((b) => !seen.has(b.question.id))];
      });
      setHasMore(!!d.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setMoreBusy(false);
    }
  };

  const remove = async (qid: string) => {
    setRemoving((s) => new Set(s).add(qid));
    try {
      await api(`/bookmarks/${qid}/toggle`, { method: "POST" });
      setItems((prev) => prev.filter((b) => b.question.id !== qid));
      setTotal((t) => Math.max(0, t - 1));
      clearBookmarkCache();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setRemoving((s) => {
        const n = new Set(s);
        n.delete(qid);
        return n;
      });
    }
  };

  const saveNote = async (questionId: string) => {
    const text = noteDraft.trim();
    setNoteBusyId(questionId);
    try {
      if (!text) {
        await api(`/bookmarks/${questionId}/note`, { method: "DELETE" });
        setItems((prev) => prev.map((b) => (b.question.id === questionId ? { ...b, note: null } : b)));
      } else {
        await api(`/bookmarks/${questionId}/note`, { method: "POST", body: JSON.stringify({ content: text }) });
        setItems((prev) => prev.map((b) => (b.question.id === questionId ? { ...b, note: text } : b)));
      }
      setEditingNoteId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setNoteBusyId("");
    }
  };

  const practice = async () => {
    setStartingPractice(true);
    setPracticeError("");
    try {
      const d = await api<unknown>(`/bookmarks/practice-set${subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : ""}`);
      sessionStorage.setItem("ssc_sectional_set", JSON.stringify(d));
      const sub = subjects.find((s) => s.id === subjectId)?.name;
      sessionStorage.setItem("ssc_sectional_subject", `🔖 ${sub ? `${sub} · ` : ""}My Bookmarks`);
      window.location.href = "/test?sectional=1";
    } catch (e) {
      setPracticeError(e instanceof Error ? e.message : tr("Could not create the practice set", "Practice set nahi ban paya"));
    } finally {
      setStartingPractice(false);
    }
  };

  const allCount = subjects.reduce((a, s) => a + s.count, 0);
  const filtering = !!(subjectId || q || wrongOnly);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ShellHeader />

      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">★ {tr("My Bookmarks", "Mere Bookmarks")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {tr("Questions you saved for revision", "Revision ke liye save kiye sawal")} ({filtering ? `${total} / ${allCount}` : allCount || total})
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href="/question-bank" className="btn btn-outline">{tr("Browse Bank", "Bank dekho")}</a>
            {total > 0 && (
              <button onClick={practice} disabled={startingPractice} className="btn btn-primary">
                {startingPractice ? tr("Starting…", "Shuru ho raha…") : `🚀 ${tr("Practice", "Practice")} ${subjectId ? tr("this subject", "ye subject") : tr("my bookmarks", "mere bookmarks")}`}
              </button>
            )}
          </div>
        </div>
        {practiceError && <p className="mt-2 text-sm text-danger">{practiceError}</p>}
        {!on("bookmarks") && (
          <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">
            {tr("Saving new bookmarks is paused for now. You can still read and remove the ones you have.", "Naye bookmark abhi band hain. Purane dekh aur hata sakte ho.")}
          </p>
        )}

        {/* filters */}
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr("Search text, chapter, topic or question no.", "Text, chapter, topic ya question no. search karo")}
              className="min-w-0 flex-1 border bg-background px-3 py-2 text-sm"
              aria-label="Search bookmarks"
            />
            <button
              onClick={() => setWrongOnly((v) => !v)}
              aria-pressed={wrongOnly}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${wrongOnly ? "border-danger bg-danger/10 text-danger" : "border-border text-muted-foreground hover:bg-muted"}`}
            >
              ✗ {tr("Wrong in my last test", "Last test me galat")}
            </button>
            <button
              onClick={() => setShowHindi((v) => !v)}
              aria-pressed={showHindi}
              className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
            >
              {showHindi ? "EN + हिंदी" : "EN"}
            </button>
          </div>
          {subjects.length > 1 && (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              <Chip active={!subjectId} onClick={() => setSubjectId("")}>{tr("All", "Sab")} · {allCount}</Chip>
              {subjects.map((s) => (
                <Chip key={s.id} active={subjectId === s.id} onClick={() => setSubjectId(s.id)}>
                  {s.name} · {s.count}
                </Chip>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="card mt-4 flex items-center justify-between gap-3 p-4 text-sm text-danger">
            <span>{error}</span>
            <button onClick={load} className="btn btn-outline btn-sm">{tr("Retry", "Dobara")}</button>
          </div>
        )}

        {loading ? (
          <div className="mt-6"><SkeletonCards count={3} /></div>
        ) : (
          <div className="mt-6 space-y-4">
            {items.length === 0 && !error && (
              <p className="card p-8 text-center text-sm text-muted-foreground">
                {filtering
                  ? tr("No bookmarks match these filters.", "In filters se koi bookmark nahi mila.")
                  : tr("No bookmarks yet - tap the ★ on any question in a test, a review or the question bank.", "Abhi koi bookmark nahi - kisi bhi test, review ya question bank me ★ dabao.")}
              </p>
            )}
            {items.map((b) => (
              <Card
                key={b.question.id}
                b={b}
                showHindi={showHindi}
                removing={removing.has(b.question.id)}
                onRemove={() => remove(b.question.id)}
                editing={editingNoteId === b.question.id}
                noteDraft={noteDraft}
                setNoteDraft={setNoteDraft}
                noteBusy={noteBusyId === b.question.id}
                startEdit={() => {
                  setEditingNoteId(b.question.id);
                  setNoteDraft(b.note || "");
                }}
                cancelEdit={() => setEditingNoteId("")}
                saveNote={() => saveNote(b.question.id)}
              />
            ))}
            {hasMore && (
              <div className="text-center">
                <button onClick={loadMore} disabled={moreBusy} className="btn btn-outline">
                  {moreBusy ? tr("Loading…", "Load ho raha…") : tr("Show more", "Aur dikhao")}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${active ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted"}`}
    >
      {children}
    </button>
  );
}

function Card(props: {
  b: Bm;
  showHindi: boolean;
  removing: boolean;
  onRemove: () => void;
  editing: boolean;
  noteDraft: string;
  setNoteDraft: (s: string) => void;
  noteBusy: boolean;
  startEdit: () => void;
  cancelEdit: () => void;
  saveNote: () => void;
}) {
  const tr = useT();
  const { b, showHindi } = props;
  const q = b.question;
  const mine = b.myAnswer?.selectedOption ?? null;
  return (
    <div className={`card p-5 transition ${props.removing ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {q.paperQuestionNo != null && (
            <span className="rounded-md bg-primary px-2 py-0.5 font-extrabold text-primary-foreground" title={tr("Number in the real exam paper", "Asli paper ka question number")}>
              Paper Q{q.paperQuestionNo}
            </span>
          )}
          {q.questionNo ? <span className="rounded-md bg-muted px-2 py-0.5 font-bold text-foreground">Q#{q.questionNo}</span> : null}
          <span>
            {q.examName || "SSC"} {q.year || ""}
            {q.shift ? ` · ${q.shift} shift` : ""}
            {q.subject ? ` · ${q.subject}` : ""}
            {q.chapter ? ` › ${q.chapter}` : ""}
            {q.topic ? ` › ${q.topic}` : ""}
          </span>
        </div>
        <button
          onClick={props.onRemove}
          disabled={props.removing}
          className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition hover:bg-danger/10 hover:text-danger"
        >
          ✕ {tr("Remove", "Hatao")}
        </button>
      </div>

      <p className="mt-3 break-words text-sm font-medium leading-relaxed">{q.questionText}</p>
      {showHindi && q.questionTextHindi && (
        <p className="mt-1.5 break-words border-l-2 border-primary/40 pl-3 text-sm leading-relaxed text-muted-foreground">{q.questionTextHindi}</p>
      )}
      <StemMedia diagramType={q.questionDiagramType} diagramLabels={q.questionDiagramLabels} imageUrl={q.questionImageUrl} />

      <div className="mt-3 space-y-1.5">
        {q.options.map((o) => {
          const isCorrect = q.attempted && o.key === q.correctAnswer;
          const isMine = mine === o.key;
          const cls = isCorrect
            ? "border-success bg-success/10"
            : isMine && q.attempted
              ? "border-danger bg-danger/10"
              : "border-border";
          return (
            <div key={o.key} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${cls}`}>
              <span className="font-bold">{o.key}.</span>
              <span className="min-w-0 break-words">
                <OptionBody diagramType={o.diagramType} diagramLabels={o.diagramLabels} imageUrl={o.imageUrl} text={o.text} label={o.key} />
                {showHindi && o.textHi && !o.diagramType && !o.imageUrl ? <span className="block text-xs text-muted-foreground">{o.textHi}</span> : null}
              </span>
              <span className="ml-auto flex shrink-0 flex-col items-end gap-0.5 text-[11px] font-bold">
                {isCorrect && <span className="text-success">✓ {tr("Answer", "Answer")}</span>}
                {isMine && <span className={isCorrect ? "text-success" : "text-danger"}>{tr("Your answer", "Aapka jawab")}</span>}
              </span>
            </div>
          );
        })}
      </div>

      {q.attempted ? (
        <>
          {b.myAnswer && (
            <p className={`mt-3 text-xs font-semibold ${b.myAnswer.isCorrect ? "text-success" : "text-danger"}`}>
              {b.myAnswer.selectedOption == null
                ? tr("You skipped this one in your last test.", "Last test me ye chhoda tha.")
                : b.myAnswer.isCorrect
                  ? tr("You got this right in your last test.", "Last test me ye sahi tha.")
                  : tr("You got this wrong in your last test.", "Last test me ye galat tha.")}{" "}
              <a href={`/results/${b.myAnswer.attemptId}`} className="underline">{tr("Open result", "Result dekho")}</a>
            </p>
          )}
          {(q.explanation || q.explanationHindi) && (
            <div className="mt-3 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
              💡 <RichText text={showHindi && q.explanationHindi ? `${q.explanation ?? ""}\n\n${q.explanationHindi}` : q.explanation} className="inline" />
            </div>
          )}
        </>
      ) : (
        <p className="mt-3 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
          🔒 {tr("Finish a test or practice set with this question to unlock its answer & solution here.", "Is sawal ke saath test ya practice set poora karo, tab answer aur solution yahan khulega.")}
        </p>
      )}

      {props.editing ? (
        <div className="mt-3">
          <textarea
            value={props.noteDraft}
            onChange={(e) => props.setNoteDraft(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={tr("Write your note (memory trick, reason for the mistake, etc.)", "Apna note likhein (yaad rakhne ki trick, galti ki wajah, etc.)")}
            className="w-full border bg-background p-2 text-sm"
          />
          <div className="mt-1.5 flex gap-2">
            <button onClick={props.saveNote} disabled={props.noteBusy} className="btn btn-primary btn-sm">{props.noteBusy ? "…" : tr("Save", "Save")}</button>
            <button onClick={props.cancelEdit} className="btn btn-outline btn-sm">{tr("Cancel", "Cancel")}</button>
          </div>
        </div>
      ) : b.note ? (
        <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <p className="whitespace-pre-wrap break-words text-xs text-foreground">📝 {b.note}</p>
          <button onClick={props.startEdit} className="mt-1 text-[11px] font-semibold text-primary hover:underline">{tr("Edit note", "Note badlo")}</button>
        </div>
      ) : (
        <button onClick={props.startEdit} className="mt-3 text-xs font-semibold text-primary hover:underline">＋ {tr("Add a note", "Note jodo")}</button>
      )}
    </div>
  );
}
