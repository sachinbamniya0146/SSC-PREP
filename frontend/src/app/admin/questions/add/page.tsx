"use client";

// Add ONE question (NEW — Oct 1 2026)
//
// "admin har question individually bhi daal ske — question, konsi shift, konsa
// year, hindi ka box, option-wise image, duplicate verify, PYQ aur Practice dono."
//
// Same rules as an Excel row (backend: POST /bank/admin/upload/single):
//   * PYQ  -> year (required), shift, exam date, paper code  => joins the real-paper mock
//   * Practice -> chapter / topic / sub-topic only
//   * question + every option can carry text, Hindi text and/or an image
//   * "Check duplicate" asks the server; Save also refuses duplicates
import * as React from "react";
import { useRouter } from "next/navigation";
import { API_BASE, fetchAuth } from "@/lib/api";
import DateField from "@/components/DateField";
import { normalizeShift } from "@/lib/shift";

type Kind = "pyq" | "practice";
type TaxSubTopic = { id: string; name: string };
type TaxTopic = { id: string; name: string; subTopics: TaxSubTopic[] };
type TaxChapter = { id: string; name: string; topics: TaxTopic[] };
type TaxSubject = { id: string; name: string; chapters: TaxChapter[] };
type Exam = { id: string; name: string };
type Opt = { text: string; textHi: string; imageUrl: string };
type DupInfo = { id: string; questionText: string; year: number | null; shift: string | null; hasImage?: boolean };

const KEYS = ["A", "B", "C", "D"] as const;
const emptyOpts = (): Opt[] => KEYS.map(() => ({ text: "", textHi: "", imageUrl: "" }));

function ImageField({ label, url, onChange, onError }: { label: string; url: string; onChange: (u: string) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = React.useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      onError("Image 5 MB se badi hai — chhoti image chunein. / Image is over 5 MB.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetchAuth(`${API_BASE}/bank/admin/upload/question-image`, { method: "POST", body: fd });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.message || `Image upload failed (HTTP ${r.status})`);
      onChange(d.url);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Image upload failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2">
      {url ? (
        <div className="flex items-start gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={label} className="max-h-32 max-w-[60%] rounded border border-border bg-white object-contain" />
          <button type="button" onClick={() => onChange("")} className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-600">✕ Hatayein</button>
        </div>
      ) : (
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-primary">
          {busy ? "Uploading…" : `🖼️ ${label} (image)`}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" disabled={busy} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      )}
    </div>
  );
}

export default function AddQuestionPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = React.useState(false);
  const [exams, setExams] = React.useState<Exam[]>([]);
  const [tax, setTax] = React.useState<TaxSubject[]>([]);

  const [kind, setKind] = React.useState<Kind>("pyq");
  const [examId, setExamId] = React.useState("");
  const [subjectId, setSubjectId] = React.useState("");
  const [chapterId, setChapterId] = React.useState("");
  const [topicId, setTopicId] = React.useState("");
  const [subTopicId, setSubTopicId] = React.useState("");
  const [year, setYear] = React.useState("");
  const [shift, setShift] = React.useState("");
  const [examDate, setExamDate] = React.useState("");
  const [paperCode, setPaperCode] = React.useState("");

  const [questionText, setQuestionText] = React.useState("");
  const [questionTextHindi, setQuestionTextHindi] = React.useState("");
  const [questionImageUrl, setQuestionImageUrl] = React.useState("");
  const [options, setOptions] = React.useState<Opt[]>(emptyOpts());
  const [correct, setCorrect] = React.useState("");
  const [explanation, setExplanation] = React.useState("");
  const [explanationHindi, setExplanationHindi] = React.useState("");
  const [marks, setMarks] = React.useState("");
  const [negativeMarks, setNegativeMarks] = React.useState("");
  const [difficulty, setDifficulty] = React.useState("MEDIUM");

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [ok, setOk] = React.useState<{ msg: string; warnings: string[] } | null>(null);
  const [dup, setDup] = React.useState<{ checked: boolean; isDuplicate: boolean; existing?: DupInfo; exact?: boolean; differences?: string[] } | null>(null);
  const [savedCount, setSavedCount] = React.useState(0);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem("ssc_user");
      const user = raw ? JSON.parse(raw) : null;
      if (!(user?.role === "ADMIN" || user?.role === "MODERATOR")) {
        router.replace("/dashboard");
        return;
      }
    } catch {
      router.replace("/dashboard");
      return;
    }
    setAuthChecked(true);
    (async () => {
      try {
        const [e, t] = await Promise.all([fetchAuth(`${API_BASE}/bank/meta`), fetchAuth(`${API_BASE}/bank/admin/taxonomy/tree`)]);
        if (e.ok) {
          const d = await e.json();
          setExams(Array.isArray(d?.exams) ? d.exams : []);
        }
        if (t.ok) setTax(await t.json());
      } catch {
        setError("Exam / syllabus list load nahi hui — page refresh karein.");
      }
    })();
  }, [router]);

  const subject = tax.find((s) => s.id === subjectId);
  const chapter = subject?.chapters.find((c) => c.id === chapterId);
  const topic = chapter?.topics.find((t) => t.id === topicId);

  const payload = () => ({
    kind,
    examId,
    subjectId,
    chapterId,
    topicId: topicId || undefined,
    subTopicId: subTopicId || undefined,
    year: kind === "pyq" ? year : undefined,
    shift: kind === "pyq" ? shift : undefined,
    examDate: kind === "pyq" ? examDate : undefined,
    paperCode: kind === "pyq" ? paperCode : undefined,
    questionText,
    questionTextHindi,
    questionImageUrl,
    options: KEYS.map((k, i) => ({ key: k, text: options[i].text, textHi: options[i].textHi, imageUrl: options[i].imageUrl })),
    correctAnswer: correct,
    explanation,
    explanationHindi,
    marks,
    negativeMarks,
    difficulty,
  });

  const post = async (path: string, extra?: Record<string, unknown>) => {
    const r = await fetchAuth(`${API_BASE}/bank/admin/upload/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload(), ...(extra ?? {}) }),
    });
    const d = await r.json().catch(() => null);
    return { r, d };
  };

  const setOpt = (i: number, patch: Partial<Opt>) => setOptions((o) => o.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const checkDuplicate = async () => {
    setError("");
    setOk(null);
    setBusy(true);
    try {
      const { r, d } = await post("single/check-duplicate");
      if (!r.ok) throw new Error(d?.message || `Check failed (HTTP ${r.status})`);
      setDup({ checked: true, isDuplicate: !!d.isDuplicate, existing: d.existing, exact: d.exact, differences: d.differences });
    } catch (e) {
      setDup(null);
      setError(e instanceof Error ? e.message : "Duplicate check failed");
    } finally {
      setBusy(false);
    }
  };

  // Oct 6 2026: instead of dropping a duplicate, queue it for the Duplicate Review screen
  const sendToReview = async () => {
    setError("");
    setOk(null);
    setBusy(true);
    try {
      const { r, d } = await post("single", { duplicateAction: "review" });
      if (!r.ok) throw new Error(Array.isArray(d?.message) ? d.message.join("; ") : d?.message || `Failed (HTTP ${r.status})`);
      setOk({ msg: "📥 Duplicate review queue me bhej diya — Admin → Duplicate Review me purana / naya / dono chunein.", warnings: [] });
      setQuestionText("");
      setQuestionTextHindi("");
      setQuestionImageUrl("");
      setOptions(emptyOpts());
      setCorrect("");
      setExplanation("");
      setExplanationHindi("");
      setDup(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setError("");
    setOk(null);
    setBusy(true);
    try {
      const { r, d } = await post("single");
      if (r.status === 409 && d?.code === "DUPLICATE") {
        setDup({ checked: true, isDuplicate: true, existing: d.existing, exact: d.exact, differences: d.differences });
        throw new Error(d.message);
      }
      if (!r.ok) throw new Error(Array.isArray(d?.message) ? d.message.join("; ") : d?.message || `Save failed (HTTP ${r.status})`);
      setSavedCount((n) => n + 1);
      setOk({ msg: `✅ Question save ho gaya (${d.kind === "pyq" ? "PYQ" : "Practice"})${d.published ? " — students ko dikh raha hai" : ""}`, warnings: d.warnings || [] });
      // keep exam / subject / chapter / topic / year / shift / date for rapid entry; clear the question itself
      setQuestionText("");
      setQuestionTextHindi("");
      setQuestionImageUrl("");
      setOptions(emptyOpts());
      setCorrect("");
      setExplanation("");
      setExplanationHindi("");
      setDup(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  };

  const hasQuestion = !!(questionText.trim() || questionImageUrl);
  const optionsOk = options.every((o) => o.text.trim() || o.imageUrl);
  const refsOk = !!(examId && subjectId && chapterId) && (kind === "practice" || !!year);
  const canSubmit = refsOk && hasQuestion && optionsOk && !!correct && !busy;

  if (!authChecked) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;

  const inp = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
  const lbl = "mb-1 block text-xs font-semibold text-muted-foreground";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <a href="/admin" className="text-sm font-semibold">← Admin</a>
          <span className="text-sm font-bold">➕ Ek question daalein</span>
          <span className="text-xs text-muted-foreground">{savedCount} saved</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600">{error}</div>}
        {ok && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
            <p className="font-semibold text-emerald-700 dark:text-emerald-400">{ok.msg}</p>
            {ok.warnings.map((w, i) => <p key={i} className="mt-1 text-xs text-amber-600">⚠️ {w}</p>)}
            <p className="mt-1 text-xs text-muted-foreground">Exam / chapter / year / shift wahi rakhe gaye hain — agla question bhar dein.</p>
          </div>
        )}

        {/* Kind */}
        <div className="grid grid-cols-2 gap-3">
          {(["pyq", "practice"] as Kind[]).map((k) => (
            <button key={k} type="button" onClick={() => { setKind(k); setDup(null); }} className={`rounded-xl border-2 px-3 py-3 text-sm font-semibold ${kind === k ? (k === "pyq" ? "border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-400" : "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400") : "border-border text-muted-foreground"}`}>
              {k === "pyq" ? "📘 PYQ (previous year)" : "📗 Practice"}
            </button>
          ))}
        </div>

        {/* Where does it belong */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-bold">1. Kahan jayega</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={lbl}>Exam *</label>
              <select className={inp} value={examId} onChange={(e) => { setExamId(e.target.value); setDup(null); }}>
                <option value="">— exam chunein —</option>
                {exams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Subject *</label>
              <select className={inp} value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setChapterId(""); setTopicId(""); setSubTopicId(""); setDup(null); }}>
                <option value="">— subject —</option>
                {tax.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Chapter *</label>
              <select className={inp} value={chapterId} disabled={!subject} onChange={(e) => { setChapterId(e.target.value); setTopicId(""); setSubTopicId(""); setDup(null); }}>
                <option value="">— chapter —</option>
                {subject?.chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Topic</label>
              <select className={inp} value={topicId} disabled={!chapter} onChange={(e) => { setTopicId(e.target.value); setSubTopicId(""); setDup(null); }}>
                <option value="">— topic (optional) —</option>
                {chapter?.topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>Sub-topic</label>
              <select className={inp} value={subTopicId} disabled={!topic} onChange={(e) => { setSubTopicId(e.target.value); setDup(null); }}>
                <option value="">— sub-topic (optional) —</option>
                {topic?.subTopics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>

          {kind === "pyq" && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div>
                <label className={lbl}>Year *</label>
                <input className={inp} inputMode="numeric" placeholder="2024" value={year} onChange={(e) => { setYear(e.target.value.replace(/\D/g, "").slice(0, 4)); setDup(null); }} />
              </div>
              <div>
                <label className={lbl}>Shift</label>
                <input className={inp} list="shift-list" placeholder="Shift 1 / morning / evening" value={shift} onChange={(e) => { setShift(e.target.value); setDup(null); }} onBlur={() => setShift((v) => normalizeShift(v) ?? "")} />
                <p className="mt-1 text-[11px] text-muted-foreground">Morning / subah = Shift 1 · Afternoon / dopahar = Shift 2 · Evening / shaam = Shift 3 (apne aap badal jayega)</p>
                <datalist id="shift-list">{["Shift 1", "Shift 2", "Shift 3", "Shift 4"].map((s) => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className={lbl}>Exam date</label>
                <DateField className={inp} value={examDate} onChange={(v) => { setExamDate(v); setDup(null); }} />
              </div>
              <div className="sm:col-span-3">
                <label className={lbl}>Paper code (optional — blank chhodein to date + shift se ban jayega)</label>
                <input className={inp} placeholder="optional" value={paperCode} onChange={(e) => setPaperCode(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-3">Ek hi exam + year + date + shift ke 100 questions apne aap ek real PYQ mock ban jate hain.</p>
            </div>
          )}
        </section>

        {/* Question */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-bold">2. Question</h2>
          <label className={lbl}>Question (English)</label>
          <textarea className={`${inp} min-h-[90px]`} value={questionText} onChange={(e) => { setQuestionText(e.target.value); setDup(null); }} placeholder="Question text — image wale question me khali bhi chhod sakte hain" />
          <label className={`${lbl} mt-3`}>प्रश्न (Hindi)</label>
          <textarea className={`${inp} min-h-[90px]`} value={questionTextHindi} onChange={(e) => setQuestionTextHindi(e.target.value)} placeholder="हिंदी में प्रश्न — English subject ke alawa Hindi zaroori hai tabhi students ko dikhega" />
          <ImageField label="Question image" url={questionImageUrl} onChange={(u) => { setQuestionImageUrl(u); setDup(null); }} onError={setError} />
        </section>

        {/* Options */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-1 text-sm font-bold">3. Options (text, Hindi aur/ya image)</h2>
          <p className="mb-3 text-xs text-muted-foreground">Har option me text ya image zaroori hai. Sahi option ke saath wala gola dabayein.</p>
          <div className="space-y-4">
            {KEYS.map((k, i) => (
              <div key={k} className={`rounded-lg border p-3 ${correct === k ? "border-emerald-500 bg-emerald-500/5" : "border-border"}`}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-bold">Option {k}</span>
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold">
                    <input type="radio" name="correct" checked={correct === k} onChange={() => { setCorrect(k); setDup(null); }} /> Sahi answer
                  </label>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className={inp} placeholder={`Option ${k} (English)`} value={options[i].text} onChange={(e) => { setOpt(i, { text: e.target.value }); setDup(null); }} />
                  <input className={inp} placeholder={`विकल्प ${k} (Hindi)`} value={options[i].textHi} onChange={(e) => setOpt(i, { textHi: e.target.value })} />
                </div>
                <ImageField label={`Option ${k}`} url={options[i].imageUrl} onChange={(u) => { setOpt(i, { imageUrl: u }); setDup(null); }} onError={setError} />
              </div>
            ))}
          </div>
        </section>

        {/* Explanation + meta */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-bold">4. Explanation aur marks (optional)</h2>
          <label className={lbl}>Explanation (English)</label>
          <textarea className={`${inp} min-h-[70px]`} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
          <label className={`${lbl} mt-3`}>व्याख्या (Hindi)</label>
          <textarea className={`${inp} min-h-[70px]`} value={explanationHindi} onChange={(e) => setExplanationHindi(e.target.value)} />
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div><label className={lbl}>Marks (default 1)</label><input className={inp} inputMode="decimal" value={marks} onChange={(e) => setMarks(e.target.value)} placeholder="1" /></div>
            <div><label className={lbl}>Negative marks (default 0.25)</label><input className={inp} inputMode="decimal" value={negativeMarks} onChange={(e) => setNegativeMarks(e.target.value)} placeholder="0.25" /></div>
            <div><label className={lbl}>Difficulty</label>
              <select className={inp} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option>
              </select>
            </div>
          </div>
        </section>

        {/* Duplicate verdict */}
        {dup?.checked && (
          <div className={`rounded-lg border p-3 text-sm ${dup.isDuplicate ? "border-red-500/40 bg-red-500/10" : "border-emerald-500/40 bg-emerald-500/10"}`}>
            {dup.isDuplicate && dup.existing ? (
              <>
                <p className="font-semibold text-red-600">
                  {dup.exact
                    ? "❌ Exactly same question (question, options, solution, shift sab same) pehle se database me hai."
                    : `⚠️ Same question pehle se hai, lekin ye alag hai: ${(dup.differences ?? []).join(", ") || "details"}.`}
                </p>
                <button type="button" onClick={sendToReview} disabled={busy} className="mt-2 rounded-lg border border-red-500/50 bg-background px-3 py-1.5 text-xs font-semibold hover:bg-red-500/10 disabled:opacity-40">📥 Review queue me bhejo (purana / naya / dono wahan chunein)</button>
                <p className="mt-1 text-xs text-muted-foreground">“{dup.existing.questionText || "(image question)"}” {dup.existing.year ? `· ${dup.existing.year}` : ""} {dup.existing.shift ? `· ${dup.existing.shift}` : ""} · ID {dup.existing.id}</p>
              </>
            ) : (
              <p className="font-semibold text-emerald-700 dark:text-emerald-400">✅ Duplicate nahi hai — save kar sakte hain.</p>
            )}
          </div>
        )}

        <div className="sticky bottom-3 flex gap-2 rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
          <button type="button" onClick={checkDuplicate} disabled={!canSubmit} className="flex-1 rounded-lg border border-border px-3 py-3 text-sm font-semibold hover:border-primary disabled:opacity-40">🔍 Duplicate check</button>
          <button type="button" onClick={save} disabled={!canSubmit} className="flex-[2] rounded-lg bg-primary px-3 py-3 text-sm font-bold text-primary-foreground disabled:opacity-40">{busy ? "Please wait…" : "💾 Save question"}</button>
        </div>
        {!canSubmit && !busy && <p className="pb-6 text-center text-xs text-muted-foreground">Save ke liye: exam, subject, chapter{kind === "pyq" ? ", year" : ""}, question (text ya image), chaaron options aur sahi answer chahiye.</p>}
      </main>
    </div>
  );
}
